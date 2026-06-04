import { ceryxColors } from "@ceryx/design-tokens";
import type { CaptureStateResponse } from "@ceryx/protocol";
import { StatusChip } from "@ceryx/ui";

export interface ViewportQualityIndicatorProps {
  captureState: Pick<CaptureStateResponse, "quality" | "width" | "height" | "frameRate">;
  frameRate?: number | null;
  latencyMs?: number | null;
}

type QualityTier = "High" | "Medium" | "Low";

export function ViewportQualityIndicator({
  captureState,
  frameRate = null,
  latencyMs = null
}: ViewportQualityIndicatorProps) {
  const tier = resolveQualityTier(captureState, frameRate);
  const tone = tier === "High" ? "success" : tier === "Medium" ? "warning" : "error";
  const dotColor = tier === "High" ? "#0b4d2a" : tier === "Medium" ? "#7a4a00" : ceryxColors.error;
  const effectiveFrameRate = frameRate ?? captureState.frameRate ?? null;
  const warningText = resolveWarningText(captureState.quality, latencyMs);

  return (
    <div aria-label="Viewport quality" style={{ display: "grid", gap: 4 }}>
      <div style={{ alignItems: "center", display: "inline-flex", gap: 8 }}>
        <span
          aria-hidden="true"
          style={{
            backgroundColor: dotColor,
            borderRadius: 999,
            boxShadow: `0 0 0 3px ${dotColor}22`,
            display: "inline-block",
            height: 10,
            width: 10
          }}
        />
        <StatusChip tone={tone}>{tier} quality</StatusChip>
      </div>

      <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
        {captureState.width} x {captureState.height}
        {" | "}
        {typeof effectiveFrameRate === "number" ? `${effectiveFrameRate} fps` : "fps unknown"}
      </div>

      {warningText ? (
        <div style={{ color: tone === "error" ? ceryxColors.error : ceryxColors.onSurfaceVariant, fontSize: 12 }}>
          {warningText}
        </div>
      ) : null}
    </div>
  );
}

function resolveQualityTier(
  captureState: Pick<CaptureStateResponse, "quality" | "width" | "height" | "frameRate">,
  frameRate: number | null
): QualityTier {
  const quality = captureState.quality?.trim().toLowerCase() ?? "";
  if (quality.includes("low") || quality.includes("degraded")) {
    return "Low";
  }

  if (quality.includes("medium") || quality.includes("balanced") || quality.includes("throttled") || quality.includes("power_save")) {
    return "Medium";
  }

  if (quality.includes("high")) {
    return "High";
  }

  const effectiveFrameRate = frameRate ?? captureState.frameRate ?? 0;
  if (effectiveFrameRate >= 30 && captureState.width >= 1280 && captureState.height >= 720) {
    return "High";
  }

  if (effectiveFrameRate >= 15 && captureState.width >= 960 && captureState.height >= 540) {
    return "Medium";
  }

  return "Low";
}

function resolveWarningText(quality: string | undefined, latencyMs: number | null): string | null {
  const normalizedQuality = quality?.trim().toLowerCase() ?? "";
  if (normalizedQuality.includes("network")) {
    return "Network degraded";
  }

  if (normalizedQuality.includes("throttled")) {
    return "CPU throttled";
  }

  if (typeof latencyMs === "number" && latencyMs >= 120) {
    return `High latency (${latencyMs} ms)`;
  }

  return null;
}
