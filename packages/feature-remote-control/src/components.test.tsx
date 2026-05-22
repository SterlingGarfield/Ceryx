import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CodexToolbar } from "./CodexToolbar";
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
});
