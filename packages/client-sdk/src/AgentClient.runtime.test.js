import { describe, expect, it } from "vitest";
import { AgentClient } from "../dist/index.js";

describe("AgentClient runtime", () => {
  it("falls back from https to localhost http when enabled", async () => {
    const calls = [];
    let attempts = 0;
    const client = new AgentClient({
      baseUrl: "https://127.0.0.1:41527",
      allowHttpFallback: true,
      fetchImpl: async (url) => {
        calls.push(String(url));
        attempts += 1;
        if (attempts === 1) {
          throw new TypeError("self signed certificate");
        }

        return Response.json({ ok: true });
      }
    });

    await client.health();

    expect(calls).toEqual([
      "https://127.0.0.1:41527/api/v1/health",
      "http://127.0.0.1:41528/api/v1/health"
    ]);
  });

  it("rejects authenticated requests when the pinned fingerprint mismatches", async () => {
    const calls = [];
    const client = new AgentClient({
      baseUrl: "https://127.0.0.1:41527",
      getToken: () => "token_123",
      expectedCertFingerprint:
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      fetchImpl: async (url) => {
        calls.push(String(url));
        if (String(url).endsWith("/api/v1/agent/cert-fingerprint")) {
          return Response.json({
            fingerprint:
              "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
          });
        }

        return Response.json({
          agentVersion: "0.6.0",
          deviceName: "test-pc",
          platform: "windows",
          status: "running",
          httpPort: 41527,
          supportsWebRTC: true,
          supportsDesktopClient: true,
          codexStatus: "found"
        });
      }
    });

    await expect(client.agentStatus()).rejects.toMatchObject({
      code: "E_CERT_FINGERPRINT_MISMATCH"
    });
    expect(calls).toEqual(["https://127.0.0.1:41527/api/v1/agent/cert-fingerprint"]);
  });

  it("uploads files through the dedicated files endpoint", async () => {
    const calls = [];
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
  });

  it("lists files through the dedicated files endpoint", async () => {
    const calls = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          ok: true,
          path: "uploads",
          limit: 100,
          total: 1,
          files: [
            {
              fileId: "file_001",
              fileName: "notes.txt",
              sizeBytes: 10,
              mimeType: "text/plain",
              storedPath: "C:/tmp/notes.txt",
              uploadedAt: "2026-05-29T00:00:00.000Z",
              targetPath: "docs/inbox"
            }
          ]
        });
      }
    });

    const files = await client.listFiles("uploads", 100);

    expect(files).toHaveLength(1);
    expect(files[0]?.fileId).toBe("file_001");
    expect(calls[0]?.url).toBe("http://127.0.0.1:41527/api/v1/files/list?path=uploads&limit=100");
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("downloads files through the dedicated files endpoint", async () => {
    const calls = [];
    const controller = new AbortController();
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response("hello", {
          status: 200,
          headers: {
            "Content-Type": "text/plain"
          }
        });
      }
    });

    const blob = await client.downloadFile("file_001", controller.signal);

    expect(await blob.text()).toBe("hello");
    expect(calls[0]?.url).toBe("http://127.0.0.1:41527/api/v1/files/download/file_001");
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("fetches connection stats through the dedicated connection-stats endpoint", async () => {
    const calls = [];
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
  });

  it("includes window ids when starting capture for a specific Codex window", async () => {
    const calls = [];
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

  it("requests a specific capture frame for a window id", async () => {
    const calls = [];
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
    const calls = [];
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

  it("deletes files through the dedicated files endpoint", async () => {
    const calls = [];
    const client = new AgentClient({
      baseUrl: "http://127.0.0.1:41527",
      getToken: () => "token_123",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          ok: true,
          deleted: true,
          fileId: "file_001"
        });
      }
    });

    await client.deleteFile("file_001");

    expect(calls[0]?.url).toBe("http://127.0.0.1:41527/api/v1/files/file_001");
    expect(calls[0]?.init?.method).toBe("DELETE");
  });
});
