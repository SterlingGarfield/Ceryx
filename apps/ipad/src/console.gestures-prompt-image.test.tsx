import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useConnectionStore,
  usePairingStore,
  usePromptStore,
  useRemoteSessionStore
} from "@ceryx/feature-remote-control";
import { writeDeviceToken } from "./platform/ipad/tokenVault";
import { App } from "./App";

function mockJson(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function hasCall(fetchMock: ReturnType<typeof vi.fn>, fragment: string): boolean {
  return fetchMock.mock.calls.some(([input]) => String(input).includes(fragment));
}

function callsFor(fetchMock: ReturnType<typeof vi.fn>, fragment: string) {
  return fetchMock.mock.calls.filter(([input]) => String(input).includes(fragment));
}

function createFetchMock() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.endsWith("/api/v1/health")) {
      return mockJson({ ok: true, service: "ceryx-agent", version: "0.3.0" });
    }

    if (url.endsWith("/api/v1/agent/status")) {
      return mockJson({
        agentVersion: "0.3.0",
        deviceName: "Windows Agent",
        platform: "windows",
        status: "running",
        httpPort: 41527,
        supportsWebRTC: true,
        supportsDesktopClient: true,
        codexStatus: "found"
      });
    }

    if (url.endsWith("/api/v1/codex/window")) {
      return mockJson({
        status: "found",
        windowId: "w001",
        title: "Codex",
        processName: "Codex.exe",
        candidateCount: 1,
        lastUpdatedAt: "2026-05-22T01:00:00.000Z"
      });
    }

    if (url.endsWith("/api/v1/capture/state")) {
      return mockJson({
        ok: true,
        active: false,
        paused: false,
        mode: "balanced",
        windowId: "w001",
        width: 1440,
        height: 900
      });
    }

    if (url.endsWith("/api/v1/input/mouse")) {
      return mockJson({
        ok: true,
        action: "input.mouse",
        status: "applied",
        message: "Mouse input accepted."
      });
    }

    if (url.endsWith("/api/v1/input/scroll")) {
      return mockJson({
        ok: true,
        action: "input.scroll",
        status: "applied",
        message: "Scroll input accepted."
      });
    }

    if (url.endsWith("/api/v1/input/hotkey")) {
      return mockJson({
        ok: true,
        action: "input.hotkey",
        status: "applied",
        message: "Hotkey input accepted."
      });
    }

    if (url.endsWith("/api/v1/assets/upload-image")) {
      return mockJson({
        ok: true,
        assetId: "asset_001",
        fileName: "mock.png",
        sizeBytes: 128
      });
    }

    if (url.endsWith("/api/v1/project/diff")) {
      return mockJson({
        ok: true,
        status: "ready",
        summary: "No changes"
      });
    }

    if (url.includes("/api/v1/project/diff/files")) {
      return mockJson({
        ok: true,
        projectId: "workspace-default",
        projectName: "CeryxProject",
        files: [{ path: "src/main.ts", status: "modified", additions: 4, deletions: 2 }]
      });
    }

    if (url.includes("/api/v1/project/diff/file")) {
      return mockJson({
        ok: true,
        projectId: "workspace-default",
        path: "src/main.ts",
        status: "modified",
        additions: 4,
        deletions: 2,
        diffText: "@@ -1 +1 @@\n-old\n+new",
        truncated: false,
        lineLimit: 1200
      });
    }

    if (url.includes("/api/v1/logs")) {
      return mockJson({
        ok: true,
        page: 1,
        pageSize: 80,
        total: 2,
        hasMore: false,
        items: [
          {
            id: "audit_001",
            action: "prompt.send.accepted",
            details: "submitted=true",
            severity: "info",
            sessionId: "dev_local",
            createdAt: "2026-05-22T01:00:00.000Z"
          },
          {
            id: "audit_002",
            action: "input.rejected",
            details: "reason=minimized",
            severity: "warning",
            sessionId: "dev_local",
            createdAt: "2026-05-22T01:01:00.000Z"
          }
        ]
      });
    }

    if (url.endsWith("/api/v1/media/screenshot")) {
      return mockJson({
        ok: true,
        fileName: "capture.png",
        sizeBytes: 500
      });
    }

    if (url.endsWith("/api/v1/media/recording/start")) {
      return mockJson({
        ok: true,
        status: "started",
        startedAt: "2026-05-22T01:10:00.000Z"
      });
    }

    if (url.endsWith("/api/v1/media/recording/stop")) {
      return mockJson({
        ok: true,
        status: "stopped",
        fileName: "capture.mp4",
        sizeBytes: 12000
      });
    }

    if (url.endsWith("/api/v1/prompt/send")) {
      return mockJson({
        ok: true,
        status: "queued",
        submitted: true
      });
    }

    return mockJson({ ok: true, url, init });
  });
}

