import { ceryxColors } from "@ceryx/design-tokens";
import type { RecordingEntryResponse } from "@ceryx/protocol";
import { Button, Panel, StatusChip } from "@ceryx/ui";

export type RecordingMode = "screen" | "screen-audio";

export interface RecordingPanelProps {
  size?: "desktop" | "ipad";
  connected: boolean;
  loading?: boolean;
  error?: string;
  recordingActive: boolean;
  recordingAudioActive: boolean;
  recordingMode: RecordingMode;
  recordings: RecordingEntryResponse[];
  selectedRecordingFileName: string | null;
  selectedRecordingUrl: string | null;
  onRecordingModeChange: (mode: RecordingMode) => void;
  onToggleRecording: () => void;
  onRefreshRecordings: () => void;
  onSelectRecording: (fileName: string) => void;
  onDownloadRecording: (fileName: string) => void;
}

export function RecordingPanel({
  size = "desktop",
  connected,
  loading = false,
  error,
  recordingActive,
  recordingAudioActive,
  recordingMode,
  recordings = [],
  selectedRecordingFileName,
  selectedRecordingUrl,
  onRecordingModeChange,
  onToggleRecording,
  onRefreshRecordings,
  onSelectRecording,
  onDownloadRecording
}: RecordingPanelProps) {
  const modeLabel = recordingMode === "screen-audio" ? "录制画面 + 系统音频" : "录制画面（静音）";
  const resolvedRecordings = Array.isArray(recordings) ? recordings : [];

  return (
    <Panel size={size} style={{ display: "grid", gap: 14 }}>
      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          gap: 10
        }}
      >
        <strong style={{ fontSize: size === "ipad" ? 20 : 18 }}>Recordings</strong>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <StatusChip tone={recordingActive ? "warning" : "neutral"}>
            recording: {recordingActive ? "active" : "idle"}
          </StatusChip>
          <StatusChip tone={recordingAudioActive ? "success" : "neutral"}>
            audio: {recordingAudioActive ? "on" : "off"}
          </StatusChip>
          <StatusChip tone="neutral">{modeLabel}</StatusChip>
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <label
          style={{
            color: ceryxColors.onSurfaceVariant,
            display: "grid",
            gap: 6,
            fontSize: 13
          }}
        >
          <span>Recording Mode</span>
          <select
            disabled={!connected || recordingActive}
            value={recordingMode}
            onChange={(event) => onRecordingModeChange(event.target.value as RecordingMode)}
            style={{
              backgroundColor: ceryxColors.surfaceContainerLow,
              border: `1px solid ${ceryxColors.outlineVariant}`,
              borderRadius: 10,
              color: ceryxColors.onSurface,
              font: "inherit",
              padding: "10px 12px"
            }}
          >
            <option value="screen">录制画面（静音）</option>
            <option value="screen-audio">录制画面 + 系统音频</option>
          </select>
        </label>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <Button size={size} disabled={!connected} onClick={onToggleRecording}>
            {recordingActive ? "停止录制" : "开始录制"}
          </Button>
          <Button size={size} variant="secondary" disabled={!connected || loading} onClick={onRefreshRecordings}>
            {loading ? "Refreshing..." : "刷新列表"}
          </Button>
        </div>
      </div>

      {error ? (
        <p style={{ color: ceryxColors.error, margin: 0 }}>{error}</p>
      ) : null}

      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", gap: 10 }}>
          <strong style={{ fontSize: 14 }}>Recording Files</strong>
          <span style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
            {resolvedRecordings.length} item{resolvedRecordings.length === 1 ? "" : "s"}
          </span>
        </div>

        {resolvedRecordings.length === 0 ? (
          <p style={{ color: ceryxColors.onSurfaceVariant, margin: 0 }}>
            No recordings yet. Start one to populate the list.
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gap: 10,
              maxHeight: 280,
              overflowY: "auto",
              paddingRight: 4
            }}
          >
            {resolvedRecordings.map((entry) => {
              const isSelected = entry.fileName === selectedRecordingFileName;
              return (
                <div
                  key={entry.fileName}
                  style={{
                    backgroundColor: isSelected ? ceryxColors.surfaceContainerHighest : ceryxColors.surfaceContainerLow,
                    border: `1px solid ${isSelected ? ceryxColors.primary : ceryxColors.outlineVariant}`,
                    borderRadius: 14,
                    display: "grid",
                    gap: 10,
                    padding: 12
                  }}
                >
                  <div style={{ display: "grid", gap: 4 }}>
                    <strong style={{ fontSize: 13, wordBreak: "break-word" }}>{entry.fileName}</strong>
                    <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                      {formatBytes(entry.sizeBytes)} · {formatDuration(entry.durationSeconds)} ·{" "}
                      {entry.audioEnabled ? `audio ${entry.audioFormat}` : "silent"} · {formatDateTime(entry.startedAt)}
                    </div>
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    <Button size={size} variant="secondary" onClick={() => onSelectRecording(entry.fileName)}>
                      Preview
                    </Button>
                    <Button size={size} variant="ghost" onClick={() => onDownloadRecording(entry.fileName)}>
                      Download
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <strong style={{ fontSize: 14 }}>Preview</strong>
        {selectedRecordingUrl ? (
          <video
            controls
            playsInline
            src={selectedRecordingUrl}
            style={{
              backgroundColor: "#000",
              border: `1px solid ${ceryxColors.outlineVariant}`,
              borderRadius: 14,
              maxHeight: 320,
              objectFit: "contain",
              width: "100%"
            }}
          />
        ) : (
          <p style={{ color: ceryxColors.onSurfaceVariant, margin: 0 }}>
            Select a recording to preview it here.
          </p>
        )}
      </div>
    </Panel>
  );
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(durationSeconds: number): string {
  const totalSeconds = Math.max(0, Math.round(durationSeconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDateTime(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "short",
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return value;
  }
}
