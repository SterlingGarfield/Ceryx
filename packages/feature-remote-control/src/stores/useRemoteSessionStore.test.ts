import { describe, expect, it } from "vitest";
import { createRemoteSessionStore } from "./useRemoteSessionStore";

describe("useRemoteSessionStore", () => {
  it("tracks session, permissions, and capture state", () => {
    const store = createRemoteSessionStore();

    store.getState().connectSession({
      sessionId: "sess_001",
      deviceId: "dev_001",
      permissions: ["view_window", "send_prompt"]
    });
    store.getState().markActive();
    store.getState().setCaptureState({
      ok: true,
      active: true,
      paused: false,
      mode: "balanced",
      windowId: "w_001",
      width: 1280,
      height: 720
    });
    store.getState().setLatency(33);

    const state = store.getState();
    expect(state.status).toBe("active");
    expect(state.permissions).toContain("view_window");
    expect(state.captureState.active).toBe(true);
    expect(state.captureState.windowId).toBe("w_001");
    expect(state.latencyMs).toBe(33);
  });
});
