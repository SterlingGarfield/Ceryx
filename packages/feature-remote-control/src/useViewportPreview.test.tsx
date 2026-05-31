import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureFrameResult } from "@ceryx/client-sdk";
import { useViewportPreview } from "./useViewportPreview";

function TestViewportPreview(props: {
  enabled?: boolean;
  pollIntervalMs?: number;
  sessionKey?: string;
  fetchFrame: () => Promise<CaptureFrameResult>;
  resolveErrorMessage?: (error: unknown) => string;
}) {
  const preview = useViewportPreview({
    enabled: props.enabled ?? true,
    pollIntervalMs: props.pollIntervalMs ?? 1000,
    sessionKey: props.sessionKey ?? "session-1",
    fetchFrame: props.fetchFrame,
    resolveErrorMessage: props.resolveErrorMessage ?? ((error) => String(error))
  });

  return (
    <div>
      <div data-testid="frame-url">{preview.frameUrl ?? ""}</div>
      <div data-testid="captured-at">{preview.capturedAt}</div>
      <div data-testid="width">{String(preview.width)}</div>
      <div data-testid="height">{String(preview.height)}</div>
      <div data-testid="has-frame">{String(preview.hasFrame)}</div>
      <div data-testid="is-refreshing">{String(preview.isRefreshing)}</div>
      <div data-testid="last-error">{preview.lastError}</div>
      <button onClick={() => void preview.refresh()}>Refresh</button>
    </div>
  );
}

describe("useViewportPreview", () => {
  const createObjectUrl = vi.fn(() => "blob:frame-1");
  const revokeObjectUrl = vi.fn();

  beforeEach(() => {
    createObjectUrl.mockClear();
    revokeObjectUrl.mockClear();
    vi.stubGlobal("URL", {
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("loads the first preview frame and exposes metadata", async () => {
    const fetchFrame = vi.fn(async () => ({
      blob: new Blob(["jpeg"], { type: "image/jpeg" }),
      contentType: "image/jpeg",
      capturedAt: "2026-05-27T01:00:00.000Z",
      width: 1280,
      height: 720
    }));

    render(<TestViewportPreview fetchFrame={fetchFrame} />);

    await waitFor(() => expect(screen.getByTestId("has-frame")).toHaveTextContent("true"));
    expect(screen.getByTestId("captured-at")).toHaveTextContent("2026-05-27T01:00:00.000Z");
    expect(screen.getByTestId("width")).toHaveTextContent("1280");
    expect(screen.getByTestId("height")).toHaveTextContent("720");
    expect(screen.getByTestId("frame-url")).toHaveTextContent("blob:frame-1");
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
  });

  it("keeps the last successful frame when a later refresh fails", async () => {
    const fetchFrame = vi
      .fn<() => Promise<CaptureFrameResult>>()
      .mockResolvedValueOnce({
        blob: new Blob(["jpeg"], { type: "image/jpeg" }),
        contentType: "image/jpeg",
        capturedAt: "2026-05-27T01:00:00.000Z",
        width: 1280,
        height: 720
      })
      .mockRejectedValueOnce(new Error("refresh failed"));

    const view = render(
      <TestViewportPreview
        fetchFrame={fetchFrame}
        resolveErrorMessage={(error) =>
          error instanceof Error ? error.message : "unknown error"
        }
      />
    );

    await waitFor(() => expect(screen.getByTestId("has-frame")).toHaveTextContent("true"));
    expect(screen.getByTestId("frame-url")).toHaveTextContent("blob:frame-1");

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() =>
      expect(screen.getByTestId("last-error")).toHaveTextContent("refresh failed")
    );
    expect(screen.getByTestId("has-frame")).toHaveTextContent("true");
    expect(screen.getByTestId("frame-url")).toHaveTextContent("blob:frame-1");
    view.unmount();
  });

  it("polls on the configured interval while enabled", async () => {
    vi.useFakeTimers();
    const fetchFrame = vi.fn(async () => ({
      blob: new Blob(["jpeg"], { type: "image/jpeg" }),
      contentType: "image/jpeg",
      capturedAt: "2026-05-27T01:00:00.000Z",
      width: 640,
      height: 360
    }));

    const view = render(
      <TestViewportPreview
        fetchFrame={fetchFrame}
        pollIntervalMs={400}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchFrame).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(fetchFrame).toHaveBeenCalledTimes(2);
    view.unmount();
  });
});
