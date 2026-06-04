import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CodexToolbar } from "./CodexToolbar";
import { CodexWindowSwitcher } from "./CodexWindowSwitcher";
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
