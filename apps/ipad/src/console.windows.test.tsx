import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useConnectionStore,
  usePairingStore,
  usePromptStore,
  useRemoteSessionStore
} from "@ceryx/feature-remote-control";
import { App } from "./App";
import { writeDeviceToken } from "./platform/ipad/tokenVault";

function mockJson(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function mockImage(): Response {
  return new Response(new Blob(["ipad-window-preview"], { type: "image/png" }), {
    status: 200,
    headers: { "Content-Type": "image/png" }
  });
}

describe("ipad console window switching", () => {
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

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => `blob:preview-${Math.random().toString(36).slice(2)}`)
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn()
    });
  });

  it("renders the window list and switches to the selected window", async () => {
    const baseUrl = "http://127.0.0.1:41527";
    writeDeviceToken(baseUrl, "ipad_token");
    useConnectionStore.getState().setCurrentDevice({
      deviceId: `device:${baseUrl}`,
      deviceName: "Windows Agent",
      platform: "windows",
      baseUrl
    });
    window.history.pushState({}, "", "/console");

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
          deviceName: "Windows Agent",
          platform: "windows",
          status: "running",
          httpPort: 41527,
          supportsWebRTC: true,
          supportsDesktopClient: true,
          codexStatus: "found"
        });
      }

      if (url.endsWith("/api/v1/agent/connection-stats")) {
        return mockJson({
          ok: true,
          observedAt: "2026-06-05T01:00:00.000Z",
          connectedSince: "2026-06-05T00:30:00.000Z",
          activeViewers: 2,
          viewportStats: {
            currentTier: "high",
            resolution: "1920x1080",
            fps: 30,
            bitrateKbps: 4500,
            packetsLost: 0,
            packetsSent: 420,
            packetLossPercent: 0,
            roundTripTimeMs: 4,
            jitterMs: 1.2
          },
          agentStats: {
            cpuPercent: 5.2,
            memoryMB: 180,
            uptimeSeconds: 3600
          }
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
            keyboardShortcuts: true,
            notificationsEnabled: true,
            logsAutoRefresh: true,
            lockLocalInputWhenCapturing: true,
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

    await waitFor(() => expect(screen.getByText("Codex Windows")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: /Codex A/ })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByAltText("Codex A preview")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByAltText("Codex B preview")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByAltText("Codex B active preview")).toBeInTheDocument());
    expect(screen.getByText("Input lock: on")).toBeInTheDocument();
    expect(screen.getByLabelText("Prompt Draft")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Copy from Windows" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Codex B/ }));

    await waitFor(() => expect(selectedWindowId).toBe("w002"));
    await waitFor(() => expect(captureStartWindowId).toBe("w002"));
    await waitFor(() => expect(screen.getByAltText("Codex A active preview")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Connection quality")).toBeInTheDocument());
    expect(screen.getByText("2 viewers")).toBeInTheDocument();
  });

  it("falls back to the remaining window after the active window closes", async () => {
    const baseUrl = "http://127.0.0.1:41527";
    writeDeviceToken(baseUrl, "ipad_token");
    useConnectionStore.getState().setCurrentDevice({
      deviceId: `device:${baseUrl}`,
      deviceName: "Windows Agent",
      platform: "windows",
      baseUrl
    });
    window.history.pushState({}, "", "/console");

    let selectedWindowId: string | null = null;
    let captureStartWindowId: string | null = null;
    let windowListPhase = 0;
    let currentCaptureWindowId = "w002";

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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

      if (url.endsWith("/api/v1/agent/connection-stats")) {
        return mockJson({
          ok: true,
          observedAt: "2026-06-05T01:00:00.000Z",
          connectedSince: "2026-06-05T00:30:00.000Z",
          activeViewers: 2,
          viewportStats: {
            currentTier: "high",
            resolution: "1920x1080",
            fps: 30,
            bitrateKbps: 4500,
            packetsLost: 0,
            packetsSent: 420,
            packetLossPercent: 0,
            roundTripTimeMs: 4,
            jitterMs: 1.2
          },
          agentStats: {
            cpuPercent: 5.2,
            memoryMB: 180,
            uptimeSeconds: 3600
          }
        });
      }

      if (url.endsWith("/api/v1/codex/window")) {
        return mockJson({
          status: "focused",
          windowId: currentCaptureWindowId,
          title: currentCaptureWindowId === "w002" ? "Codex B" : "Codex A",
          processName: "Codex.exe",
          candidateCount: 2,
          lastUpdatedAt: "2026-06-04T00:00:00.000Z"
        });
      }

      if (url.endsWith("/api/v1/codex/windows")) {
        if (windowListPhase === 0) {
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

        return mockJson({
          windows: [
            {
              status: "focused",
              windowId: "w001",
              title: "Codex A",
              processName: "Codex.exe",
              candidateCount: 1,
              lastUpdatedAt: "2026-06-04T00:00:01.000Z"
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
        currentCaptureWindowId = body.windowId ?? currentCaptureWindowId;
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
          windowId: body.windowId ?? "w002",
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
            keyboardShortcuts: true,
            notificationsEnabled: true,
            logsAutoRefresh: true,
            lockLocalInputWhenCapturing: true,
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

    await waitFor(() => expect(screen.getByRole("button", { name: /Codex A/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Codex B/ }));

    await waitFor(() => expect(selectedWindowId).toBe("w002"));
    await waitFor(() => expect(captureStartWindowId).toBe("w002"));
    await waitFor(() => expect(screen.getByText("active: w002")).toBeInTheDocument());

    windowListPhase = 1;
    fireEvent.click(screen.getByRole("button", { name: "Refresh Windows" }));

    await waitFor(() => expect(screen.getByText("active: w001")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Codex B/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Codex A/ })).toBeInTheDocument();
  });
});
