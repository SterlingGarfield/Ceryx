import { describe, expect, it } from "vitest";
import { AgentClient } from "./AgentClient";

describe("AgentClient", () => {
  it("adds bearer token for authenticated requests", async () => {
    const calls: RequestInit[] = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (_url, init) => {
        calls.push(init ?? {});
        return Response.json({ ok: true });
      }
    });

    await client.agentStatus();

    expect(calls[0]?.headers).toMatchObject({
      Authorization: "Bearer token_123"
    });
  });

  it("does not require token for health checks", async () => {
    const calls: RequestInit[] = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527/",
      fetchImpl: async (_url, init) => {
        calls.push(init ?? {});
        return Response.json({ ok: true });
      }
    });

    await client.health();

    expect(calls[0]?.headers).toMatchObject({
      Accept: "application/json"
    });
    expect(calls[0]?.headers).not.toMatchObject({
      Authorization: expect.any(String)
    });
  });
});
