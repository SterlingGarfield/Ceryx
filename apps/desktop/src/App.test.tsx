import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useConnectionStore,
  usePromptStore,
  useRemoteSessionStore
} from "@ceryx/feature-remote-control";
import { App } from "./App";
import { clearDeviceToken, writeDeviceToken } from "./platform/desktop/tokenVault";
import { defaultLocalAgentBaseUrl } from "./platform/desktop/agentGateway";

function mockJson(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("desktop home", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    window.history.pushState({}, "", "/");
    window.localStorage.clear();
    useConnectionStore.getState().reset();
    usePromptStore.getState().reset();
    useRemoteSessionStore.getState().clear();
    delete window.__CERYX_DESKTOP__;
    vi.restoreAllMocks();
  });

  it("shows Start Agent when local agent is offline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/v1/health")) {
          throw new Error("offline");
        }

        return mockJson({ ok: true });
      })
    );

    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Start Agent" })).toBeInTheDocument()
    );
  });

  it("shows Restart Agent and Open Logs Folder when local agent is running", async () => {
    writeDeviceToken(defaultLocalAgentBaseUrl, "desktop_token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
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

        if (url.endsWith("/api/v1/devices")) {
          return mockJson([]);
        }

        return mockJson({ ok: true });
      })
    );

    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Restart Agent" })).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "Open Logs Folder" })).toBeInTheDocument();
    clearDeviceToken(defaultLocalAgentBaseUrl);
  });

  it("separates local and remote agent rows", async () => {
    writeDeviceToken(defaultLocalAgentBaseUrl, "desktop_token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
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

        if (url.endsWith("/api/v1/devices")) {
          return mockJson([
            {
              id: "dev_001",
              name: "Studio iPad",
              platform: "ios",
              permissions: ["view_window"],
              autoConnect: true,
              createdAt: "2026-05-20T01:00:00.000Z",
              lastConnectedAt: "2026-05-21T01:00:00.000Z"
            }
          ]);
        }

        return mockJson({ ok: true });
      })
    );

    render(<App />);

    await waitFor(() => expect(screen.getByText("Remote Agents")).toBeInTheDocument());
    expect(screen.getAllByText("Local Agent").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Studio iPad").length).toBeGreaterThan(0);
    clearDeviceToken(defaultLocalAgentBaseUrl);
  });

  it("sorts remote agents by selected order", async () => {
    writeDeviceToken(defaultLocalAgentBaseUrl, "desktop_token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
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

        if (url.endsWith("/api/v1/devices")) {
          return mockJson([
            {
              id: "dev_002",
              name: "Zeta Desktop",
              platform: "windows",
              permissions: ["view_window"],
              autoConnect: true,
              createdAt: "2026-05-20T01:00:00.000Z",
              lastConnectedAt: "2026-05-21T08:00:00.000Z",
              latencyMs: 35,
              status: "trusted"
            },
            {
              id: "dev_001",
              name: "Alpha iPad",
              platform: "ios",
              permissions: ["view_window"],
              autoConnect: true,
              createdAt: "2026-05-18T01:00:00.000Z",
              lastConnectedAt: "2026-05-19T08:00:00.000Z",
              latencyMs: 20,
              status: "trusted"
            }
          ]);
        }

        return mockJson({ ok: true });
      })
    );

    render(<App />);

    await waitFor(() =>
      expect(screen.getAllByTestId("remote-agent-name").length).toBe(2)
    );
    fireEvent.change(screen.getByLabelText("Sort remote agents"), {
      target: { value: "name" }
    });

    const names = screen
      .getAllByTestId("remote-agent-name")
      .map((element) => element.textContent?.trim());

    expect(names).toEqual(["Alpha iPad", "Zeta Desktop"]);
    clearDeviceToken(defaultLocalAgentBaseUrl);
  });

  it("renders desktop live console with local control actions", async () => {
    window.history.pushState({}, "", "/console");
    writeDeviceToken(defaultLocalAgentBaseUrl, "desktop_token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
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
            height: 900
          });
        }

        return mockJson({ ok: true });
      })
    );

    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled()
    );
    expect(screen.getByRole("button", { name: "Test" })).toBeEnabled();
    expect(screen.getAllByText("Inspector").length).toBeGreaterThan(0);
    clearDeviceToken(defaultLocalAgentBaseUrl);
  });
});
