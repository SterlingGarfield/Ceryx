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

describe("desktop console files/tasks/notifications workspaces", () => {
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

  it("loads files, tasks, and notifications workspace states", async () => {
    writeDeviceToken(defaultLocalAgentBaseUrl, "desktop_token");
    let notificationsRead = false;

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
          status: "found",
          windowId: "win_001",
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
          windowId: null,
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
              path: "apps/desktop/src/App.tsx",
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
          recentPromptActions: [
            {
              id: "audit_prompt_01",
              action: "prompt.send.accepted",
              details: "submitted=true",
              severity: "info",
              sessionId: "dev_01",
              createdAt: "2026-05-22T06:02:00.000Z"
            }
          ],
          testRequest: {
            status: "accepted",
            requestId: "testreq_01",
            scope: "changed-modules",
            message: "Latest test request tracked from audit events.",
            requestedAt: "2026-05-22T06:02:00.000Z"
          }
        });
      }

      if (url.includes("/api/v1/notifications/clear")) {
        notificationsRead = true;
        return mockJson({ ok: true, clearedBefore: "2026-05-22T06:03:00.000Z" });
      }

      if (url.includes("/api/v1/notifications/audit_01/read")) {
        notificationsRead = true;
        return mockJson({ ok: true, id: "audit_01", read: true });
      }

      if (url.includes("/api/v1/notifications")) {
        return mockJson({
          ok: true,
          total: 1,
          unread: notificationsRead ? 0 : 1,
          items: [
            {
              id: "audit_01",
              title: "Test Request",
              message: "requestId=testreq_01;scope=changed-modules;status=accepted",
              severity: "info",
              createdAt: "2026-05-22T06:02:00.000Z",
              read: notificationsRead
            }
          ]
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
      expect(screen.getByRole("button", { name: "Files Workspace" })).toBeEnabled()
    );

    fireEvent.click(screen.getByRole("button", { name: "Files Workspace" }));
    await waitFor(() => expect(screen.getByTestId("desktop-files-workspace")).toBeInTheDocument());
    expect(screen.getByText("apps/desktop/src/App.tsx")).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("desktop-files-workspace")).getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: "Tasks Workspace" }));
    await waitFor(() => expect(screen.getByTestId("desktop-tasks-workspace")).toBeInTheDocument());
    expect(screen.getByText("Current Task")).toBeInTheDocument();
    expect(screen.getByText("prompt.send.accepted")).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("desktop-tasks-workspace")).getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: "Notifications Workspace" }));
    await waitFor(() =>
      expect(screen.getByTestId("desktop-notifications-workspace")).toBeInTheDocument()
    );
    expect(screen.getByText("Test Request")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark Read" }));
    await waitFor(() => expect(screen.getByText("unread 0")).toBeInTheDocument());
  });

  it("uploads, downloads, and deletes agent files from the files workspace", async () => {
    writeDeviceToken(defaultLocalAgentBaseUrl, "desktop_token");
    const uploadedFiles = [
      {
        fileId: "file_001",
        fileName: "notes.txt",
        sizeBytes: 12,
        mimeType: "text/plain",
        storedPath: "uploads/notes.txt",
        uploadedAt: "2026-05-22T06:04:00.000Z",
        targetPath: "uploads"
      }
    ];

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
          status: "found",
          windowId: "win_001",
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
          windowId: null,
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
              path: "apps/desktop/src/App.tsx",
              extension: "tsx",
              tracked: true,
              changed: true
            }
          ]
        });
      }

      if (url.includes("/api/v1/files/list")) {
        return mockJson({
          ok: true,
          path: "uploads",
          limit: 100,
          total: uploadedFiles.length,
          files: uploadedFiles
        });
      }

      if (url.endsWith("/api/v1/files/upload")) {
        const uploaded = {
          fileId: "file_002",
          fileName: "proposal.pdf",
          sizeBytes: 18,
          mimeType: "application/pdf",
          storedPath: "uploads/proposal.pdf",
          uploadedAt: "2026-05-22T06:05:00.000Z",
          targetPath: "docs/inbox"
        };
        uploadedFiles.unshift(uploaded);
        return mockJson({ ok: true, ...uploaded });
      }

      if (url.endsWith("/api/v1/files/download/file_001")) {
        return new Response("downloaded notes", {
          status: 200,
          headers: { "Content-Type": "text/plain" }
        });
      }

      if (url.endsWith("/api/v1/files/file_001") && init?.method === "DELETE") {
        const index = uploadedFiles.findIndex((file) => file.fileId === "file_001");
        if (index >= 0) {
          uploadedFiles.splice(index, 1);
        }
        return mockJson({ ok: true, deleted: true, fileId: "file_001" });
      }

      if (url.includes("/api/v1/project/tasks")) {
        return mockJson({
          ok: true,
          taskState: {
            status: "active",
            currentAction: "prompt.send.accepted",
            updatedAt: "2026-05-22T06:02:00.000Z"
          },
          recentPromptActions: [
            {
              id: "audit_prompt_01",
              action: "prompt.send.accepted",
              details: "submitted=true",
              severity: "info",
              sessionId: "dev_01",
              createdAt: "2026-05-22T06:02:00.000Z"
            }
          ],
          testRequest: {
            status: "accepted",
            requestId: "testreq_01",
            scope: "changed-modules",
            message: "Latest test request tracked from audit events.",
            requestedAt: "2026-05-22T06:02:00.000Z"
          }
        });
      }

      if (url.includes("/api/v1/notifications/clear")) {
        return mockJson({ ok: true, clearedBefore: "2026-05-22T06:03:00.000Z" });
      }

      if (url.includes("/api/v1/notifications/audit_01/read")) {
        return mockJson({ ok: true, id: "audit_01", read: true });
      }

      if (url.includes("/api/v1/notifications")) {
        return mockJson({
          ok: true,
          total: 1,
          unread: 1,
          items: [
            {
              id: "audit_01",
              title: "Test Request",
              message: "requestId=testreq_01;scope=changed-modules;status=accepted",
              severity: "info",
              createdAt: "2026-05-22T06:02:00.000Z",
              read: false
            }
          ]
        });
      }

      if (url.endsWith("/api/v1/prompt/send")) {
        return mockJson({ ok: true, status: "sent", submitted: true });
      }

      return mockJson({ ok: true });
    });

    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(window.URL, "createObjectURL", {
      value: vi.fn(() => "blob:download"),
      configurable: true
    });
    Object.defineProperty(window.URL, "revokeObjectURL", {
      value: vi.fn(),
      configurable: true
    });

    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Files Workspace" })).toBeEnabled()
    );

    fireEvent.click(screen.getByRole("button", { name: "Files Workspace" }));
    await waitFor(() => expect(screen.getByTestId("desktop-files-workspace")).toBeInTheDocument());
    expect(screen.getByText("Agent File Transfers")).toBeInTheDocument();
    expect(screen.getByText("notes.txt")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Transfer file input"), {
      target: {
        files: [new File(["proposal body"], "proposal.pdf", { type: "application/pdf" })]
      }
    });
    fireEvent.change(screen.getByLabelText("Transfer target path"), {
      target: { value: "docs/inbox" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload File" }));

    await waitFor(() => expect(screen.getByText("proposal.pdf")).toBeInTheDocument());

    const fileRow = screen.getByTestId("desktop-agent-file-file_001");
    fireEvent.click(within(fileRow).getByRole("button", { name: "Download" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/v1/files/download/file_001"))).toBe(true)
    );

    fireEvent.click(within(fileRow).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByText("notes.txt")).not.toBeInTheDocument());
  });
});
