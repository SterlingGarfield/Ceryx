import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useConnectionStore,
  usePairingStore
} from "@ceryx/feature-remote-control";
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
    useConnectionStore.getState().reset();
    usePairingStore.getState().reset();

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
});
