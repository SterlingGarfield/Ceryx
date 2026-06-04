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

  useEffect(() => {
    setPhase("idle");
    setErrorMessage("");
    reconnectCountRef.current = 0;
    cleanupPeer();
  }, [sessionKey, cleanupPeer]);

  useEffect(() => {
    let cancelled = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let noTrackTimer: ReturnType<typeof setTimeout> | null = null;
    let hasRemoteTrack = false;

    const clearHeartbeatTimer = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    const clearNoTrackTimer = () => {
      if (noTrackTimer) {
        clearTimeout(noTrackTimer);
        noTrackTimer = null;
      }
    };

    const stopPeer = () => {
      stoppedRef.current = true;
      clearHeartbeatTimer();
      clearNoTrackTimer();
      cleanupPeer();
    };

    const resetPeerForReconnect = () => {
      clearHeartbeatTimer();
      clearNoTrackTimer();
      cleanupPeer();
      stoppedRef.current = false;
      hasRemoteTrack = false;
    };

    const enterFallback = (message: string) => {
      stopPeer();
      setErrorMessage(message);
      setPhase("degraded");
      onFallback(message);
    };

    if (!enabled) {
      setPhase("stopped");
      stopPeer();
      return;
    }

    if (transport !== "webrtc") {
      setPhase("idle");
      setErrorMessage("");
      stopPeer();
      return;
    }

    if (!isSupported) {
      enterFallback("WebRTC is not supported by this browser.");
      return;
    }

    stoppedRef.current = false;

    const armNoTrackTimer = () => {
      clearNoTrackTimer();
      noTrackTimer = setTimeout(() => {
        if (cancelled || stoppedRef.current || hasRemoteTrack) {
          return;
        }

        enterFallback("WebRTC connected but no video track arrived. Falling back to polling preview.");
      }, 5000);
    };

    const connect = async () => {
      stoppedRef.current = false;
      hasRemoteTrack = false;
      setPhase(reconnectCountRef.current > 0 ? "reconnecting" : "connecting");
      try {
        const pc = new RTCPeerConnection();
        pcRef.current = pc;
        pc.addTransceiver("video", { direction: "recvonly" });

        pc.ontrack = (event) => {
          if (cancelled || stoppedRef.current) {
            return;
          }

          hasRemoteTrack = true;
          clearNoTrackTimer();
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
            if (!hasRemoteTrack) {
              armNoTrackTimer();
            }
            return;
          }

          if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
            clearHeartbeatTimer();
            if (reconnectCountRef.current < 2) {
              reconnectCountRef.current += 1;
              resetPeerForReconnect();
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
          })
            .then(async (response) => {
              if (!response.ok) {
                throw new Error(`Signal rejected: ${response.status}`);
              }

              if (response.candidate) {
                await pc.addIceCandidate({
                  candidate: response.candidate.candidate,
                  sdpMid: response.candidate.sdpMid ?? null,
                  sdpMLineIndex: response.candidate.sdpMLineIndex ?? null
                });
              }
            })
            .catch((error: unknown) => {
              if (cancelled || stoppedRef.current) {
                return;
              }
              const message =
                error instanceof Error ? error.message : "Failed to send WebRTC ICE candidate.";
              enterFallback(message);
            });
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const signalResponse = await sendSignal({
          sessionId: sessionKey,
          type: "offer",
          sdp: offer.sdp ?? undefined
        });

        if (!signalResponse.ok) {
          throw new Error(`Signal rejected: ${signalResponse.status}`);
        }

        if (signalResponse.candidate) {
          await pc.addIceCandidate({
            candidate: signalResponse.candidate.candidate,
            sdpMid: signalResponse.candidate.sdpMid ?? null,
            sdpMLineIndex: signalResponse.candidate.sdpMLineIndex ?? null
          });
        }

        if (!signalResponse.sdp) {
          throw new Error(
            `Missing SDP answer from agent signal endpoint (status=${signalResponse.status}).`
          );
        }

        await pc.setRemoteDescription({
          type: "answer",
          sdp: signalResponse.sdp
        });

        armNoTrackTimer();

        const handleRenegotiation = async (renegotiationSdp: string) => {
          await pc.setRemoteDescription({
            type: "offer",
            sdp: renegotiationSdp
          });

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          const answerResponse = await sendSignal({
            sessionId: sessionKey,
            type: "answer",
            sdp: answer.sdp ?? undefined
          });

          if (!answerResponse.ok) {
            throw new Error(`Signal rejected: ${answerResponse.status}`);
          }

          if (answerResponse.candidate) {
            await pc.addIceCandidate({
              candidate: answerResponse.candidate.candidate,
              sdpMid: answerResponse.candidate.sdpMid ?? null,
              sdpMLineIndex: answerResponse.candidate.sdpMLineIndex ?? null
            });
          }
        };

        const publishViewerSignals = async (hasActiveViewer: boolean) => {
          let networkJitterMs = 0;
          let availableOutgoingBitrateKbps: number | null = null;
          let roundTripTimeMs: number | null = null;
          let packetsLost: number | null = null;
          let packetsSent: number | null = null;
          let framesPerSecond: number | null = null;
          let framesEncoded: number | null = null;
          let qpSum: number | null = null;

          if (hasActiveViewer) {
            try {
              const stats = await pc.getStats();
              for (const report of stats.values()) {
                const sample = report as unknown as {
                  type?: string;
                  state?: string;
                  nominated?: boolean;
                  currentRoundTripTime?: number;
                  availableOutgoingBitrate?: number;
                  roundTripTime?: number;
                  kind?: string;
                  packetsLost?: number;
                  packetsSent?: number;
                  framesPerSecond?: number;
                  framesEncoded?: number;
                  qpSum?: number;
                };

                if (sample.type !== "candidate-pair") {
                  if (sample.type === "remote-inbound-rtp") {
                    if (typeof sample.packetsLost === "number") {
                      packetsLost = Math.max(packetsLost ?? 0, sample.packetsLost);
                    }
                    if (typeof sample.roundTripTime === "number") {
                      roundTripTimeMs = Math.round(
                        Math.max(roundTripTimeMs ?? 0, sample.roundTripTime * 1000)
                      );
                    }
                  } else if (sample.type === "outbound-rtp" && sample.kind === "video") {
                    if (typeof sample.packetsSent === "number") {
                      packetsSent = Math.max(packetsSent ?? 0, sample.packetsSent);
                    }
                    if (typeof sample.framesPerSecond === "number") {
                      framesPerSecond = Math.max(framesPerSecond ?? 0, sample.framesPerSecond);
                    }
                    if (typeof sample.framesEncoded === "number") {
                      framesEncoded = Math.max(framesEncoded ?? 0, sample.framesEncoded);
                    }
                    if (typeof sample.qpSum === "number") {
                      qpSum = Math.max(qpSum ?? 0, sample.qpSum);
                    }
                  }

                  continue;
                }

                if (sample.state !== "succeeded" && sample.nominated !== true) {
                  continue;
                }

                if (typeof sample.currentRoundTripTime === "number") {
                  roundTripTimeMs = Math.round(
                    Math.max(roundTripTimeMs ?? 0, sample.currentRoundTripTime * 1000)
                  );
                  networkJitterMs = Math.max(networkJitterMs, roundTripTimeMs);
                }

                if (typeof sample.availableOutgoingBitrate === "number") {
                  availableOutgoingBitrateKbps = Math.max(
                    availableOutgoingBitrateKbps ?? 0,
                    sample.availableOutgoingBitrate / 1000
                  );
                }
              }
            } catch {
              networkJitterMs = 0;
            }
          }

          if (roundTripTimeMs == null && networkJitterMs > 0) {
            roundTripTimeMs = networkJitterMs;
          }

          const payload = JSON.stringify({
            cpuUsagePercent: 0,
            networkJitterMs,
            hasActiveViewer,
            availableOutgoingBitrateKbps: availableOutgoingBitrateKbps ?? undefined,
            roundTripTimeMs: roundTripTimeMs ?? undefined,
            packetsLost: packetsLost ?? undefined,
            packetsSent: packetsSent ?? undefined,
            framesPerSecond: framesPerSecond ?? undefined,
            framesEncoded: framesEncoded ?? undefined,
            qpSum: qpSum ?? undefined
          });

          const performanceResponse = await sendSignal({
            sessionId: sessionKey,
            type: "capture.performance",
            payload
          }).catch(() => undefined);

          if (
            performanceResponse?.ok &&
            performanceResponse.type === "negotiation-needed" &&
            performanceResponse.sdp
          ) {
            await handleRenegotiation(performanceResponse.sdp);
          }

          await sendSignal({
            sessionId: sessionKey,
            type: hasActiveViewer ? "viewer.heartbeat" : "viewer.idle"
          }).catch(() => undefined);
        };

        await publishViewerSignals(true);
        heartbeatTimer = setInterval(() => {
          if (cancelled || stoppedRef.current) {
            return;
          }

          void publishViewerSignals(true);
        }, 3000);
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
      stopPeer();
      void sendSignal({
        sessionId: sessionKey,
        type: "viewer.idle"
      }).catch(() => undefined);
    };
  }, [cleanupPeer, enabled, isSupported, onFallback, sendSignal, sessionKey, transport]);

  return {
    phase,
    stream,
    isSupported,
    errorMessage
  };
}