async function renderConsole(fetchMock: ReturnType<typeof vi.fn>) {
  writeDeviceToken("http://127.0.0.1:41527", "ipad_token");
  useConnectionStore.getState().setCurrentDevice({
    deviceId: "device:http://127.0.0.1:41527",
    deviceName: "Windows Agent",
    platform: "windows",
    baseUrl: "http://127.0.0.1:41527"
  });
  window.history.pushState({}, "", "/console");
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);

  await waitFor(() =>
    expect(screen.getByRole("heading", { level: 1, name: "Live Console" })).toBeInTheDocument()
  );
}

describe("ipad console gestures prompt image", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    window.localStorage.clear();
    useConnectionStore.getState().reset();
    usePairingStore.getState().reset();
    usePromptStore.getState().reset();
    useRemoteSessionStore.getState().clear();
    vi.restoreAllMocks();
  });

  it("maps gestures to protocol input routes and toggles toolbar", async () => {
    const fetchMock = createFetchMock();
    await renderConsole(fetchMock);

    const surface = screen.getByTestId("ipad-gesture-surface");

    fireEvent.touchStart(surface, {
      touches: [{ clientX: 120, clientY: 160 }]
    });
    fireEvent.touchEnd(surface, {
      touches: [],
      changedTouches: [{ clientX: 120, clientY: 160 }]
    });

    await waitFor(() => expect(hasCall(fetchMock, "/api/v1/input/mouse")).toBe(true));

    fireEvent.touchStart(surface, {
      touches: [
        { clientX: 200, clientY: 200 },
        { clientX: 230, clientY: 200 }
      ]
    });
    fireEvent.touchEnd(surface, {
      touches: [],
      changedTouches: [
        { clientX: 200, clientY: 200 },
        { clientX: 230, clientY: 200 }
      ]
    });

    await waitFor(() => {
      const mouseCalls = callsFor(fetchMock, "/api/v1/input/mouse");
      const rightClick = mouseCalls.some(([, init]) =>
        String(init?.body ?? "").includes('"button":"right"')
      );
      expect(rightClick).toBe(true);
    });

    fireEvent.touchStart(surface, {
      touches: [
        { clientX: 240, clientY: 260 },
        { clientX: 300, clientY: 260 }
      ]
    });
    fireEvent.touchMove(surface, {
      touches: [
        { clientX: 240, clientY: 320 },
        { clientX: 300, clientY: 320 }
      ]
    });
    fireEvent.touchEnd(surface, {
      touches: [],
      changedTouches: [
        { clientX: 240, clientY: 320 },
        { clientX: 300, clientY: 320 }
      ]
    });

    await waitFor(() => expect(hasCall(fetchMock, "/api/v1/input/scroll")).toBe(true));

    fireEvent.touchStart(surface, {
      touches: [
        { clientX: 260, clientY: 240 },
        { clientX: 320, clientY: 240 }
      ]
    });
    fireEvent.touchMove(surface, {
      touches: [
        { clientX: 220, clientY: 240 },
        { clientX: 360, clientY: 240 }
      ]
    });
    fireEvent.touchEnd(surface, {
      touches: [],
      changedTouches: [
        { clientX: 220, clientY: 240 },
        { clientX: 360, clientY: 240 }
      ]
    });

    await waitFor(() => expect(hasCall(fetchMock, "/api/v1/input/hotkey")).toBe(true));

    fireEvent.touchStart(surface, {
      touches: [{ clientX: 180, clientY: 180 }]
    });
    await new Promise((resolve) => setTimeout(resolve, 620));
    fireEvent.touchEnd(surface, {
      touches: [],
      changedTouches: [{ clientX: 180, clientY: 180 }]
    });

    await waitFor(() => {
      const mouseCalls = callsFor(fetchMock, "/api/v1/input/mouse");
      const downAndUp =
        mouseCalls.some(([, init]) => String(init?.body ?? "").includes('"action":"down"')) &&
        mouseCalls.some(([, init]) => String(init?.body ?? "").includes('"action":"up"'));
      expect(downAndUp).toBe(true);
    });

    expect(screen.getByTestId("ipad-bottom-toolbar")).toBeInTheDocument();
    fireEvent.touchStart(surface, {
      touches: [
        { clientX: 260, clientY: 180 },
        { clientX: 300, clientY: 180 },
        { clientX: 340, clientY: 180 }
      ]
    });
    fireEvent.touchEnd(surface, {
      touches: [],
      changedTouches: [
        { clientX: 260, clientY: 180 },
        { clientX: 300, clientY: 180 },
        { clientX: 340, clientY: 180 }
      ]
    });

    await waitFor(() => expect(screen.queryByTestId("ipad-bottom-toolbar")).toBeNull());

    fireEvent.touchStart(surface, {
      touches: [
        { clientX: 260, clientY: 180 },
        { clientX: 300, clientY: 180 },
        { clientX: 340, clientY: 180 }
      ]
    });
    fireEvent.touchEnd(surface, {
      touches: [],
      changedTouches: [
        { clientX: 260, clientY: 180 },
        { clientX: 300, clientY: 180 },
        { clientX: 340, clientY: 180 }
      ]
    });

    await waitFor(() => expect(screen.getByTestId("ipad-bottom-toolbar")).toBeInTheDocument());
  });

  it("wires voice sheet to prompt draft", async () => {
    const fetchMock = createFetchMock();
    await renderConsole(fetchMock);

    fireEvent.click(screen.getByRole("button", { name: "Voice Input" }));
    expect(screen.getByTestId("ipad-voice-sheet")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Transcript Placeholder"), {
      target: { value: "Voice transcript from sheet" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Insert Draft" }));

    await waitFor(() => {
      const draft = screen.getByLabelText("Prompt Draft") as HTMLTextAreaElement;
      expect(draft.value).toContain("Voice transcript from sheet");
    });
  });

  it("wires image upload sheet to sdk endpoint and appends draft marker", async () => {
    const fetchMock = createFetchMock();
    await renderConsole(fetchMock);

    fireEvent.click(screen.getByRole("button", { name: "Image Upload" }));
    expect(screen.getByTestId("ipad-image-sheet")).toBeInTheDocument();

    const imageInput = screen.getByLabelText("Image file input");
    const file = new File(["png"], "mock.png", { type: "image/png" });
    fireEvent.change(imageInput, {
      target: { files: [file] }
    });

    fireEvent.click(screen.getByRole("button", { name: "Upload Image" }));

    await waitFor(() => expect(hasCall(fetchMock, "/api/v1/assets/upload-image")).toBe(true));
    await waitFor(() => {
      const draft = screen.getByLabelText("Prompt Draft") as HTMLTextAreaElement;
      expect(draft.value).toContain("[image:mock.png]");
    });
  });

  it("switches side panel into drawer in portrait", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 820
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 1180
    });
    window.dispatchEvent(new Event("resize"));

    const fetchMock = createFetchMock();
    await renderConsole(fetchMock);

    expect(screen.getByRole("button", { name: "Open Side Panel" })).toBeInTheDocument();
    expect(screen.queryByTestId("ipad-side-drawer")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open Side Panel" }));
    await waitFor(() => expect(screen.getByTestId("ipad-side-drawer")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Close Panel" })).toBeInTheDocument();
  });

  it("opens diff workspace and routes review actions", async () => {
    const fetchMock = createFetchMock();
    await renderConsole(fetchMock);

    const openPanelButton = screen.queryByRole("button", { name: "Open Side Panel" });
    if (openPanelButton) {
      fireEvent.click(openPanelButton);
      await waitFor(() => expect(screen.getByTestId("ipad-side-drawer")).toBeInTheDocument());
    }

    fireEvent.click(screen.getByRole("button", { name: "Diff Workspace" }));

    await waitFor(() => expect(screen.getByTestId("ipad-diff-workspace")).toBeInTheDocument());
    await waitFor(() => expect(hasCall(fetchMock, "/api/v1/project/diff/files")).toBe(true));
    await waitFor(() => expect(hasCall(fetchMock, "/api/v1/project/diff/file")).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "Ask Codex to Explain" }));
    await waitFor(() => {
      const draft = screen.getByLabelText("Prompt Draft") as HTMLTextAreaElement;
      expect(draft.value).toContain("Explain this diff");
    });
  });

  it("opens logs workspace and loads virtualized logs", async () => {
    const fetchMock = createFetchMock();
    await renderConsole(fetchMock);

    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText, readText: vi.fn(async () => "") },
      configurable: true
    });

    const openPanelButton = screen.queryByRole("button", { name: "Open Side Panel" });
    if (openPanelButton) {
      fireEvent.click(openPanelButton);
      await waitFor(() => expect(screen.getByTestId("ipad-side-drawer")).toBeInTheDocument());
    }

    fireEvent.click(screen.getByRole("button", { name: "Logs Workspace" }));

    await waitFor(() => expect(screen.getByTestId("ipad-logs-workspace")).toBeInTheDocument());
    await waitFor(() => expect(hasCall(fetchMock, "/api/v1/logs")).toBe(true));
    expect(screen.getByTestId("ipad-logs-virtualized-list")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy Visible" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
  });
});
