import { describe, expect, it } from "vitest";
import { createPairingStore } from "./usePairingStore";

describe("usePairingStore", () => {
  it("tracks pairing lifecycle states", () => {
    const store = createPairingStore();

    store.getState().beginRequest({
      clientName: "iPad Pro",
      clientType: "ipad",
      platform: "ios"
    });
    expect(store.getState().state).toBe("requesting");

    store.getState().setRequestAccepted({
      pairingId: "pair_001",
      expiresAt: "2026-05-21T02:00:00.000Z",
      state: "waiting_desktop_confirm"
    });
    store.getState().markCodeInput();
    store.getState().setCode("123456");
    store.getState().markVerifying();
    store.getState().markRejected({
      rejectedReason: "code_mismatch",
      failedAttempts: 1
    });

    const rejected = store.getState();
    expect(rejected.pairingId).toBe("pair_001");
    expect(rejected.code).toBe("123456");
    expect(rejected.state).toBe("rejected");
    expect(rejected.failedAttempts).toBe(1);
    expect(rejected.rejectedReason).toBe("code_mismatch");
  });
});
