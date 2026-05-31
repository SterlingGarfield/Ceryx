import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

describe("desktop console settings workspace", () => {
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
  });

  it("requires high-risk confirmation before patching guarded agent settings", async () => {
    writeDeviceToken(defaultLocalAgentBaseUrl, "desktop_token");
    let patchAttempts = 0;
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
          title: "Codex",
          status: "found",
          processName: "Codex.exe",
          bounds: { x: 40, y: 60, width: 1366, height: 768 },
          lastSeenAt: "2026-05-22T01:00:00.000Z"
        });
      }

      if (url.endsWith("/api/v1/capture/state")) {
        return mockJson({
          ok: true,
          active: false,
          paused: false,
          mode: "balanced",
          windowId: null,
          width: 1366,
          height: 768
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
            keyboardShortcuts: true,
            notificationsEnabled: true,
            logsAutoRefresh: true,
            previewRefreshProfile: "balanced"
          }
        });
      }

      if (url.endsWith("/api/v1/settings") && init?.method === "PATCH") {
        patchAttempts += 1;
        const body = JSON.parse(String(init.body ?? "{}")) as {
          confirmHighRisk?: boolean;
        };
        if (!body.confirmHighRisk) {
          return mockJson(
            {
              ok: false,
              error: {
                code: "E_SETTINGS_CONFIRM_REQUIRED",
                message: "High-risk settings require confirmHighRisk=true.",
                hint: "High-risk keys: httpPort",
                traceId: "trace-test"
              }
            },
            409
          );
        }

        return mockJson({
          ok: true,
          updatedAt: "2026-05-22T01:12:00.000Z",
          agentSettings: {
            httpPort: 41528,
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
            previewRefreshProfile: "balanced"
          }
        });
      }

      if (url.endsWith("/api/v1/prompt/send")) {
        return mockJson({ ok: true, queued: true });
      }

      return mockJson({ ok: true });
    });

    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(), readText: vi.fn(async () => "") },
      configurable: true
    });

    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Settings Workspace" })).toBeEnabled()
    );

    fireEvent.click(screen.getByRole("button", { name: "Settings Workspace" }));
    await waitFor(() => expect(screen.getByTestId("desktop-settings-workspace")).toBeInTheDocument());
    const workspace = screen.getByTestId("desktop-settings-workspace");
    fireEvent.click(within(workspace).getByRole("button", { name: "Agent" }));
    await waitFor(() => expect(within(workspace).getByDisplayValue("41527")).toBeInTheDocument());

    fireEvent.change(within(workspace).getByDisplayValue("41527"), { target: { value: "41528" } });
    fireEvent.click(within(workspace).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(within(workspace).getByText("High-risk change confirmation required")).toBeInTheDocument()
    );
    fireEvent.click(within(workspace).getByRole("button", { name: "Confirm and Save" }));

    await waitFor(() => expect(within(workspace).getByText("Settings saved.")).toBeInTheDocument());
    expect(patchAttempts).toBe(2);

    const patchCalls = fetchMock.mock.calls.filter(
      ([input, init]) => String(input).endsWith("/api/v1/settings") && init?.method === "PATCH"
    );
    const latestBody = JSON.parse(String(patchCalls.at(-1)?.[1]?.body ?? "{}")) as {
      confirmHighRisk?: boolean;
      agentSettings?: { httpPort?: number };
    };
    expect(latestBody.confirmHighRisk).toBe(true);
    expect(latestBody.agentSettings?.httpPort).toBe(41528);
  });
});
