import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useConnectionStore,
  usePromptStore,
  useRemoteSessionStore
} from "@ceryx/feature-remote-control";
import { App } from "./App";
import { defaultLocalAgentBaseUrl } from "./platform/desktop/agentGateway";
import { writeDeviceToken } from "./platform/desktop/tokenVault";

function mockJson(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function wasCalledWith(fetchMock: ReturnType<typeof vi.fn>, fragment: string): boolean {
  return fetchMock.mock.calls.some(([input]) => String(input).includes(fragment));
}

async function waitForActionCycle(fetchMock: ReturnType<typeof vi.fn>, fragment: string) {
  await waitFor(() => expect(wasCalledWith(fetchMock, fragment)).toBe(true));
  await waitFor(() => expect(wasCalledWith(fetchMock, "/api/v1/capture/state")).toBe(true));
}

async function renderConsole() {
  window.history.pushState({}, "", "/console");
  writeDeviceToken(defaultLocalAgentBaseUrl, "desktop_token");
  vi.spyOn(window, "confirm").mockReturnValue(true);

  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);

    if (url.endsWith("/api/v1/health")) {
      return mockJson({ ok: true, service: "ceryx-agent", version: "0.3.0" });
    }

    if (url.endsWith("/api/v1/agent/status")) {
      return mockJson({
        agentVersion: "0.3.0",
        deviceName: "Local Windows PC",
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
        title: "Codex",
        status: "found",
        processName: "Codex.exe",
        bounds: {
          x: 80,
          y: 120,
          width: 1440,
          height: 900
        },
        lastSeenAt: "2026-05-21T07:00:00.000Z"
      });
    }

    if (url.endsWith("/api/v1/capture/state")) {
      return mockJson({
        ok: true,
        active: false,
        paused: false,
        mode: "balanced",
        windowId: null,
        width: 1440,
        height: 900,
        frameRate: 30,
        quality: "balanced"
      });
    }

    if (url.endsWith("/api/v1/project/diff")) {
      return mockJson({
        ok: true,
        status: "ready",
        summary: "2 files changed",
        diffText: null
      });
    }

    if (url.includes("/api/v1/project/diff/files")) {
      return mockJson({
        ok: true,
        projectId: "workspace-default",
        projectName: "CeryxProject",
        files: [
          { path: "src/main.ts", status: "modified", additions: 3, deletions: 1 },
          { path: "src/App.tsx", status: "added", additions: 12, deletions: 0 }
        ]
      });
    }

    if (url.includes("/api/v1/project/diff/file")) {
      const parsed = new URL(url);
      const requestedPath = parsed.searchParams.get("path") ?? "src/main.ts";
      return mockJson({
        ok: true,
        projectId: "workspace-default",
        path: requestedPath,
        status: requestedPath === "src/App.tsx" ? "added" : "modified",
        additions: requestedPath === "src/App.tsx" ? 12 : 3,
        deletions: requestedPath === "src/App.tsx" ? 0 : 1,
        diffText: requestedPath === "src/App.tsx"
          ? "@@ -0,0 +1 @@\n+const App = () => null;"
          : "@@ -1 +1 @@\n-old\n+new",
        truncated: false,
        lineLimit: 1200
      });
    }

    if (url.includes("/api/v1/logs")) {
      return mockJson({
        ok: true,
        page: 1,
        pageSize: 100,
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

    if (url.endsWith("/api/v1/project/test-request")) {
      return mockJson({
        accepted: true,
        requestedAt: "2026-05-21T07:11:00.000Z",
        scope: "changed-modules",
        message: "Test request submitted."
      });
    }

    if (url.endsWith("/api/v1/media/screenshot")) {
      return mockJson({
        fileName: "capture.png",
        savedAt: "2026-05-21T07:12:00.000Z"
      });
    }

    if (url.endsWith("/api/v1/media/recording/start")) {
      return mockJson({
        ok: true,
        recordingId: "rec_001",
        fileName: "capture.mp4",
        startedAt: "2026-05-21T07:13:00.000Z"
      });
    }

    if (url.endsWith("/api/v1/media/recording/stop")) {
      return mockJson({
        ok: true,
        recordingId: "rec_001",
        fileName: "capture.mp4",
        stoppedAt: "2026-05-21T07:14:00.000Z"
      });
    }

    if (url.endsWith("/api/v1/input/hotkey")) {
      return mockJson({
        ok: true,
        accepted: true,
        message: "Hotkey dispatched."
      });
    }

    if (url.endsWith("/api/v1/input/key")) {
      return mockJson({
        ok: true,
        accepted: true,
        message: "Key dispatched."
      });
    }

    if (url.endsWith("/api/v1/codex/focus")) {
      return mockJson({
        title: "Codex",
        status: "focused",
        processName: "Codex.exe",
        bounds: {
          x: 80,
          y: 120,
          width: 1440,
          height: 900
        },
        lastSeenAt: "2026-05-21T07:15:00.000Z"
      });
    }

    if (url.endsWith("/api/v1/codex/refresh")) {
      return mockJson({
        title: "Codex",
        status: "found",
        processName: "Codex.exe",
        bounds: {
          x: 80,
          y: 120,
          width: 1440,
          height: 900
        },
        lastSeenAt: "2026-05-21T07:16:00.000Z"
      });
    }

    if (url.endsWith("/api/v1/prompt/send")) {
      return mockJson({
        ok: true,
        queued: true
      });
    }

    return mockJson({ ok: true });
  });

  vi.stubGlobal("fetch", fetchMock);
  const writeText = vi.fn(async () => undefined);
  const readText = vi.fn(async () => "Pasted from clipboard");
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText, readText },
    configurable: true
  });

  const view = render(<App />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled()
  );

  return { ...view, fetchMock, writeText, readText };
}

