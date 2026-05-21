import { describe, expect, it } from "vitest";
import { createConnectionStore } from "./useConnectionStore";

describe("useConnectionStore", () => {
  it("tracks current device, latency, token, and reconnect states", () => {
    const store = createConnectionStore();
    const state = store.getState();

    expect(state.currentDevice).toBeNull();
    expect(state.tokenState).toBe("missing");
    expect(state.reconnectState).toBe("idle");

    state.setCurrentDevice({
      deviceId: "dev_001",
      deviceName: "Office PC",
      platform: "windows",
      baseUrl: "http://127.0.0.1:41527"
    });
    state.setLatency(42);
    state.setTokenState("valid");
    state.scheduleReconnect(1);
    state.startReconnect(2);
    state.markConnected();

    const next = store.getState();
    expect(next.currentDevice?.deviceId).toBe("dev_001");
    expect(next.latencyMs).toBe(42);
    expect(next.tokenState).toBe("valid");
    expect(next.reconnectState).toBe("connected");
    expect(next.reconnectAttempt).toBe(0);
  });
});
