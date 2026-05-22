import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

describe("ipad console files/tasks/notifications sheets", () => {
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

  it("renders files/tasks/notifications sheet flows", async () => {
    const baseUrl = "http://127.0.0.1:41527";
    writeDeviceToken(baseUrl, "ipad_token");
    useConnectionStore.getState().setCurrentDevice({
      deviceId: `device:${baseUrl}`,
      deviceName: "Windows Agent",
      platform: "windows",
      baseUrl
    });
    window.history.pushState({}, "", "/console");

    let notificationsRead = false;
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
          lastUpdatedAt: "2026-05-22T06:00:00.000Z"
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

      if (url.includes("/api/v1/project/files")) {
        return mockJson({
          ok: true,
          projectId: "workspace-default",
          projectName: "CeryxProject",
          generatedAt: "2026-05-22T06:01:00.000Z",
          files: [
            {
              path: "apps/ipad/src/routes/ConsoleRoute.tsx",
              extension: "tsx",
              tracked: true,
              changed: true
            }
          ]
        });
      }

      if (url.includes("/api/v1/project/tasks")) {
        return mockJson({
          ok: true,
          taskState: {
            status: "active",
            currentAction: "prompt.send.accepted",
            updatedAt: "2026-05-22T06:02:00.000Z"
          },
          recentPromptActions: [],
          testRequest: {
            status: "accepted",
            requestId: "testreq_01",
            scope: "changed-modules",
            message: "Latest test request tracked from audit events.",
            requestedAt: "2026-05-22T06:02:00.000Z"
          }
        });
      }

      if (url.includes("/api/v1/notifications/audit_01/read")) {
        notificationsRead = true;
        return mockJson({ ok: true, id: "audit_01", read: true });
      }

      if (url.includes("/api/v1/notifications/clear")) {
        notificationsRead = true;
        return mockJson({ ok: true, clearedBefore: "2026-05-22T06:03:00.000Z" });
      }

      if (url.includes("/api/v1/notifications")) {
        return mockJson({
          ok: true,
          total: 1,
          unread: notificationsRead ? 0 : 1,
          items: [
            {
              id: "audit_01",
              title: "Prompt Action",
              message: "submitted=true",
              severity: "info",
              createdAt: "2026-05-22T06:02:00.000Z",
              read: notificationsRead
            }
          ]
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
            logsAutoRefresh: true
          }
        });
      }

      if (url.endsWith("/api/v1/prompt/send")) {
        return mockJson({ ok: true, status: "sent", submitted: true });
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
      expect(screen.getByRole("heading", { level: 1, name: "Live Console" })).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: "Files Sheet" }));
    await waitFor(() => expect(screen.getByTestId("ipad-files-workspace")).toBeInTheDocument());
    expect(screen.getByText("apps/ipad/src/routes/ConsoleRoute.tsx")).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("ipad-files-workspace")).getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: "Tasks Sheet" }));
    await waitFor(() => expect(screen.getByTestId("ipad-tasks-workspace")).toBeInTheDocument());
    expect(screen.getByText("Current Task")).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("ipad-tasks-workspace")).getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: "Notifications Sheet" }));
    await waitFor(() => expect(screen.getByTestId("ipad-notifications-workspace")).toBeInTheDocument());
    expect(screen.getByText("Prompt Action")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark Read" }));
    await waitFor(() => expect(screen.getByText("unread 0")).toBeInTheDocument());
  });
});
