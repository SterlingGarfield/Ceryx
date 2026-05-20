import { describe, expect, it } from "vitest";
import { AgentClient, CeryxApiError, isTokenInvalidError } from "./AgentClient";

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

  it("stores token after pairing confirm success", async () => {
    let storedToken: string | undefined;

    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      setToken: (token) => {
        storedToken = token;
      },
      fetchImpl: async () =>
        Response.json({
          ok: true,
          deviceId: "dev_001",
          deviceToken: "dt_001",
          permissions: ["view_window"]
        })
    });

    const result = await client.confirmPairing({
      pairingId: "pair_001",
      code: "123456"
    });

    expect(result.ok).toBe(true);
    expect(storedToken).toBe("dt_001");
  });

  it("clears token and raises callback on E_TOKEN_INVALID", async () => {
    let clearCalled = false;
    let callbackError: CeryxApiError | undefined;

    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      clearToken: () => {
        clearCalled = true;
      },
      onTokenInvalid: (error) => {
        callbackError = error;
      },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: "E_TOKEN_INVALID",
              message: "Invalid token",
              hint: "Pair again.",
              traceId: "trace_001"
            }
          }),
          {
            status: 401,
            headers: {
              "Content-Type": "application/json"
            }
          }
        )
    });

    await expect(client.connect()).rejects.toBeInstanceOf(CeryxApiError);
    expect(clearCalled).toBe(true);
    expect(callbackError).toBeDefined();
    expect(callbackError?.code).toBe("E_TOKEN_INVALID");
    expect(isTokenInvalidError(callbackError)).toBe(true);
  });

  it("uses exponential reconnect delays from 1s with max 30s", async () => {
    const waits: number[] = [];
    let attempts = 0;

    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      waitImpl: async (delayMs) => {
        waits.push(delayMs);
      },
      fetchImpl: async () => {
        attempts += 1;
        if (attempts < 4) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: {
                code: "E_AGENT_OFFLINE",
                message: "Agent offline",
                traceId: "trace_002"
              }
            }),
            {
              status: 503,
              headers: { "Content-Type": "application/json" }
            }
          );
        }

        return Response.json({
          agentVersion: "0.3.0",
          deviceName: "test-pc",
          platform: "windows",
          status: "running",
          httpPort: 41527,
          supportsWebRTC: false,
          supportsDesktopClient: true,
          codexStatus: "found"
        });
      }
    });

    const status = await client.reconnect();

    expect(status.status).toBe("running");
    expect(waits).toEqual([1000, 2000, 4000]);
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

  it("calls codex window endpoint with authenticated GET", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          status: "found",
          windowId: "w_001",
          title: "Codex",
          processName: "codex",
          candidateCount: 1,
          lastUpdatedAt: "2026-05-21T00:00:00.000Z"
        });
      }
    });

    const window = await client.getCodexWindow();

    expect(window.status).toBe("found");
    expect(window.windowId).toBe("w_001");
    expect(calls[0]?.url).toBe("http://127.0.0.1:41527/api/v1/codex/window");
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[0]?.init?.headers).toMatchObject({
      Accept: "application/json",
      Authorization: "Bearer token_123"
    });
  });

  it("sends multipart payload for upload image", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          ok: true,
          assetId: "asset_001",
          fileName: "asset_001.png",
          sizeBytes: 12
        });
      }
    });

    const blob = new Blob(["png"], { type: "image/png" });
    const response = await client.uploadImage({ fileName: "codex.png", content: blob });

    expect(response.ok).toBe(true);
    expect(calls[0]?.url).toBe("http://127.0.0.1:41527/api/v1/assets/upload-image");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBeInstanceOf(FormData);
    expect(calls[0]?.init?.headers).toMatchObject({
      Accept: "application/json",
      Authorization: "Bearer token_123"
    });
    expect(calls[0]?.init?.headers).not.toMatchObject({
      "Content-Type": "application/json"
    });
  });

  it("surfaces capture policy errors with typed api error", async () => {
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: "E_CAPTURE_DENIED",
              message: "Capture target must be codex_window.",
              traceId: "trace_capture_001"
            }
          }),
          {
            status: 403,
            headers: {
              "Content-Type": "application/json"
            }
          }
        )
    });

    await expect(
      client.startCapture({
        mode: "balanced",
        target: "full_desktop"
      })
    ).rejects.toMatchObject({
      code: "E_CAPTURE_DENIED",
      status: 403
    });
  });

  it("posts prompt payload to prompt endpoint", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          ok: true,
          status: "sent",
          submitted: true
        });
      }
    });

    const response = await client.sendPrompt({ prompt: "run tests", submit: true });

    expect(response.ok).toBe(true);
    expect(calls[0]?.url).toBe("http://127.0.0.1:41527/api/v1/prompt/send");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toMatchObject({
      Accept: "application/json",
      Authorization: "Bearer token_123",
      "Content-Type": "application/json"
    });
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ prompt: "run tests", submit: true }));
  });
});
