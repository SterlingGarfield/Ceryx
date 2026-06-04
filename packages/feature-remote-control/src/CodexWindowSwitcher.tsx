import { ceryxColors } from "@ceryx/design-tokens";
import type { CodexWindowSnapshot } from "@ceryx/protocol";
import { Button, Panel, StatusChip } from "@ceryx/ui";
import type { CSSProperties } from "react";

export interface CodexWindowSwitcherProps {
  size?: "desktop" | "ipad";
  title?: string;
  variant?: "tabs" | "cards";
  windows: CodexWindowSnapshot[];
  activeWindowId?: string | null;
  previewUrls?: Record<string, string | null | undefined>;
  loading?: boolean;
  error?: string;
  disabled?: boolean;
  onSelectWindow: (windowId: string) => void;
  onRefresh?: () => void;
  style?: CSSProperties;
}

export interface CodexWindowPipPreviewProps {
  size?: "desktop" | "ipad";
  window: CodexWindowSnapshot;
  activeWindowId?: string | null;
  previewUrl?: string | null;
  disabled?: boolean;
  onSelectWindow: (windowId: string) => void;
  onClose?: () => void;
  style?: CSSProperties;
}

export function CodexWindowSwitcher({
  size = "desktop",
  title = "Codex Windows",
  variant = "tabs",
  windows = [],
  activeWindowId,
  previewUrls,
  loading = false,
  error,
  disabled = false,
  onSelectWindow,
  onRefresh,
  style
}: CodexWindowSwitcherProps) {
  const resolvedWindows = Array.isArray(windows) ? windows : [];
  const resolvedPreviewUrls = previewUrls ?? {};

  return (
    <Panel
      size={size}
      style={{
        display: "grid",
        gap: 12,
        ...style
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
        <div style={{ display: "grid", gap: 4 }}>
          <strong style={{ fontSize: size === "ipad" ? 20 : 18 }}>{title}</strong>
          <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
            {resolvedWindows.length} window{resolvedWindows.length === 1 ? "" : "s"} discovered
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <StatusChip tone={resolvedWindows.length > 0 ? "success" : "neutral"}>
            active: {activeWindowId ?? "none"}
          </StatusChip>
          {loading ? <StatusChip tone="warning">refreshing</StatusChip> : null}
          {onRefresh ? (
            <Button
              size={size}
              variant="secondary"
              disabled={disabled || loading}
              onClick={onRefresh}
            >
              Refresh Windows
            </Button>
          ) : null}
        </div>
      </div>

      {error ? <p style={{ color: ceryxColors.error, margin: 0 }}>{error}</p> : null}

      {resolvedWindows.length === 0 ? (
        <p style={{ color: ceryxColors.onSurfaceVariant, margin: 0 }}>
          No Codex windows are currently visible.
        </p>
      ) : variant === "cards" ? (
        <div
          style={{
            display: "grid",
            gap: 12
          }}
        >
          {resolvedWindows.map((window) => {
            const windowId = resolveWindowId(window);
            const isActive = windowId !== null && windowId === activeWindowId;
            const previewUrl = windowId ? resolvedPreviewUrls[windowId] : null;

            return (
              <button
                key={windowId ?? window.title ?? window.processName ?? window.lastUpdatedAt}
                type="button"
                disabled={disabled || windowId === null}
                onClick={() => {
                  if (windowId) {
                    onSelectWindow(windowId);
                  }
                }}
                style={{
                  backgroundColor: isActive
                    ? ceryxColors.surfaceContainerHighest
                    : ceryxColors.surfaceContainerLow,
                  border: `1px solid ${isActive ? ceryxColors.primary : ceryxColors.outlineVariant}`,
                  borderRadius: 18,
                  color: "inherit",
                  cursor: disabled || windowId === null ? "not-allowed" : "pointer",
                  display: "grid",
                  gap: 12,
                  padding: 12,
                  textAlign: "left"
                }}
              >
                <div
                  style={{
                    alignItems: "center",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    justifyContent: "space-between"
                  }}
                >
                  <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
                    <strong style={{ fontSize: 14, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {resolveWindowTitle(window)}
                    </strong>
                    <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                      {resolveWindowSubtitle(window)}
                    </div>
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    <StatusChip tone={isActive ? "success" : "neutral"}>
                      {isActive ? "active" : window.status}
                    </StatusChip>
                    {typeof window.candidateCount === "number" ? (
                      <StatusChip tone="neutral">{window.candidateCount} candidate(s)</StatusChip>
                    ) : null}
                  </div>
                </div>

                {previewUrl ? (
                  <img
                    alt={`${resolveWindowTitle(window)} preview`}
                    src={previewUrl}
                    style={{
                      backgroundColor: "#111",
                      border: `1px solid ${ceryxColors.outlineVariant}`,
                      borderRadius: 14,
                      height: size === "ipad" ? 180 : 150,
                      objectFit: "cover",
                      width: "100%"
                    }}
                  />
                ) : (
                  <div
                    style={{
                      alignItems: "center",
                      backgroundColor: ceryxColors.surfaceContainerLowest,
                      border: `1px dashed ${ceryxColors.outlineVariant}`,
                      borderRadius: 14,
                      color: ceryxColors.onSurfaceVariant,
                      display: "grid",
                      height: size === "ipad" ? 180 : 150,
                      justifyItems: "center",
                      padding: 16
                    }}
                  >
                    Preview will appear when capture is active.
                  </div>
                )}

                <div style={{ color: ceryxColors.onSurfaceVariant, display: "grid", gap: 4, fontSize: 12 }}>
                  <div>windowId: {windowId ?? "n/a"}</div>
                  <div>updated: {formatDateTime(window.lastUpdatedAt)}</div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div
          role="tablist"
          aria-label={title}
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10
          }}
        >
          {resolvedWindows.map((window) => {
            const windowId = resolveWindowId(window);
            const isActive = windowId !== null && windowId === activeWindowId;

            return (
              <Button
                key={windowId ?? window.title ?? window.processName ?? window.lastUpdatedAt}
                size={size}
                variant={isActive ? "primary" : "secondary"}
                disabled={disabled || windowId === null}
                aria-selected={isActive}
                role="tab"
                onClick={() => {
                  if (windowId) {
                    onSelectWindow(windowId);
                  }
                }}
                style={{
                  borderColor: isActive ? ceryxColors.primary : undefined,
                  boxShadow: isActive ? `0 0 0 1px ${ceryxColors.primary} inset` : undefined
                }}
              >
                {resolveWindowTitle(window)}
              </Button>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

export function CodexWindowPipPreview({
  size = "desktop",
  window,
  activeWindowId,
  previewUrl,
  disabled = false,
  onSelectWindow,
  onClose,
  style
}: CodexWindowPipPreviewProps) {
  const windowId = resolveWindowId(window);
  const isActive = windowId !== null && windowId === activeWindowId;

  if (windowId === null) {
    return null;
  }

  return (
    <Panel
      size={size}
      style={{
        display: "grid",
        gap: 10,
        pointerEvents: "auto",
        width: size === "ipad" ? "min(240px, 38vw)" : "min(220px, 30vw)",
        ...style
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          justifyContent: "space-between"
        }}
      >
        <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
          <strong style={{ fontSize: size === "ipad" ? 16 : 14, overflow: "hidden", textOverflow: "ellipsis" }}>
            {resolveWindowTitle(window)}
          </strong>
          <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 11 }}>
            {isActive ? "active window" : "inactive preview"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <Button
            size={size}
            variant="secondary"
            disabled={disabled}
            onClick={() => {
              onSelectWindow(windowId);
            }}
          >
            Switch
          </Button>
          {onClose ? (
            <Button size={size} variant="ghost" disabled={disabled} onClick={onClose}>
              Close
            </Button>
          ) : null}
        </div>
      </div>

      {previewUrl ? (
        <img
          alt={`${resolveWindowTitle(window)} active preview`}
          src={previewUrl}
          style={{
            backgroundColor: "#111",
            border: `1px solid ${ceryxColors.outlineVariant}`,
            borderRadius: 12,
            height: size === "ipad" ? 148 : 132,
            objectFit: "cover",
            width: "100%"
          }}
        />
      ) : (
        <div
          style={{
            alignItems: "center",
            backgroundColor: ceryxColors.surfaceContainerLow,
            border: `1px dashed ${ceryxColors.outlineVariant}`,
            borderRadius: 12,
            color: ceryxColors.onSurfaceVariant,
            display: "grid",
            height: size === "ipad" ? 148 : 132,
            justifyItems: "center",
            padding: 12
          }}
        >
          Preview unavailable
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <StatusChip tone={isActive ? "success" : "neutral"}>{window.status}</StatusChip>
        {typeof window.candidateCount === "number" ? (
          <StatusChip tone="neutral">{window.candidateCount} candidate(s)</StatusChip>
        ) : null}
      </div>
    </Panel>
  );
}

function resolveWindowId(window: CodexWindowSnapshot): string | null {
  const windowId = window.windowId?.trim();
  return windowId ? windowId : null;
}

function resolveWindowTitle(window: CodexWindowSnapshot): string {
  return (
    window.title?.trim() ||
    window.processName?.trim() ||
    window.windowId?.trim() ||
    "Codex Window"
  );
}

function resolveWindowSubtitle(window: CodexWindowSnapshot): string {
  const processName = window.processName?.trim();
  const windowId = window.windowId?.trim();

  if (processName && windowId) {
    return `${processName} · ${windowId}`;
  }

  if (processName) {
    return processName;
  }

  if (windowId) {
    return windowId;
  }

  return "unidentified window";
}

function formatDateTime(value?: string | null): string {
  if (!value) {
    return "unknown";
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "short",
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return value;
  }
}
