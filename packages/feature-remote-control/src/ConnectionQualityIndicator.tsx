import { ceryxColors } from "@ceryx/design-tokens";
import type { ConnectionStatsResponse } from "@ceryx/client-sdk";
import { StatusChip } from "@ceryx/ui";
import { useEffect, useMemo, useState } from "react";

export interface ConnectionQualityIndicatorProps {
  sessionKey: string;
  stats: ConnectionStatsResponse | null;
  historyWindowMs?: number;
}

type HistorySample = {
  observedAt: number;
  stats: ConnectionStatsResponse;
};

const defaultHistoryWindowMs = 5 * 60 * 1000;
const maxHistorySamples = 24;

export function ConnectionQualityIndicator({
  sessionKey,
  stats,
  historyWindowMs = defaultHistoryWindowMs
}: ConnectionQualityIndicatorProps) {
  const [history, setHistory] = useState<HistorySample[]>([]);

  useEffect(() => {
    setHistory([]);
  }, [sessionKey]);

  useEffect(() => {
    if (!stats) {
      return;
    }

    const parsedObservedAt = Date.parse(stats.observedAt);
    const observedAt = Number.isFinite(parsedObservedAt) ? parsedObservedAt : Date.now();

    setHistory((current) => {
      const next = current.filter((entry) => observedAt - entry.observedAt <= historyWindowMs);
      const sampleIndex = next.findIndex((entry) => entry.stats.observedAt === stats.observedAt);
      const sample = { observedAt, stats };

      if (sampleIndex >= 0) {
        next[sampleIndex] = sample;
      } else {
        next.push(sample);
      }

      return next.slice(-maxHistorySamples);
    });
  }, [historyWindowMs, stats]);

  const latest = stats ?? history[history.length - 1]?.stats ?? null;
  const viewportStats = latest?.viewportStats ?? null;
  const agentStats = latest?.agentStats ?? null;
  const tier = resolveTierLabel(viewportStats?.currentTier ?? "");
  const tone = tier === "high" ? "success" : tier === "medium" ? "warning" : "error";
  const samples = history.length;
  const chartBars = useMemo(() => buildChartBars(history), [history]);

  return (
    <section
      aria-label="Connection quality"
      style={{
        border: `1px solid ${ceryxColors.outlineVariant}`,
        borderRadius: 14,
        display: "grid",
        gap: 12,
        marginTop: 10,
        padding: 12
      }}
    >
      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between" }}>
        <div style={{ display: "grid", gap: 4 }}>
          <strong style={{ fontSize: 14 }}>Connection quality</strong>
          <span style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
            {latest ? "Current tier" : "Waiting for connection stats"}
          </span>
        </div>
        <StatusChip tone={tone}>{latest ? `${tier} tier` : "idle"}</StatusChip>
      </div>

      {latest ? (
        <div style={{ display: "grid", gap: 10 }}>
          <div
            style={{
              display: "grid",
              gap: 6,
              gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))"
            }}
          >
            <Metric label="Resolution" value={viewportStats?.resolution ?? "n/a"} />
            <Metric label="FPS" value={`${formatNumber(viewportStats?.fps ?? 0)} fps`} />
            <Metric label="Bitrate" value={`${formatNumber(viewportStats?.bitrateKbps ?? 0)} kbps`} />
            <Metric label="Viewers" value={`${latest.activeViewers ?? 0} viewers`} />
            <Metric label="CPU" value={`${formatNumber(agentStats?.cpuPercent ?? 0)}%`} />
            <Metric label="Memory" value={`${formatNumber(agentStats?.memoryMB ?? 0)} MB`} />
            <Metric label="Uptime" value={formatDuration(agentStats?.uptimeSeconds ?? 0)} />
            <Metric label="RTT" value={`${formatNumber(viewportStats?.roundTripTimeMs ?? 0)} ms`} />
            <Metric label="Packet loss" value={`${formatNumber(viewportStats?.packetLossPercent ?? 0)}%`} />
          </div>

          <svg
            data-testid="connection-quality-chart"
            viewBox="0 0 240 72"
            role="img"
            aria-label="Connection quality history chart"
            style={{
              backgroundColor: ceryxColors.surfaceContainerLowest,
              border: `1px solid ${ceryxColors.outlineVariant}`,
              borderRadius: 10,
              height: 72,
              width: "100%"
            }}
          >
            <line
              x1="12"
              x2="228"
              y1="58"
              y2="58"
              stroke={ceryxColors.outlineVariant}
              strokeWidth="1"
            />
            {chartBars.map((bar) => (
              <rect
                key={bar.key}
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                rx="2"
                fill={bar.fill}
              />
            ))}
          </svg>

          <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
            {samples} samples in 5m history
          </div>
        </div>
      ) : (
        <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
          Waiting for connection stats.
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <span style={{ color: ceryxColors.onSurfaceVariant, fontSize: 11 }}>{label}</span>
      <strong style={{ fontSize: 13 }}>{value}</strong>
    </div>
  );
}

function resolveTierLabel(tier: string): "high" | "medium" | "low" {
  const normalized = tier.trim().toLowerCase();
  if (normalized.includes("high")) {
    return "high";
  }

  if (normalized.includes("medium") || normalized.includes("balanced")) {
    return "medium";
  }

  return "low";
}

function buildChartBars(history: HistorySample[]): Array<{ key: string; x: number; y: number; width: number; height: number; fill: string }> {
  if (history.length === 0) {
    return [];
  }

  const totalBars = Math.min(history.length, 12);
  const recent = history.slice(-totalBars);
  const recentBitrates = recent.map((entry) => entry.stats.viewportStats?.bitrateKbps ?? 0);
  const maxBitrate = Math.max(...recentBitrates, 1);
  const width = 14;
  const gap = 6;
  const baseline = 58;
  const maxHeight = 44;
  const startX = 12 + Math.max(0, (216 - (totalBars * width + (totalBars - 1) * gap)) / 2);

  return recent.map((entry, index) => {
    const viewportStats = entry.stats.viewportStats ?? null;
    const sampleTier = resolveTierLabel(viewportStats?.currentTier ?? "");
    const bitrateKbps = viewportStats?.bitrateKbps ?? 0;
    const ratio = Math.max(0.1, Math.min(1, bitrateKbps / maxBitrate));
    const height = Math.max(6, Math.round(maxHeight * ratio));
    const x = startX + index * (width + gap);
    return {
      key: `${entry.stats.observedAt}-${index}`,
      x,
      y: baseline - height,
      width,
      height,
      fill: sampleTier === "high" ? "#2d7d46" : sampleTier === "medium" ? "#b7791f" : ceryxColors.error
    };
  });
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }

  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(/\.0$/, "");
}

function formatDuration(seconds: number): string {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainder = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${remainder}s`;
  }

  return `${remainder}s`;
}
