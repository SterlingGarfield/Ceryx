import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { CodexToolbar } from "../dist/CodexToolbar.js";
import { ConnectionQualityIndicator } from "../dist/ConnectionQualityIndicator.js";
import { CodexWindowPipPreview, CodexWindowSwitcher } from "../dist/CodexWindowSwitcher.js";
import { RecordingPanel } from "../dist/RecordingPanel.js";

describe("toolbar", () => {
  it("disables and enables clipboard actions based on manage_agent permission", () => {
    const onPasteToWindows = vi.fn();
    const onCopyFromWindows = vi.fn();

    const view = render(
      React.createElement(CodexToolbar, {
        connected: true,
        permissions: ["copy_output"],
        onPasteToWindows,
        onCopyFromWindows
      })
    );
    const toolbar = within(view.container);

    expect(toolbar.getByRole("button", { name: "Paste to Windows" })).toBeDisabled();
    expect(toolbar.getByRole("button", { name: "Copy from Windows" })).toBeDisabled();

    view.rerender(
      React.createElement(CodexToolbar, {
        connected: true,
        permissions: ["manage_agent"],
        onPasteToWindows,
        onCopyFromWindows
      })
    );

    const pasteButton = toolbar.getByRole("button", { name: "Paste to Windows" });
    const copyButton = toolbar.getByRole("button", { name: "Copy from Windows" });

    expect(pasteButton).toBeEnabled();
    expect(copyButton).toBeEnabled();

    fireEvent.click(pasteButton);
    fireEvent.click(copyButton);

    expect(onPasteToWindows).toHaveBeenCalledTimes(1);
    expect(onCopyFromWindows).toHaveBeenCalledTimes(1);
  });
});

describe("recording panel", () => {
  it("lets the user switch recording mode and act on recordings", () => {
    const onRecordingModeChange = vi.fn();
    const onToggleRecording = vi.fn();
    const onRefreshRecordings = vi.fn();
    const onSelectRecording = vi.fn();
    const onDownloadRecording = vi.fn();

    const view = render(
      React.createElement(RecordingPanel, {
        connected: true,
        recordingActive: false,
        recordingAudioActive: false,
        recordingMode: "screen",
        recordings: [
          {
            recordingId: "rec_001",
            fileName: "rec_001.mp4",
            sizeBytes: 1024,
            durationSeconds: 12.5,
            audioEnabled: true,
            audioFormat: "pcm_s16le",
            thumbnailFileName: "thumbnail.jpg",
            outputPaths: ["rec_001.mp4"],
            startedAt: "2026-05-22T07:00:00.000Z",
            stoppedAt: "2026-05-22T07:00:12.500Z"
          }
        ],
        selectedRecordingFileName: null,
        selectedRecordingUrl: "blob:preview",
        onRecordingModeChange,
        onToggleRecording,
        onRefreshRecordings,
        onSelectRecording,
        onDownloadRecording
      })
    );
    const panel = within(view.container);

    const modeSelect = panel.getByRole("combobox", { name: "Recording Mode" });
    fireEvent.change(modeSelect, { target: { value: "screen-audio" } });
    expect(onRecordingModeChange).toHaveBeenCalledWith("screen-audio");

    fireEvent.click(panel.getByRole("button", { name: "开始录制" }));
    expect(onToggleRecording).toHaveBeenCalledTimes(1);

    fireEvent.click(panel.getByRole("button", { name: "刷新列表" }));
    expect(onRefreshRecordings).toHaveBeenCalledTimes(1);

    fireEvent.click(panel.getByRole("button", { name: "Preview" }));
    fireEvent.click(panel.getByRole("button", { name: "Download" }));

    expect(onSelectRecording).toHaveBeenCalledWith("rec_001.mp4");
    expect(onDownloadRecording).toHaveBeenCalledWith("rec_001.mp4");
    expect(view.container.querySelector("video")).toBeTruthy();
    expect(screen.getByText("Recording Files")).toBeInTheDocument();
  });
});

