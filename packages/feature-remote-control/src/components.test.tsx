import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CodexToolbar } from "./CodexToolbar";
import { ConnectionQualityIndicator } from "./ConnectionQualityIndicator";
import { CodexWindowPipPreview, CodexWindowSwitcher } from "./CodexWindowSwitcher";
import { PromptComposer } from "./PromptComposer";
import { RemoteViewport } from "./RemoteViewport";

describe("remote viewport", () => {
  it("renders capture status and capture toggle", () => {
    render(
      <RemoteViewport
        deviceName="Local Windows PC"
        sessionStatus="connected"
        codexStatus="found"
        latencyMs={24}
        captureState={{
          ok: true,
          active: true,
          paused: false,
          mode: "balanced",
          windowId: "w_001",
          width: 1280,
          height: 720
        }}
      />
    );

    expect(screen.getByText("capture: balanced")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop Capture" })).toBeInTheDocument();
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

    const { rerender } = render(
      <ConnectionQualityIndicator sessionKey="desktop" stats={baseStats} />
    );

    rerender(
      <ConnectionQualityIndicator
        sessionKey="desktop"
        stats={{
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
        }}
      />
    );

    expect(screen.getByText("Connection quality")).toBeInTheDocument();
    expect(screen.getByText("high tier")).toBeInTheDocument();
    expect(screen.getByText("1920x1080")).toBeInTheDocument();
    expect(screen.getByText("30 fps")).toBeInTheDocument();
    expect(screen.getByText("4500 kbps")).toBeInTheDocument();
    expect(screen.getByText("2 viewers")).toBeInTheDocument();
    expect(screen.getByText("2 samples in 5m history")).toBeInTheDocument();
    expect(screen.getByTestId("connection-quality-chart")).toBeInTheDocument();
  });
});

describe("prompt composer", () => {
  it("applies template and sends prompt", () => {
    const onDraftChange = vi.fn();
    const onTemplateSelect = vi.fn();
    const onSend = vi.fn();

    render(
      <PromptComposer
        draft="run tests"
        templates={[{ id: "t1", label: "Run Tests", text: "run tests" }]}
        history={[]}
        isSending={false}
        onDraftChange={onDraftChange}
        onTemplateSelect={onTemplateSelect}
        onSend={onSend}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Run Tests" }));
    fireEvent.click(screen.getByRole("button", { name: "Send Prompt" }));

    expect(onTemplateSelect).toHaveBeenCalledWith("t1");
    expect(onSend).toHaveBeenCalledWith(true);
  });
});

describe("toolbar", () => {
  it("disables actions when permissions are missing", () => {
    const onApprove = vi.fn();
    const onCopyOutput = vi.fn();

    render(
      <CodexToolbar
        connected
        permissions={["copy_output"]}
        onApprove={onApprove}
        onCopyOutput={onCopyOutput}
      />
    );

    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Copy Output" })).toBeEnabled();
  });

  it("enables clipboard actions only with manage_agent permission", () => {
    const onPasteToWindows = vi.fn();
    const onCopyFromWindows = vi.fn();

    const view = render(
      <CodexToolbar
        connected
        permissions={["copy_output"]}
        onPasteToWindows={onPasteToWindows}
        onCopyFromWindows={onCopyFromWindows}
      />
    );
    const toolbar = within(view.container);

    expect(toolbar.getByRole("button", { name: "Paste to Windows" })).toBeDisabled();
    expect(toolbar.getByRole("button", { name: "Copy from Windows" })).toBeDisabled();

    view.rerender(
      <CodexToolbar
        connected
        permissions={["manage_agent"]}
        onPasteToWindows={onPasteToWindows}
        onCopyFromWindows={onCopyFromWindows}
      />
    );

    expect(toolbar.getByRole("button", { name: "Paste to Windows" })).toBeEnabled();
    expect(toolbar.getByRole("button", { name: "Copy from Windows" })).toBeEnabled();
  });
});

describe("codex window switcher", () => {
  it("renders window tabs with previews and emits selection clicks", () => {
    const onSelectWindow = vi.fn();

    render(
      <CodexWindowSwitcher
        title="Codex Windows"
        windows={[
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
        ]}
        activeWindowId="hwnd_a"
        previewUrls={{
          hwnd_a: "blob:preview-a",
          hwnd_b: "blob:preview-b"
        }}
        onSelectWindow={onSelectWindow}
      />
    );

    expect(screen.getByText("Codex Windows")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Codex A/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Codex B/ })).toBeInTheDocument();
    expect(screen.getByAltText("Codex A preview")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Codex B/ }));
    expect(onSelectWindow).toHaveBeenCalledWith("hwnd_b");
  });
});

describe("codex window pip preview", () => {
  it("renders the pip preview and emits switch and close actions", () => {
    const onSelectWindow = vi.fn();
    const onClose = vi.fn();

    render(
      <CodexWindowPipPreview
        size="ipad"
        window={{
          status: "found",
          windowId: "hwnd_a",
          title: "Codex A",
          processName: "codex",
          candidateCount: 2,
          lastUpdatedAt: "2026-06-04T00:00:00.000Z"
        }}
        activeWindowId="hwnd_b"
        previewUrl="blob:preview-a"
        onSelectWindow={onSelectWindow}
        onClose={onClose}
      />
    );

    expect(screen.getByText("inactive preview")).toBeInTheDocument();
    expect(screen.getByAltText("Codex A active preview")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Switch" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onSelectWindow).toHaveBeenCalledWith("hwnd_a");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
