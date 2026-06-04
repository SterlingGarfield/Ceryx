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
    vi.stubGlobal("RTCPeerConnection", undefined as unknown as typeof RTCPeerConnection);

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

  it("falls back when signaling response does not include SDP answer", async () => {
    class FakePeerConnection {
      onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
      ontrack: ((event: RTCTrackEvent) => void) | null = null;
      onconnectionstatechange: (() => void) | null = null;
      connectionState: RTCPeerConnectionState = "new";

      addTransceiver() {}
      async createOffer() {
        return { type: "offer", sdp: "v=0" } as RTCSessionDescriptionInit;
      }
      async setLocalDescription() {}
      async setRemoteDescription() {}
      async addIceCandidate() {}
      async getStats() {
        return new Map();
      }
      close() {}
    }

    vi.stubGlobal("RTCPeerConnection", FakePeerConnection as unknown as typeof RTCPeerConnection);

    render(
      <TestHook
        enabled
        transport="webrtc"
        sendSignal={async () => ({ ok: true, status: "accepted" })}
        onFallback={fallback}
      />
    );

    await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("degraded"));
    expect(screen.getByTestId("error").textContent).toContain("Missing SDP answer");
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("falls back when connection is established without a remote video track", async () => {
    vi.useFakeTimers();
    try {
      class FakePeerConnection {
        onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
        ontrack: ((event: RTCTrackEvent) => void) | null = null;
        onconnectionstatechange: (() => void) | null = null;
        connectionState: RTCPeerConnectionState = "new";

        addTransceiver() {}
        async createOffer() {
          return { type: "offer", sdp: "v=0" } as RTCSessionDescriptionInit;
        }
        async setLocalDescription() {}
        async setRemoteDescription() {
          this.connectionState = "connected";
          this.onconnectionstatechange?.();
        }
        async addIceCandidate() {}
        async getStats() {
          return new Map();
        }
        close() {}
      }

      vi.stubGlobal("RTCPeerConnection", FakePeerConnection as unknown as typeof RTCPeerConnection);

      render(
        <TestHook
          enabled
          transport="webrtc"
          sendSignal={async () => ({ ok: true, status: "accepted", sdp: "v=0" })}
          onFallback={fallback}
        />
      );

      await vi.advanceTimersByTimeAsync(5100);
      await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("degraded"));
      expect(screen.getByTestId("error").textContent).toContain("no video track arrived");
      expect(fallback).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reconnects after a transient disconnect and returns to live", async () => {
    const instances: Array<FakePeerConnection> = [];

    class FakePeerConnection {
      onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
      ontrack: ((event: RTCTrackEvent) => void) | null = null;
      onconnectionstatechange: (() => void) | null = null;
      connectionState: RTCPeerConnectionState = "new";

      constructor() {
        instances.push(this);
      }

      addTransceiver() {}
      async createOffer() {
        return { type: "offer", sdp: "v=0" } as RTCSessionDescriptionInit;
      }
      async setLocalDescription() {}
      async setRemoteDescription() {
        if (instances[0] === this) {
          this.connectionState = "disconnected";
          this.onconnectionstatechange?.();
          return;
        }

        this.connectionState = "connected";
        this.onconnectionstatechange?.();
        this.ontrack?.({ streams: [{} as MediaStream] } as RTCTrackEvent);
      }
      async addIceCandidate() {}
      async getStats() {
        return new Map();
      }
      close() {}
    }

    vi.stubGlobal("RTCPeerConnection", FakePeerConnection as unknown as typeof RTCPeerConnection);

    render(
      <TestHook
        enabled
        transport="webrtc"
        sendSignal={async () => ({ ok: true, status: "accepted", sdp: "v=0" })}
        onFallback={fallback}
      />
    );

    await waitFor(() => expect(instances.length).toBe(2));
    await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("live"));
    expect(fallback).not.toHaveBeenCalled();
  });

  it("renegotiates when performance feedback requests a new offer", async () => {
    const remoteDescriptions: RTCSessionDescriptionInit[] = [];

    class FakePeerConnection {
      onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
      ontrack: ((event: RTCTrackEvent) => void) | null = null;
      onconnectionstatechange: (() => void) | null = null;
      connectionState: RTCPeerConnectionState = "new";

      addTransceiver() {}
      async createOffer() {
        return { type: "offer", sdp: "v=0 offer" } as RTCSessionDescriptionInit;
      }
      async createAnswer() {
        return { type: "answer", sdp: "v=0 renegotiated-answer" } as RTCSessionDescriptionInit;
      }
      async setLocalDescription() {}
      async setRemoteDescription(description: RTCSessionDescriptionInit) {
        remoteDescriptions.push(description);
        if (description.type === "answer") {
          this.connectionState = "connected";
          this.onconnectionstatechange?.();
          this.ontrack?.({ streams: [{} as MediaStream] } as RTCTrackEvent);
        }
      }
      async addIceCandidate() {}
      async getStats() {
        return new Map([
          [
            "candidate-pair",
            {
              type: "candidate-pair",
              state: "succeeded",
              nominated: true,
              currentRoundTripTime: 0.008,
              availableOutgoingBitrate: 7_000_000
            }
          ],
          [
            "outbound-rtp",
            {
              type: "outbound-rtp",
              kind: "video",
              packetsSent: 1200,
              framesPerSecond: 30,
              framesEncoded: 900,
              qpSum: 1500
            }
          ]
        ]);
      }
      close() {}
    }

    vi.stubGlobal("RTCPeerConnection", FakePeerConnection as unknown as typeof RTCPeerConnection);

    const sendSignal = vi.fn(async (request: {
      sessionId: string;
      type: string;
      sdp?: string;
      payload?: string;
    }) => {
      if (request.type === "offer") {
        return { ok: true, status: "accepted", sdp: "v=0 answer" };
      }

      if (request.type === "capture.performance") {
        return {
          ok: true,
          status: "accepted",
          type: "negotiation-needed",
          sdp: "v=0 renegotiate"
        };
      }

      return { ok: true, status: "accepted" };
    });

    render(
      <TestHook
        enabled
        transport="webrtc"
        sendSignal={sendSignal as never}
        onFallback={fallback}
      />
    );

    await waitFor(() =>
      expect(
        sendSignal.mock.calls.some(
          ([request]) => request.type === "answer" && request.sdp === "v=0 renegotiated-answer"
        )
      ).toBe(true)
    );
    expect(remoteDescriptions).toContainEqual({ type: "offer", sdp: "v=0 renegotiate" });
    expect(fallback).not.toHaveBeenCalled();
  });
});
