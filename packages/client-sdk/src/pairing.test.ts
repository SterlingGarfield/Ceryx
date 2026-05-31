import { describe, expect, it } from "vitest";
import { AgentClient } from "./AgentClient";

describe("pairing api", () => {
  it("returns rejected payload for pairing request conflicts", async () => {
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            ok: false,
            state: "rejected",
            rejectedReason: "pending_pairing_exists"
          }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" }
          }
        )
    });

    const response = await client.requestPairing({
      clientName: "iPad",
      clientType: "ipad",
      platform: "ios"
    });

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.rejectedReason).toBe("pending_pairing_exists");
    }
  });

  it("returns rejected payload for invalid pairing code", async () => {
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            ok: false,
            state: "rejected",
            isLocked: false,
            failedAttempts: 1,
            rejectedReason: "code_mismatch"
          }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" }
          }
        )
    });

    const response = await client.confirmPairing({
      pairingId: "pair_001",
      code: "000000"
    });

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.rejectedReason).toBe("code_mismatch");
      expect(response.failedAttempts).toBe(1);
    }
  });

  it("returns code payload for desktop confirmation", async () => {
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            ok: true,
            state: "code_input",
            code: "654321"
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        )
    });

    const response = await client.desktopConfirmPairing({
      pairingId: "pair_001"
    });

    expect(response.ok).toBe(true);
    expect(response.state).toBe("code_input");
    expect(response.code).toBe("654321");
  });
});
