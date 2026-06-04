import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readLocalClipboardPayload,
  writeLocalClipboardPayload
} from "../dist/clipboardBridge.js";

describe("clipboardBridge", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reads a text clipboard payload from the browser clipboard", async () => {
    const readText = vi.fn(async () => "Clipboard text");
    Object.defineProperty(navigator, "clipboard", {
      value: { readText },
      configurable: true
    });

    const payload = await readLocalClipboardPayload();

    expect(payload).toEqual({
      type: "text",
      content: "Clipboard text",
      mimeType: "text/plain"
    });
  });

  it("reads an image clipboard payload from browser clipboard items", async () => {
    const imageBytes = Uint8Array.from([1, 2, 3]);
    const imageBlob = {
      async arrayBuffer() {
        return imageBytes.buffer.slice(imageBytes.byteOffset, imageBytes.byteOffset + imageBytes.byteLength);
      }
    };
    const read = vi.fn(async () => [
      {
        types: ["image/png"],
        getType: vi.fn(async () => imageBlob)
      }
    ]);
    Object.defineProperty(navigator, "clipboard", {
      value: { read, readText: vi.fn(async () => "") },
      configurable: true
    });

    const payload = await readLocalClipboardPayload();

    expect(payload).toEqual({
      type: "image",
      content: Buffer.from(imageBytes).toString("base64"),
      mimeType: "image/png"
    });
  });

  it("writes text and image payloads back to the browser clipboard", async () => {
    const writeText = vi.fn(async () => undefined);
    const write = vi.fn(async () => undefined);

    class MockClipboardItem {
      constructor(items) {
        this.items = items;
      }
    }

    Object.defineProperty(navigator, "clipboard", {
      value: { writeText, write },
      configurable: true
    });
    vi.stubGlobal("ClipboardItem", MockClipboardItem);

    await writeLocalClipboardPayload({
      type: "text",
      content: "Paste me",
      mimeType: "text/plain",
      sizeBytes: 8
    });

    expect(writeText).toHaveBeenCalledWith("Paste me");

    await writeLocalClipboardPayload({
      type: "image",
      content: Buffer.from([1, 2, 3]).toString("base64"),
      mimeType: "image/png",
      sizeBytes: 3
    });

    expect(write).toHaveBeenCalledTimes(1);
    const [items] = write.mock.calls[0] ?? [];
    expect(items).toHaveLength(1);
    const clipboardItem = items?.[0];
    expect(Object.keys(clipboardItem?.items ?? {})).toContain("image/png");
  });
});
