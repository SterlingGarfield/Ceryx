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

describe("iPad routes", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    window.history.pushState({}, "", "/launch");
    window.localStorage.clear();
    useConnectionStore.getState().reset();
    usePairingStore.getState().reset();
    usePromptStore.getState().reset();
    useRemoteSessionStore.getState().clear();

    vi.restoreAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/v1/health")) {
          return mockJson({ ok: true, service: "ceryx-agent", version: "0.3.0" });
        }

        if (url.endsWith("/api/v1/agent/status")) {
          return mockJson(
            {
              ok: false,
              error: {
                code: "E_NOT_PAIRED",
                message: "not paired"
              }
            },
            401
          );
        }

        if (url.endsWith("/api/v1/devices")) {
          return mockJson([]);
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
  });

  it("renders launch route and navigates to connections", async () => {
    window.history.pushState({}, "", "/launch");
    render(<App />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Ceryx iPad Launch" })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Go to Connections" }));

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: "Connections" })
      ).toBeInTheDocument()
    );
  });

  it("renders required sections in connections route", async () => {
    window.history.pushState({}, "", "/connections");
    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2, name: "Trusted Devices" })).toBeInTheDocument()
    );
    expect(screen.getByRole("heading", { level: 2, name: "Discovered Agents" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Manual IP Fallback" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Local Network Permission" })
    ).toBeInTheDocument();
  });

  it("renders six-digit code inputs on pair route", () => {
    window.history.pushState({}, "", "/pair/http%3A%2F%2F127.0.0.1%3A41527");
    render(<App />);

    for (let index = 1; index <= 6; index += 1) {
      expect(screen.getByLabelText(`code-digit-${index}`)).toBeInTheDocument();
    }
  });

  it("renders live console with ipad permission boundaries", async () => {
    writeDeviceToken("http://127.0.0.1:41527", "ipad_token");
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
    useConnectionStore.getState().setCurrentDevice({
      deviceId: "device:http://127.0.0.1:41527",
      deviceName: "Windows Agent",
      platform: "windows",
      baseUrl: "http://127.0.0.1:41527"
    });
    window.history.pushState({}, "", "/console");
    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: "Live Console" })).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "Screenshot" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Test" })).toBeDisabled();
  });
});
