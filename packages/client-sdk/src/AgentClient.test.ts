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

  it("surfaces non-json pairing failures as api errors", async () => {
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      fetchImpl: async () =>
        new Response(null, {
          status: 500
        })
    });

    await expect(
      client.confirmPairing({
        pairingId: "pair_001",
        code: "123456"
      })
    ).rejects.toMatchObject({
      code: "E_HTTP_500",
      status: 500
    });
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

  it("binds global fetch when no custom fetch implementation is provided", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ context: unknown; url: string; init: RequestInit | undefined }> = [];

    globalThis.fetch = (async function (
      this: typeof globalThis,
      input: RequestInfo | URL,
      init?: RequestInit
    ) {
      calls.push({
        context: this,
        url: String(input),
        init
      });
      return Response.json({ ok: true });
    }) as typeof fetch;

    try {
      const client = new AgentClient({
        baseUrl: "http://127.0.0.1:41527"
      });

      await client.health();
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]?.context).toBe(globalThis);
    expect(calls[0]?.url).toBe("http://127.0.0.1:41527/api/v1/health");
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

  it("calls codex windows list endpoint with authenticated GET", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          windows: [
            {
              status: "focused",
              windowId: "w_001",
              title: "Codex A",
              processName: "codex",
              candidateCount: 2,
              lastUpdatedAt: "2026-05-21T00:00:00.000Z"
            },
            {
              status: "found",
              windowId: "w_002",
              title: "Codex B",
              processName: "codex",
              candidateCount: 2,
              lastUpdatedAt: "2026-05-21T00:00:00.000Z"
            }
          ],
          totalCount: 2,
          lastUpdatedAt: "2026-05-21T00:00:00.000Z"
        });
      }
    });

    const listWindows = (client as unknown as { listCodexWindows: () => Promise<unknown> }).listCodexWindows;
    const response = await listWindows.call(client);
    const root = response as {
      windows: Array<{ status: string; windowId: string }>;
      totalCount: number;
    };

    expect(root.totalCount).toBe(2);
    expect(root.windows).toHaveLength(2);
    expect(root.windows[0]?.windowId).toBe("w_001");
    expect(calls[0]?.url).toBe("http://127.0.0.1:41527/api/v1/codex/windows");
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

  it("sends multipart payload for file upload", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          ok: true,
          fileId: "file_001",
          fileName: "notes.txt",
          sizeBytes: 10,
          mimeType: "text/plain",
          storedPath: "C:/tmp/notes.txt",
          uploadedAt: "2026-05-29T00:00:00.000Z",
          targetPath: "docs/inbox"
        });
      }
    });

    const file = new File(["hello file"], "notes.txt", { type: "text/plain" });
    const response = await client.uploadFile(file, "docs/inbox");

    expect(response.ok).toBe(true);
    expect(response.fileId).toBe("file_001");
    expect(calls[0]?.url).toBe("http://127.0.0.1:41527/api/v1/files/upload");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBeInstanceOf(FormData);
    expect((calls[0]?.init?.body as FormData).get("targetPath")).toBe("docs/inbox");
  });

  it("fetches connection stats through the dedicated connection-stats endpoint", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
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
        });
      }
    });

    const response = await client.getConnectionStats();

    expect(response.ok).toBe(true);
    expect(response.activeViewers).toBe(2);
    expect(calls[0]?.url).toBe("http://127.0.0.1:41527/api/v1/agent/connection-stats");
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[0]?.init?.headers).toMatchObject({
      Accept: "application/json",
      Authorization: "Bearer token_123"
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

  it("includes window ids when starting capture for a specific Codex window", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          ok: true,
          active: true,
          paused: false,
          mode: "balanced",
          windowId: "w_002",
          width: 1280,
          height: 720
        });
      }
    });

    await client.startCapture({
      mode: "balanced",
      target: "codex_window",
      windowId: "w_002"
    });

    expect(calls[0]?.url).toBe("http://127.0.0.1:41527/api/v1/capture/start");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        mode: "balanced",
        target: "codex_window",
        windowId: "w_002"
      })
    );
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

  it("sends and receives clipboard payloads through clipboard endpoints", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith("/api/v1/clipboard/send")) {
          return Response.json({
            ok: true,
            type: "text",
            mimeType: "text/plain",
            sizeBytes: 24
          });
        }

        if (String(url).endsWith("/api/v1/clipboard/receive")) {
          return Response.json({
            ok: true,
            type: "text",
            content: "clipboard payload",
            mimeType: "text/plain",
            sizeBytes: 24
          });
        }

        return Response.json({
          ok: true,
          cleared: true
        });
      }
    });

    const sendResponse = await client.sendClipboard({
      type: "text",
      content: "clipboard payload",
      mimeType: "text/plain"
    });
    const receiveResponse = await client.receiveClipboard();
    const clearResponse = await client.clearClipboard();

    expect(sendResponse.ok).toBe(true);
    expect(sendResponse.type).toBe("text");
    expect(receiveResponse.content).toBe("clipboard payload");
    expect(clearResponse.cleared).toBe(true);

    expect(calls[0]?.url).toBe("http://127.0.0.1:41527/api/v1/clipboard/send");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        type: "text",
        content: "clipboard payload",
        mimeType: "text/plain"
      })
    );
    expect(calls[1]?.url).toBe("http://127.0.0.1:41527/api/v1/clipboard/receive");
    expect(calls[1]?.init?.method).toBe("GET");
    expect(calls[2]?.url).toBe("http://127.0.0.1:41527/api/v1/clipboard/clear");
    expect(calls[2]?.init?.method).toBe("POST");
  });

  it("posts local management action to restart endpoint", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          ok: true,
          action: "restart-request",
          status: "accepted",
          executed: false,
          message: "Restart request accepted but not executed in development mode."
        });
      }
    });

    const response = await client.restartRequest();

    expect(response.ok).toBe(true);
    expect(response.action).toBe("restart-request");
    expect(calls[0]?.url).toBe("http://127.0.0.1:41527/api/v1/agent/restart-request");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toMatchObject({
      Accept: "application/json",
      Authorization: "Bearer token_123"
    });
  });

  it("posts local logs action to open logs endpoint", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          ok: true,
          action: "open-logs-folder",
          status: "applied",
          executed: true,
          message: "Open logs folder request forwarded to local shell."
        });
      }
    });

    const response = await client.openLogsFolder();

    expect(response.ok).toBe(true);
    expect(response.action).toBe("open-logs-folder");
    expect(calls[0]?.url).toBe("http://127.0.0.1:41527/api/v1/agent/open-logs-folder");
    expect(calls[0]?.init?.method).toBe("POST");
  });

  it("posts high-risk confirmation when starting recording", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          ok: true,
          status: "recording",
          startedAt: "2026-05-22T07:00:00.000Z"
        });
      }
    });

    const response = await client.startRecording(true);

    expect(response.ok).toBe(true);
    expect(calls[0]?.url).toBe("http://127.0.0.1:41527/api/v1/media/recording/start");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ confirmHighRisk: true }));
  });

  it("posts recording options when starting recording with audio", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          ok: true,
          status: "recording",
          startedAt: "2026-05-22T07:00:00.000Z",
          audioEnabled: true,
          audioFormat: "pcm_s16le"
        });
      }
    });

    const response = await client.startRecording({
      confirmHighRisk: true,
      includeAudio: true,
      audioSource: "system",
      maxDurationMinutes: 45,
      segmentSizeMB: 4096
    });

    expect(response.audioEnabled).toBe(true);
    expect(calls[0]?.url).toBe("http://127.0.0.1:41527/api/v1/media/recording/start");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        confirmHighRisk: true,
        includeAudio: true,
        audioSource: "system",
        maxDurationMinutes: 45,
        segmentSizeMB: 4096
      })
    );
  });

  it("lists recordings from the recordings endpoint", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          ok: true,
          total: 1,
          items: [
            {
              recordingId: "rec_001",
              fileName: "rec_001.mp4",
              sizeBytes: 1024,
              durationSeconds: 12.5,
              audioEnabled: false,
              audioFormat: "none",
              thumbnailFileName: "thumbnail.jpg",
              outputPaths: ["rec_001.mp4"],
              startedAt: "2026-05-22T07:00:00.000Z",
              stoppedAt: "2026-05-22T07:00:12.500Z"
            }
          ]
        });
      }
    });

    const response = await client.listRecordings(25);

    expect(response.total).toBe(1);
    expect(calls[0]?.url).toBe("http://127.0.0.1:41527/api/v1/media/recordings?limit=25");
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("downloads recordings from the recordings download endpoint", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response("recording-bytes", {
          status: 200,
          headers: {
            "Content-Type": "video/mp4"
          }
        });
      }
    });

    const blob = await client.downloadRecording("rec_001.mp4");

    expect(blob.type).toBe("video/mp4");
    expect(calls[0]?.url).toBe("http://127.0.0.1:41527/api/v1/media/recordings/download/rec_001.mp4");
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("posts high-risk confirmation when pausing control", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          ok: true,
          action: "pause-control",
          status: "applied",
          executed: true,
          message: "Agent control paused."
        });
      }
    });

    const response = await client.pauseControl(true);

    expect(response.ok).toBe(true);
    expect(calls[0]?.url).toBe("http://127.0.0.1:41527/api/v1/agent/pause-control");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ confirmHighRisk: true }));
  });

  it("posts high-risk confirmation when deleting trusted device", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          ok: true,
          deleted: true
        });
      }
    });

    const response = await client.deleteDevice("dev_001", true);

    expect(response.ok).toBe(true);
    expect(calls[0]?.url).toBe("http://127.0.0.1:41527/api/v1/devices/dev_001");
    expect(calls[0]?.init?.method).toBe("DELETE");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ confirmHighRisk: true }));
  });

  it("requests paginated logs with filters", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          ok: true,
          page: 2,
          pageSize: 50,
          total: 120,
          hasMore: true,
          items: [
            {
              id: "audit_1",
              action: "prompt.send.accepted",
              details: "submitted=true",
              severity: "info",
              sessionId: "dev_test_001",
              createdAt: "2026-05-22T02:00:00.000Z"
            }
          ]
        });
      }
    });

    const response = await client.getLogs({
      page: 2,
      pageSize: 50,
      severity: "warning",
      action: "input.rejected",
      sessionId: "dev_test_001"
    });

    expect(response.ok).toBe(true);
    expect(response.items).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "http://127.0.0.1:41527/api/v1/logs?page=2&pageSize=50&severity=warning&action=input.rejected&sessionId=dev_test_001"
    );
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("gets split settings payload", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          ok: true,
          updatedAt: "2026-05-22T02:10:00.000Z",
          agentSettings: {
            httpPort: 41527,
            directTestCommand: "dotnet test agent/windows/Ceryx.Agent.Windows.sln",
            allowFullscreenCapture: false,
            allowClearLogs: false,
            defaultCaptureMode: "balanced"
          },
          clientSettings: {
            theme: "system",
            compactMode: false,
            showLatency: true,
            keyboardShortcuts: true,
            notificationsEnabled: true,
            logsAutoRefresh: true,
            previewRefreshProfile: "balanced"
          }
        });
      }
    });

    const response = await client.getSettings();

    expect(response.ok).toBe(true);
    expect(response.agentSettings.httpPort).toBe(41527);
    expect(calls[0]?.url).toBe("http://127.0.0.1:41527/api/v1/settings");
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("patches agent settings with high-risk confirmation", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          ok: true,
          updatedAt: "2026-05-22T02:11:00.000Z",
          agentSettings: {
            httpPort: 41528,
            directTestCommand: "dotnet test agent/windows/Ceryx.Agent.Windows.sln --filter Settings",
            allowFullscreenCapture: true,
            allowClearLogs: true,
            defaultCaptureMode: "balanced"
          },
          clientSettings: {
            theme: "system",
            compactMode: false,
            showLatency: true,
            keyboardShortcuts: true,
            notificationsEnabled: true,
            logsAutoRefresh: true,
            previewRefreshProfile: "balanced"
          }
        });
      }
    });

    const response = await client.patchAgentSettings(
      {
        httpPort: 41528,
        allowFullscreenCapture: true,
        allowClearLogs: true
      },
      true
    );

    expect(response.ok).toBe(true);
    expect(calls[0]?.url).toBe("http://127.0.0.1:41527/api/v1/settings");
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({
        agentSettings: {
          httpPort: 41528,
          allowFullscreenCapture: true,
          allowClearLogs: true
        },
        confirmHighRisk: true
      })
    );
  });

  it("gets capture frame payload with metadata headers", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const frameBlob = new Blob(["jpeg"], { type: "image/jpeg" });
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(frameBlob, {
          status: 200,
          headers: {
            "Content-Type": "image/jpeg",
            "X-Ceryx-Frame-Captured-At": "2026-05-27T01:00:00.000Z",
            "X-Ceryx-Frame-Width": "1280",
            "X-Ceryx-Frame-Height": "720"
          }
        });
      }
    });

    const frame = await client.getCaptureFrame();

    expect(frame.contentType).toBe("image/jpeg");
    expect(frame.capturedAt).toBe("2026-05-27T01:00:00.000Z");
    expect(frame.width).toBe(1280);
    expect(frame.height).toBe(720);
    expect(frame.blob.type).toBe("image/jpeg");
    expect(calls[0]?.url).toBe("http://127.0.0.1:41527/api/v1/capture/frame");
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[0]?.init?.headers).toMatchObject({
      Accept: "image/jpeg",
      Authorization: "Bearer token_123"
    });
  });

  it("requests a specific capture frame for a window id", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const frameBlob = new Blob(["jpeg"], { type: "image/jpeg" });
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(frameBlob, {
          status: 200,
          headers: {
            "Content-Type": "image/jpeg",
            "X-Ceryx-Frame-Captured-At": "2026-05-27T01:00:00.000Z",
            "X-Ceryx-Frame-Width": "1280",
            "X-Ceryx-Frame-Height": "720"
          }
        });
      }
    });

    await client.getCaptureFrame("w_001");

    expect(calls[0]?.url).toBe(
      "http://127.0.0.1:41527/api/v1/capture/frame?windowId=w_001"
    );
  });

  it("posts screenshots for a specific window id", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          ok: true,
          fileName: "screenshot.png",
          fileId: "asset_001",
          sizeBytes: 123,
          mimeType: "image/png"
        });
      }
    });

    await client.screenshot("w_001");

    expect(calls[0]?.url).toBe(
      "http://127.0.0.1:41527/api/v1/media/screenshot?windowId=w_001"
    );
    expect(calls[0]?.init?.method).toBe("POST");
  });

  it("requests project diff from diff endpoint", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          ok: true,
          status: "ready",
          summary: "2 files changed"
        });
      }
    });

    const response = await client.getProjectDiff();

    expect(response.ok).toBe(true);
    expect(response.summary).toBe("2 files changed");
    expect(calls[0]?.url).toBe("http://127.0.0.1:41527/api/v1/project/diff");
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("requests project diff files for selected project", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          ok: true,
          projectId: "workspace-default",
          projectName: "CeryxProject",
          page: 1,
          pageSize: 100,
          total: 1,
          hasMore: false,
          files: [{ path: "src/main.ts", status: "modified", additions: 3, deletions: 1 }]
        });
      }
    });

    const response = await client.getProjectDiffFiles("workspace-default");

    expect(response.ok).toBe(true);
    expect(response.files).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "http://127.0.0.1:41527/api/v1/project/diff/files?projectId=workspace-default"
    );
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("requests paged project diff files for selected project", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          ok: true,
          projectId: "workspace-default",
          projectName: "CeryxProject",
          page: 2,
          pageSize: 50,
          total: 140,
          hasMore: true,
          files: [{ path: "src/main.ts", status: "modified", additions: 3, deletions: 1 }]
        });
      }
    });

    const response = await client.getProjectDiffFiles("workspace-default", { page: 2, pageSize: 50 });

    expect(response.ok).toBe(true);
    expect(response.page).toBe(2);
    expect(response.pageSize).toBe(50);
    expect(calls[0]?.url).toBe(
      "http://127.0.0.1:41527/api/v1/project/diff/files?projectId=workspace-default&page=2&pageSize=50"
    );
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("requests single project diff file payload", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          ok: true,
          projectId: "workspace-default",
          path: "src/main.ts",
          status: "modified",
          additions: 3,
          deletions: 1,
          diffText: "@@ -1 +1 @@\n-a\n+b",
          truncated: false,
          lineLimit: 1200
        });
      }
    });

    const response = await client.getProjectDiffFile("workspace-default", "src/main.ts");

    expect(response.ok).toBe(true);
    expect(response.path).toBe("src/main.ts");
    expect(calls[0]?.url).toBe(
      "http://127.0.0.1:41527/api/v1/project/diff/file?projectId=workspace-default&path=src%2Fmain.ts"
    );
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("posts project test request to test endpoint", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          ok: true,
          status: "accepted",
          message: "queued"
        });
      }
    });

    const response = await client.requestProjectTest({ scope: "changed-modules" });

    expect(response.ok).toBe(true);
    expect(response.status).toBe("accepted");
    expect(calls[0]?.url).toBe("http://127.0.0.1:41527/api/v1/project/test-request");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ scope: "changed-modules" }));
  });

  it("requests project file index with query and limit", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          ok: true,
          projectId: "workspace-default",
          projectName: "CeryxProject",
          generatedAt: "2026-05-22T05:20:00.000Z",
          files: [
            {
              path: "apps/desktop/src/App.tsx",
              extension: "tsx",
              tracked: true,
              changed: true
            }
          ]
        });
      }
    });

    const response = await client.getProjectFiles("workspace-default", {
      query: "App",
      limit: 120
    });

    expect(response.ok).toBe(true);
    expect(response.files).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "http://127.0.0.1:41527/api/v1/project/files?projectId=workspace-default&query=App&limit=120"
    );
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("reads tasks snapshot and notification actions", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          ok: true,
          taskState: {
            status: "active",
            currentAction: "prompt.send.accepted",
            updatedAt: "2026-05-22T05:30:00.000Z"
          },
          recentPromptActions: [],
          testRequest: {
            status: "accepted",
            requestId: "testreq_001",
            scope: "changed-modules",
            message: "queued",
            requestedAt: "2026-05-22T05:30:00.000Z"
          }
        });
      }
    });

    const response = await client.getProjectTasks(6);

    expect(response.ok).toBe(true);
    expect(response.testRequest.status).toBe("accepted");
    expect(calls[0]?.url).toBe("http://127.0.0.1:41527/api/v1/project/tasks?promptLimit=6");
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("marks and clears notifications", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url).includes("/read")) {
          return Response.json({
            ok: true,
            id: "audit_01",
            read: true
          });
        }

        return Response.json({
          ok: true,
          clearedBefore: "2026-05-22T05:40:00.000Z"
        });
      }
    });

    const readResponse = await client.markNotificationRead("audit_01");
    const clearResponse = await client.clearNotifications();

    expect(readResponse.read).toBe(true);
    expect(clearResponse.ok).toBe(true);
    expect(calls[0]?.url).toBe("http://127.0.0.1:41527/api/v1/notifications/audit_01/read");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[1]?.url).toBe("http://127.0.0.1:41527/api/v1/notifications/clear");
    expect(calls[1]?.init?.method).toBe("POST");
  });
});
