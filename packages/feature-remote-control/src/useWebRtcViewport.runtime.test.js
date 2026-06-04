import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWebRtcViewport } from "../dist/useWebRtcViewport.js";

describe("useWebRtcViewport runtime", () => {
  const fallbackMessages = [];

  beforeEach(() => {
    fallbackMessages.length = 0;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("reconnects after a transient disconnect and returns to live", async () => {
    const instances = [];

    class FakePeerConnection {
      constructor() {
        this.onicecandidate = null;
        this.ontrack = null;
        this.onconnectionstatechange = null;
        this.connectionState = "new";
        instances.push(this);
      }

      addTransceiver() {}

      async createOffer() {
        return { type: "offer", sdp: "v=0" };
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
        this.ontrack?.({ streams: [{}] });
      }

      async addIceCandidate() {}

      async getStats() {
        return new Map();
      }

      close() {}
    }

    vi.stubGlobal("RTCPeerConnection", FakePeerConnection);

    const sendSignal = async () => ({ ok: true, status: "accepted", sdp: "v=0" });
    const handleFallback = (message) => fallbackMessages.push(message);

    function Harness() {
      const state = useWebRtcViewport({
        enabled: true,
        sessionKey: "session-1",
        transport: "webrtc",
        sendSignal,
        onFallback: handleFallback
      });

      return React.createElement(
        "div",
        null,
        React.createElement("div", { "data-testid": "phase" }, state.phase),
        React.createElement("div", { "data-testid": "error" }, state.errorMessage)
      );
    }

    render(React.createElement(Harness));

    await waitFor(() => expect(instances).toHaveLength(2), { timeout: 5000 });
    await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("live"), {
      timeout: 5000
    });
    expect(fallbackMessages).toHaveLength(0);
    expect(screen.getByTestId("error")).toHaveTextContent("");
  });

  it("renegotiates when performance feedback requests a new offer", async () => {
    const remoteDescriptions = [];

    class FakePeerConnection {
      constructor() {
        this.onicecandidate = null;
        this.ontrack = null;
        this.onconnectionstatechange = null;
        this.connectionState = "new";
      }

      addTransceiver() {}

      async createOffer() {
        return { type: "offer", sdp: "v=0 offer" };
      }

      async createAnswer() {
        return { type: "answer", sdp: "v=0 renegotiated-answer" };
      }

      async setLocalDescription() {}

      async setRemoteDescription(description) {
        remoteDescriptions.push(description);
        if (description.type === "answer") {
          this.connectionState = "connected";
          this.onconnectionstatechange?.();
          this.ontrack?.({ streams: [{}] });
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

    vi.stubGlobal("RTCPeerConnection", FakePeerConnection);

    const sendSignal = vi.fn(async (request) => {
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

    function Harness() {
      const state = useWebRtcViewport({
        enabled: true,
        sessionKey: "session-2",
        transport: "webrtc",
        sendSignal,
        onFallback: (message) => fallbackMessages.push(message)
      });

      return React.createElement(
        "div",
        null,
        React.createElement("div", { "data-testid": "phase" }, state.phase),
        React.createElement("div", { "data-testid": "error" }, state.errorMessage)
      );
    }

    render(React.createElement(Harness));

    await waitFor(() =>
      expect(
        sendSignal.mock.calls.some(
          ([request]) => request.type === "answer" && request.sdp === "v=0 renegotiated-answer"
        )
      ).toBe(true),
      { timeout: 5000 }
    );
    expect(remoteDescriptions).toContainEqual({ type: "offer", sdp: "v=0 renegotiate" });
    expect(fallbackMessages).toHaveLength(0);
  });
});