describe("connection quality indicator", () => {
  it("renders current stats and retains recent history samples", () => {
    const baseStats = {
      ok: true,
      observedAt: "2026-06-05T01:00:00.000Z",
      connectedSince: "2026-06-05T00:30:00.000Z",
      activeViewers: 2,
      viewportStats: {
        currentTier: "high",
        resolution: "1920x1080",
        fps: 30,
        bitrateKbps: 4500,
        packetsLost: 0,
        packetsSent: 420,
        packetLossPercent: 0,
        roundTripTimeMs: 4,
        jitterMs: 1.2
      },
      agentStats: {
        cpuPercent: 5.2,
        memoryMB: 180,
        uptimeSeconds: 3600
      }
    };

    const view = render(
      React.createElement(ConnectionQualityIndicator, {
        sessionKey: "desktop",
        stats: baseStats
      })
    );

    view.rerender(
      React.createElement(ConnectionQualityIndicator, {
        sessionKey: "desktop",
        stats: {
          ...baseStats,
          observedAt: "2026-06-05T01:00:03.000Z",
          viewportStats: {
            ...baseStats.viewportStats,
            fps: 28,
            roundTripTimeMs: 8,
            jitterMs: 2.5
          },
          agentStats: {
            ...baseStats.agentStats,
            cpuPercent: 8.4
          }
        }
      })
    );

    expect(screen.getByText("Connection quality")).toBeInTheDocument();
    expect(screen.getByText("high tier")).toBeInTheDocument();
    expect(screen.getByText("1920x1080")).toBeInTheDocument();
    expect(screen.getByText("28 fps")).toBeInTheDocument();
    expect(screen.getByText("4500 kbps")).toBeInTheDocument();
    expect(screen.getByText("2 viewers")).toBeInTheDocument();
    expect(screen.getByText("2 samples in 5m history")).toBeInTheDocument();
    expect(screen.getByTestId("connection-quality-chart")).toBeInTheDocument();
  });
});

describe("codex window switcher", () => {
  it("renders window tabs with previews and emits selection clicks", () => {
    const onSelectWindow = vi.fn();

    render(
      React.createElement(CodexWindowSwitcher, {
        title: "Codex Windows",
        variant: "tabs",
        windows: [
          {
            status: "focused",
            windowId: "hwnd_a",
            title: "Codex A",
            processName: "codex",
            candidateCount: 2,
            lastUpdatedAt: "2026-06-04T00:00:00.000Z"
          },
          {
            status: "found",
            windowId: "hwnd_b",
            title: "Codex B",
            processName: "codex",
            candidateCount: 2,
            lastUpdatedAt: "2026-06-04T00:00:00.000Z"
          }
        ],
        activeWindowId: "hwnd_a",
        previewUrls: {
          hwnd_a: "blob:preview-a",
          hwnd_b: "blob:preview-b"
        },
        onSelectWindow
      })
    );

    expect(screen.getByText("Codex Windows")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Codex A/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Codex B/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Codex B/ }));
    expect(onSelectWindow).toHaveBeenCalledWith("hwnd_b");
  });
});

describe("codex window pip preview", () => {
  it("renders the pip preview and emits switch and close actions", () => {
    const onSelectWindow = vi.fn();
    const onClose = vi.fn();

    render(
      React.createElement(CodexWindowPipPreview, {
        size: "ipad",
        window: {
          status: "found",
          windowId: "hwnd_a",
          title: "Codex A",
          processName: "codex",
          candidateCount: 2,
          lastUpdatedAt: "2026-06-04T00:00:00.000Z"
        },
        activeWindowId: "hwnd_b",
        previewUrl: "blob:preview-a",
        onSelectWindow,
        onClose
      })
    );

    expect(screen.getByText("inactive preview")).toBeInTheDocument();
    expect(screen.getByAltText("Codex A active preview")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Switch" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onSelectWindow).toHaveBeenCalledWith("hwnd_a");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
