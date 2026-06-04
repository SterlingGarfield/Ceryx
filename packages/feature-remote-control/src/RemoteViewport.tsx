import { ceryxColors } from "@ceryx/design-tokens";
import type { CaptureStateResponse, ConnectionStatsResponse } from "@ceryx/client-sdk";
import { Button, Panel, StatusChip } from "@ceryx/ui";
import type { ReactNode } from "react";
import { ConnectionQualityIndicator } from "./ConnectionQualityIndicator.js";
import { ViewportQualityIndicator } from "./ViewportQualityIndicator.js";

export interface RemoteViewportProps {
  size?: "desktop" | "ipad";
  title?: string;
  deviceName: string;
  sessionStatus: string;
  codexStatus: string;
  captureState: CaptureStateResponse;
  connectionStats?: ConnectionStatsResponse | null;
  latencyMs: number | null;
  frameRate?: number | null;
  tokenState?: "verified" | "missing" | "invalid" | "expired" | "unknown";
  recordingActive?: boolean;
  lastError?: string;
  disabled?: boolean;
  onFocusWindow?: () => void;
  onRefreshWindow?: () => void;
  onToggleCapture?: () => void;
  children?: ReactNode;
}

export function RemoteViewport({
  size = "desktop",
  title = "Remote Viewport",
  deviceName,
  sessionStatus,
  codexStatus,
  captureState,
  connectionStats = null,
  latencyMs,
  frameRate = null,
  tokenState = "unknown",
  recordingActive = false,
  lastError,
  disabled = false,
  onFocusWindow,
  onRefreshWindow,
  onToggleCapture,
  children
}: RemoteViewportProps) {
  const toneForSession =
    sessionStatus === "active" || sessionStatus === "connected"
      ? "success"
      : sessionStatus === "error" || sessionStatus === "closed"
        ? "error"
        : "warning";

  return (
    <Panel
      size={size}
      style={{
        display: "grid",
        gap: 14,
        minHeight: size === "ipad" ? 360 : 420
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          justifyContent: "space-between"
        }}
      >
        <div style={{ display: "grid", gap: 6 }}>
          <strong style={{ fontSize: size === "ipad" ? 20 : 18 }}>{title}</strong>
          <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 13 }}>
            {deviceName} | latency {typeof latencyMs === "number" ? `${latencyMs} ms` : "-"}
          </div>
          <ViewportQualityIndicator
            captureState={captureState}
            frameRate={frameRate}
            latencyMs={latencyMs}
          />
          <ConnectionQualityIndicator
            sessionKey={`${deviceName}:${sessionStatus}`}
            stats={connectionStats}
          />
        </div>

        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8 }}>
          <StatusChip tone={toneForSession}>{sessionStatus}</StatusChip>
          <StatusChip tone={codexStatus === "found" || codexStatus === "focused" ? "success" : "warning"}>
            codex: {codexStatus}
          </StatusChip>
          <StatusChip tone={captureState.active ? "success" : "neutral"}>
            capture: {captureState.active ? captureState.mode : "idle"}
          </StatusChip>
          <StatusChip tone={tokenTone(tokenState)}>
            token: {tokenState}
          </StatusChip>
          <StatusChip tone={recordingActive ? "warning" : "neutral"}>
            recording: {recordingActive ? "active" : "idle"}
          </StatusChip>
          <StatusChip tone={captureState.active ? "success" : "neutral"}>
            fps: {typeof frameRate === "number" ? frameRate : "-"}
          </StatusChip>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <Button
          size={size}
          variant="secondary"
          disabled={disabled || !onFocusWindow}
          onClick={onFocusWindow}
        >
          Focus Codex
        </Button>
        <Button
          size={size}
          variant="secondary"
          disabled={disabled || !onRefreshWindow}
          onClick={onRefreshWindow}
        >
          Refresh Window
        </Button>
        <Button
          size={size}
          disabled={disabled || !onToggleCapture}
          onClick={onToggleCapture}
        >
          {captureState.active ? "Stop Capture" : "Start Capture"}
        </Button>
      </div>

      <div
        style={{
          alignItems: "center",
          background:
            "linear-gradient(180deg, rgba(20,18,16,0.96), rgba(46,39,34,0.98))",
          border: `1px solid ${ceryxColors.outlineVariant}`,
          borderRadius: 16,
          color: "#f5efe8",
          display: "grid",
          flex: 1,
          minHeight: size === "ipad" ? 220 : 260,
          overflow: "hidden",
          padding: 18
        }}
      >
        {children ?? (
          <div style={{ display: "grid", gap: 10, justifyItems: "start" }}>
            <strong style={{ fontSize: size === "ipad" ? 18 : 16 }}>Viewport standby</strong>
            <p style={{ color: "#d0c7bf", margin: 0, maxWidth: 480 }}>
              The live stream surface will appear here after a capture session starts. Until then,
              this panel reflects Codex window and capture state.
            </p>
            <div style={{ color: "#d0c7bf", fontSize: 13 }}>
              resolution: {captureState.width} x {captureState.height}
            </div>
          </div>
        )}
      </div>

      {lastError ? (
        <p style={{ color: ceryxColors.error, margin: 0 }}>{lastError}</p>
      ) : null}
    </Panel>
  );
}

function tokenTone(tokenState: RemoteViewportProps["tokenState"]): "success" | "warning" | "error" | "neutral" {
  switch (tokenState) {
    case "verified":
      return "success";
    case "invalid":
      return "error";
    case "expired":
    case "missing":
      return "warning";
    default:
      return "neutral";
  }
}
