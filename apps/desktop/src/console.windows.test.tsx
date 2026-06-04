import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionStore, usePromptStore, useRemoteSessionStore } from "@ceryx/feature-remote-control";
import { App } from "./App";
import { defaultLocalAgentBaseUrl } from "./platform/desktop/agentGateway";
import { writeDeviceToken } from "./platform/desktop/tokenVault";

function mockJson(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function mockImage(): Response {
  return new Response(new Blob(["desktop-window-preview"], { type: "image/png" }), {
    status: 200,
    headers: { "Content-Type": "image/png" }
  });
}

describe("desktop console window switching", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    window.history.pushState({}, "", "/console");
    window.localStorage.clear();
    useConnectionStore.getState().reset();
    usePromptStore.getState().reset();
    useRemoteSessionStore.getState().clear();
    vi.restoreAllMocks();

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => `blob:preview-${Math.random().toString(36).slice(2)}`)
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn()
    });
  });

  it("lists windows, renders previews, and switches capture to the selected window", async () => {
    writeDeviceToken(defaultLocalAgentBaseUrl, "desktop_token");
    let selectedWindowId: string | null = null;
    let captureStartWindowId: string | null = null;
    let currentCaptureWindowId = "w001";

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
          status: "focused",
          windowId: "w001",
          title: "Codex A",
          processName: "Codex.exe",
          candidateCount: 2,
          lastUpdatedAt: "2026-06-04T00:00:00.000Z"
        });
      }

      if (url.endsWith("/api/v1/codex/windows")) {
        return mockJson({
          windows: [
            {
              status: "focused",
              windowId: "w001",
              title: "Codex A",
              processName: "Codex.exe",
              candidateCount: 2,
              lastUpdatedAt: "2026-06-04T00:00:00.000Z"
            },
            {
              status: "found",
              windowId: "w002",
              title: "Codex B",
              processName: "Codex.exe",
              candidateCount: 2,
              lastUpdatedAt: "2026-06-04T00:00:00.000Z"
            }
          ]
        });
      }

      if (url.endsWith("/api/v1/capture/state")) {
        return mockJson({
          ok: true,
          active: true,
          paused: false,
          mode: "balanced",
          windowId: currentCaptureWindowId,
          width: 1280,
          height: 720,
          frameRate: 30
        });
      }

      if (url.includes("/api/v1/capture/frame")) {
        return mockImage();
      }

      if (url.endsWith("/api/v1/codex/select-window")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { windowId?: string };
        selectedWindowId = body.windowId ?? null;
        return mockJson({
          status: "focused",
          windowId: body.windowId ?? null,
          title: body.windowId === "w002" ? "Codex B" : "Codex A",
          processName: "Codex.exe",
          candidateCount: 2,
          lastUpdatedAt: "2026-06-04T00:00:01.000Z"
        });
      }

      if (url.endsWith("/api/v1/capture/start")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { windowId?: string };
        captureStartWindowId = body.windowId ?? null;
        currentCaptureWindowId = body.windowId ?? currentCaptureWindowId;
        return mockJson({
          ok: true,
          active: true,
          paused: false,
          mode: "balanced",
          windowId: body.windowId ?? "w001",
          width: 1280,
          height: 720,
          frameRate: 30
        });
      }

      if (url.endsWith("/api/v1/media/recordings?limit=100")) {
        return mockJson({ ok: true, total: 0, items: [] });
      }

      if (url.endsWith("/api/v1/settings")) {
        return mockJson({
          ok: true,
          updatedAt: "2026-06-04T00:00:00.000Z",
          agentSettings: {
            httpPort: 41527,
            directTestCommand: "dotnet test agent/windows/Ceryx.Agent.Windows.sln",
            allowFullscreenCapture: false,
            allowClearLogs: false,
            defaultCaptureMode: "balanced"
          },
          clientSettings: {
            theme: "system",
            compactMode: false,
            showLatency: true,
            lockLocalInputWhenCapturing: true,
            keyboardShortcuts: true,
            notificationsEnabled: true,
            logsAutoRefresh: true,
            previewRefreshProfile: "balanced",
            viewportTransport: "polling"
          }
        });
      }

      return mockJson({ ok: true });
    });

    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(), readText: vi.fn(async () => "") },
      configurable: true
    });

    render(<App />);

    await waitFor(() => expect(screen.getByText("Codex Window Tabs")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("tab", { name: "Codex A" })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByAltText("Codex B active preview")).toBeInTheDocument());
    expect(screen.getByText("input lock: on")).toBeInTheDocument();
    expect(screen.getByLabelText("Prompt Draft")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Copy from Windows" })).toBeDisabled();

    fireEvent.click(screen.getByRole("tab", { name: "Codex B" }));

    await waitFor(() => expect(selectedWindowId).toBe("w002"));
    await waitFor(() => expect(captureStartWindowId).toBe("w002"));
    await waitFor(() => expect(screen.getByAltText("Codex A active preview")).toBeInTheDocument());
  });
});