describe("desktop console shortcuts and context-menu", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    window.localStorage.clear();
    useConnectionStore.getState().reset();
    usePromptStore.getState().reset();
    useRemoteSessionStore.getState().clear();
    vi.restoreAllMocks();
  });

  it("dispatches desktop keyboard shortcuts to the same console actions", async () => {
    const { fetchMock, writeText } = await renderConsole();
    fetchMock.mockClear();

    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    await waitForActionCycle(fetchMock, "/api/v1/input/hotkey");

    fetchMock.mockClear();
    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    await waitFor(() => expect(wasCalledWith(fetchMock, "/api/v1/project/diff/files")).toBe(true));
    await waitFor(() => expect(wasCalledWith(fetchMock, "/api/v1/project/diff/file")).toBe(true));
    expect(screen.getByTestId("desktop-diff-workspace")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("desktop-diff-search-input"), {
      target: { value: "app.tsx" }
    });
    expect(screen.getByText("src/App.tsx")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("desktop-diff-search-input"), {
      target: { value: "" }
    });
    fetchMock.mockClear();
    fireEvent.keyDown(window, { key: "ArrowDown" });
    await waitFor(() =>
      expect(wasCalledWith(fetchMock, "path=src%2FApp.tsx")).toBe(true)
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fetchMock.mockClear();
    fireEvent.keyDown(window, { key: "t", ctrlKey: true });
    await waitForActionCycle(fetchMock, "/api/v1/project/test-request");

    fetchMock.mockClear();
    fireEvent.keyDown(window, { key: "r", ctrlKey: true });
    await waitForActionCycle(fetchMock, "/api/v1/media/recording/start");

    fetchMock.mockClear();
    fireEvent.keyDown(window, { key: "S", ctrlKey: true, shiftKey: true });
    await waitForActionCycle(fetchMock, "/api/v1/media/screenshot");

    fireEvent.keyDown(window, { key: "C", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(writeText).toHaveBeenCalled());

    fetchMock.mockClear();
    fireEvent.keyDown(window, { key: "l", ctrlKey: true });
    await waitForActionCycle(fetchMock, "/api/v1/codex/focus");

    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    expect(screen.getByRole("button", { name: "Paste Prompt" })).toBeInTheDocument();

    fetchMock.mockClear();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(wasCalledWith(fetchMock, "/api/v1/input/key")).toBe(true)
    );

    fetchMock.mockClear();
    fireEvent.keyDown(window, { key: "F5" });
    await waitFor(() =>
      expect(screen.getByText("Stream reconnected.")).toBeInTheDocument()
    );
  });

  it("opens viewport context menu and routes menu actions", async () => {
    const { fetchMock, readText } = await renderConsole();
    fetchMock.mockClear();

    fireEvent.contextMenu(screen.getByTestId("desktop-viewport-shell"));
    expect(screen.getByRole("button", { name: "Paste Prompt" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask Codex to Explain" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Paste Prompt" }));
    await waitFor(() => expect(readText).toHaveBeenCalled());
    expect(screen.getByLabelText("Prompt Draft")).toHaveValue("Pasted from clipboard");

    fireEvent.contextMenu(screen.getByTestId("desktop-viewport-shell"));
    fireEvent.click(screen.getByRole("button", { name: "Ask Codex to Explain" }));
    expect((screen.getByLabelText("Prompt Draft") as HTMLTextAreaElement).value).toContain(
      "Please explain"
    );

    fetchMock.mockClear();
    fireEvent.contextMenu(screen.getByTestId("desktop-viewport-shell"));
    fireEvent.click(screen.getByRole("button", { name: "Take Screenshot" }));
    await waitFor(() =>
      expect(wasCalledWith(fetchMock, "/api/v1/media/screenshot")).toBe(true)
    );

    fireEvent.contextMenu(screen.getByTestId("desktop-viewport-shell"));
    fireEvent.click(screen.getByRole("button", { name: "Reconnect Stream" }));
    await waitFor(() =>
      expect(screen.getByText("Stream reconnected.")).toBeInTheDocument()
    );
  });

  it("persists sidebar and inspector widths", async () => {
    const firstRender = await renderConsole();

    expect(screen.getByTestId("desktop-sidebar-shell")).toHaveStyle({ width: "220px" });
    expect(screen.getByTestId("desktop-inspector-shell")).toHaveStyle({ width: "320px" });

    fireEvent.click(screen.getByRole("button", { name: "Grow sidebar" }));
    fireEvent.click(screen.getByRole("button", { name: "Shrink inspector" }));

    expect(window.localStorage.getItem("ceryx.desktop.console.sidebar-width")).toBe("244");
    expect(window.localStorage.getItem("ceryx.desktop.console.inspector-width")).toBe("296");

    firstRender.unmount();

    useConnectionStore.getState().reset();
    usePromptStore.getState().reset();
    useRemoteSessionStore.getState().clear();

    await renderConsole();
    expect(screen.getByTestId("desktop-sidebar-shell")).toHaveStyle({ width: "244px" });
    expect(screen.getByTestId("desktop-inspector-shell")).toHaveStyle({ width: "296px" });
  });

  it("opens logs workspace and loads paginated logs", async () => {
    const { fetchMock, writeText } = await renderConsole();
    fetchMock.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Logs Workspace" }));

    await waitFor(() => expect(wasCalledWith(fetchMock, "/api/v1/logs")).toBe(true));
    expect(screen.getByTestId("desktop-logs-workspace")).toBeInTheDocument();
    expect(screen.getByTestId("desktop-logs-virtualized-list")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy Visible" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
  });

  it("shows protocol hint and status-bar metrics when recording hits disk-low", async () => {
    const { fetchMock } = await renderConsole();
    const baseImpl = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/media/recording/start")) {
        return mockJson(
          {
            ok: false,
            error: {
              code: "E_DISK_LOW",
              message: "Recording stopped because disk space is low.",
              hint: "Free disk space before starting recording again.",
              traceId: "trace_disk_low_001"
            }
          },
          507
        );
      }

      if (!baseImpl) {
        return mockJson({ ok: true });
      }

      return baseImpl(input, init);
    });

    fireEvent.click(screen.getByRole("button", { name: "Record" }));

    await waitFor(() =>
      expect(
        screen.getByText(/Hint: Free disk space before starting recording again\./)
      ).toBeInTheDocument()
    );
    expect(screen.getAllByText("token: verified").length).toBeGreaterThan(0);
    expect(screen.getAllByText("recording: idle").length).toBeGreaterThan(0);
    expect(screen.getAllByText("fps: 30").length).toBeGreaterThan(0);
  });
});
