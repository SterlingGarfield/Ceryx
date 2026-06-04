import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

describe("ipad console settings sheet", () => {
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

  it("saves client settings locally through grouped settings sheet", async () => {
    const baseUrl = "http://127.0.0.1:41527";
    writeDeviceToken(baseUrl, "ipad_token");
    useConnectionStore.getState().setCurrentDevice({
      deviceId: `device:${baseUrl}`,
      deviceName: "Windows Agent",
      platform: "windows",
      baseUrl
    });
    window.history.pushState({}, "", "/console");

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

      if (url.endsWith("/api/v1/settings") && (!init?.method || init.method === "GET")) {
        return mockJson({
          ok: true,
          updatedAt: "2026-05-22T01:10:00.000Z",
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
            clipboardAutoSync: false,
            lockLocalInputWhenCapturing: true,
            keyboardShortcuts: true,
            notificationsEnabled: true,
            logsAutoRefresh: true,
            previewRefreshProfile: "balanced"
          }
        });
      }

      if (url.endsWith("/api/v1/settings") && init?.method === "PATCH") {
        return mockJson({
          ok: true,
          updatedAt: "2026-05-22T01:12:00.000Z",
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
            clipboardAutoSync: false,
            lockLocalInputWhenCapturing: false,
            keyboardShortcuts: true,
            notificationsEnabled: true,
            logsAutoRefresh: true,
            previewRefreshProfile: "balanced"
          }
        });
      }

      if (url.endsWith("/api/v1/prompt/send")) {
        return mockJson({ ok: true, status: "queued", submitted: true });
      }

      return mockJson({ ok: true, url, init });
    });

    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(), readText: vi.fn(async () => "") },
      configurable: true
    });

    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: "Live Console" })).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: "Settings Sheet" }));
    await waitFor(() => expect(screen.getByTestId("ipad-settings-sheet")).toBeInTheDocument());
    const settingsSheet = screen.getByTestId("ipad-settings-sheet");
    await waitFor(() => expect(within(settingsSheet).getByDisplayValue("system")).toBeInTheDocument());
    expect(within(settingsSheet).getByText("input lock: on")).toBeInTheDocument();
    fireEvent.click(within(settingsSheet).getByRole("button", { name: "Unlock Input" }));
    fireEvent.change(within(settingsSheet).getByDisplayValue("system"), {
      target: { value: "dark" }
    });
    fireEvent.click(within(settingsSheet).getByRole("checkbox", { name: "Auto-sync clipboard to Windows" }));
    fireEvent.click(within(settingsSheet).getByRole("button", { name: "Save Settings" }));
    await waitFor(() =>
      expect(within(settingsSheet).getByText("Client settings saved locally.")).toBeInTheDocument()
    );
    const persisted = window.localStorage.getItem("ceryx.ipad.client-settings.v1");
    expect(persisted).toContain("\"theme\":\"dark\"");
    expect(persisted).toContain("\"clipboardAutoSync\":true");
    expect(persisted).toContain("\"lockLocalInputWhenCapturing\":false");
  });

  it("persists gesture profile edits locally through the settings sheet", async () => {
    const baseUrl = "http://127.0.0.1:41527";
    writeDeviceToken(baseUrl, "ipad_token");
    useConnectionStore.getState().setCurrentDevice({
      deviceId: `device:${baseUrl}`,
      deviceName: "Windows Agent",
      platform: "windows",
      baseUrl
    });
    window.history.pushState({}, "", "/console");

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

      if (url.endsWith("/api/v1/settings") && (!init?.method || init.method === "GET")) {
        return mockJson({
          ok: true,
          updatedAt: "2026-05-22T01:10:00.000Z",
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
            clipboardAutoSync: false,
            keyboardShortcuts: true,
            notificationsEnabled: true,
            logsAutoRefresh: true,
            activeGestureProfile: "default",
            previewRefreshProfile: "balanced"
          }
        });
      }

      if (url.endsWith("/api/v1/settings") && init?.method === "PATCH") {
        return mockJson({
          ok: true,
          updatedAt: "2026-05-22T01:12:00.000Z",
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
            clipboardAutoSync: false,
            keyboardShortcuts: true,
            notificationsEnabled: true,
            logsAutoRefresh: true,
            activeGestureProfile: "custom",
            previewRefreshProfile: "balanced"
          }
        });
      }

      if (url.endsWith("/api/v1/prompt/send")) {
        return mockJson({ ok: true, status: "queued", submitted: true });
      }

      return mockJson({ ok: true, url, init });
    });

    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(), readText: vi.fn(async () => "") },
      configurable: true
    });

    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: "Live Console" })).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: "Settings Sheet" }));
    await waitFor(() => expect(screen.getByTestId("ipad-settings-sheet")).toBeInTheDocument());
    const settingsSheet = screen.getByTestId("ipad-settings-sheet");
    fireEvent.click(within(settingsSheet).getByRole("button", { name: "Gestures" }));
    await waitFor(() =>
      expect(within(settingsSheet).getByLabelText("Single-finger drag sensitivity")).toBeInTheDocument()
    );

    fireEvent.change(within(settingsSheet).getByLabelText("Single-finger drag sensitivity"), {
      target: { value: "1.5" }
    });
    fireEvent.click(within(settingsSheet).getByRole("button", { name: "Save Settings" }));
    await waitFor(() =>
      expect(within(settingsSheet).getByText("Client settings saved locally.")).toBeInTheDocument()
    );

    const persisted = window.localStorage.getItem("ceryx.ipad.client-settings.v1");
    expect(persisted).toContain("\"activeGestureProfile\":\"custom\"");
    expect(persisted).toContain("\"sensitivity\":1.5");
  });
});
