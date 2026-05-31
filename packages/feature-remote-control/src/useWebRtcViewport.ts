import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaptureSignalRequest, CaptureSignalResponse } from "@ceryx/protocol";

export type WebRtcViewportPhase =
  | "idle"
  | "connecting"
  | "live"
  | "degraded"
  | "reconnecting"
  | "stopped";

export interface UseWebRtcViewportOptions {
  enabled: boolean;
  sessionKey: string;
  transport: "webrtc" | "polling";
  sendSignal: (request: CaptureSignalRequest) => Promise<CaptureSignalResponse>;
  onFallback: (message: string) => void;
}

export interface WebRtcViewportState {
  phase: WebRtcViewportPhase;
  stream: MediaStream | null;
  isSupported: boolean;
  errorMessage: string;
}

export function useWebRtcViewport({
  enabled,
  sessionKey,
  transport,
  sendSignal,
  onFallback
}: UseWebRtcViewportOptions): WebRtcViewportState {
  const [phase, setPhase] = useState<WebRtcViewportPhase>("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const stoppedRef = useRef(false);
  const reconnectCountRef = useRef(0);

  const isSupported = useMemo(
    () => typeof window !== "undefined" && typeof window.RTCPeerConnection !== "undefined",
    []
  );

  const cleanupPeer = useCallback(() => {
    stoppedRef.current = true;
    const pc = pcRef.current;
    pcRef.current = null;
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
    }
    setStream(null);
  }, []);

  const enterFallback = useCallback(
    (message: string) => {
      cleanupPeer();
      setErrorMessage(message);
      setPhase("degraded");
      onFallback(message);
    },
    [cleanupPeer, onFallback]
  );

  useEffect(() => {
    setPhase("idle");
    setErrorMessage("");
    reconnectCountRef.current = 0;
    cleanupPeer();
  }, [sessionKey, cleanupPeer]);

  useEffect(() => {
    if (!enabled) {
      setPhase("stopped");
      cleanupPeer();
      return;
    }

    if (transport !== "webrtc") {
      setPhase("idle");
      setErrorMessage("");
      cleanupPeer();
      return;
    }

    if (!isSupported) {
      enterFallback("WebRTC is not supported by this browser.");
      return;
    }

    let cancelled = false;
    stoppedRef.current = false;

    const connect = async () => {
      setPhase(reconnectCountRef.current > 0 ? "reconnecting" : "connecting");
      try {
        const pc = new RTCPeerConnection();
        pcRef.current = pc;
        pc.addTransceiver("video", { direction: "recvonly" });

        pc.ontrack = (event) => {
          if (cancelled || stoppedRef.current) {
            return;
          }

          const nextStream = event.streams[0] ?? null;
          setStream(nextStream);
          setErrorMessage("");
          setPhase(nextStream ? "live" : "connecting");
        };

        pc.onconnectionstatechange = () => {
          if (cancelled || stoppedRef.current) {
            return;
          }

          if (pc.connectionState === "connected") {
            setPhase("live");
            setErrorMessage("");
            return;
          }

          if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
            if (reconnectCountRef.current < 2) {
              reconnectCountRef.current += 1;
              cleanupPeer();
              void connect();
              return;
            }

            enterFallback("WebRTC stream disconnected. Falling back to polling preview.");
          }
        };

        pc.onicecandidate = (event) => {
          if (!event.candidate || cancelled || stoppedRef.current) {
            return;
          }

          void sendSignal({
            sessionId: sessionKey,
            type: "ice-candidate",
            candidate: {
              candidate: event.candidate.candidate,
              sdpMid: event.candidate.sdpMid ?? undefined,
              sdpMLineIndex: event.candidate.sdpMLineIndex ?? undefined
            }
          });
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const signalResponse = await sendSignal({
          sessionId: sessionKey,
          type: "offer",
          sdp: offer.sdp ?? undefined
        });

        if (!signalResponse.sdp) {
          throw new Error("Missing SDP answer from agent signal endpoint.");
        }

        await pc.setRemoteDescription({
          type: "answer",
          sdp: signalResponse.sdp
        });
      } catch (error) {
        if (cancelled || stoppedRef.current) {
          return;
        }

        const message =
          error instanceof Error
            ? error.message
            : "WebRTC setup failed. Falling back to polling preview.";
        enterFallback(message);
      }
    };

    void connect();

    return () => {
      cancelled = true;
      cleanupPeer();
    };
  }, [cleanupPeer, enabled, enterFallback, isSupported, sendSignal, sessionKey, transport]);

  return {
    phase,
    stream,
    isSupported,
    errorMessage
  };
}
