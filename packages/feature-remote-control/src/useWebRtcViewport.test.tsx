import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWebRtcViewport } from "./useWebRtcViewport";

function TestHook(props: {
  enabled: boolean;
  transport: "webrtc" | "polling";
  sendSignal: (request: { sessionId: string; type: string; sdp?: string }) => Promise<{ ok: boolean; status: string; sdp?: string }>;
  onFallback: (message: string) => void;
}) {
  const state = useWebRtcViewport({
    enabled: props.enabled,
    sessionKey: "session-1",
    transport: props.transport,
    sendSignal: props.sendSignal as never,
    onFallback: props.onFallback
  });

  return (
    <div>
      <div data-testid="phase">{state.phase}</div>
      <div data-testid="error">{state.errorMessage}</div>
    </div>
  );
}

describe("useWebRtcViewport", () => {
  const fallback = vi.fn();

  beforeEach(() => {
    fallback.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("stays idle when transport is polling", async () => {
    render(
      <TestHook
        enabled
        transport="polling"
        sendSignal={async () => ({ ok: true, status: "accepted" })}
        onFallback={fallback}
      />
    );

    await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("idle"));
    expect(fallback).not.toHaveBeenCalled();
  });

  it("falls back when browser does not support WebRTC", async () => {
    vi.stubGlobal("window", {} as Window & typeof globalThis);

    render(
      <TestHook
        enabled
        transport="webrtc"
        sendSignal={async () => ({ ok: true, status: "accepted" })}
        onFallback={fallback}
      />
    );

    await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("degraded"));
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
