import type { ClipboardReceiveResponse, ClipboardSendRequest } from "@ceryx/client-sdk";

export function clipboardPayloadSignature(payload: ClipboardSendRequest): string {
  return `${payload.type}|${payload.mimeType}|${payload.content}`;
}

export async function readLocalClipboardPayload(): Promise<ClipboardSendRequest | null> {
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard) {
    return null;
  }

  if (typeof clipboard.read === "function") {
    try {
      const items = await clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType || typeof item.getType !== "function") {
          continue;
        }

        const blob = await item.getType(imageType);
        return {
          type: "image",
          content: await blobToBase64(blob),
          mimeType: imageType
        };
      }
    } catch {
      // Fall back to readText when direct item access is unavailable.
    }
  }

  if (typeof clipboard.readText === "function") {
    const text = await clipboard.readText();
    if (text.length > 0) {
      return {
        type: "text",
        content: text,
        mimeType: "text/plain"
      };
    }
  }

  return null;
}

export async function writeLocalClipboardPayload(payload: ClipboardReceiveResponse): Promise<void> {
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard) {
    throw new Error("Local clipboard access is unavailable in this browser context.");
  }

  if (payload.type === "text") {
    if (typeof clipboard.writeText !== "function") {
      throw new Error("Local clipboard write is unavailable in this browser context.");
    }

    await clipboard.writeText(payload.content);
    return;
  }

  if (typeof ClipboardItem === "undefined" || typeof clipboard.write !== "function") {
    throw new Error("Image clipboard is unavailable in this browser.");
  }

  const blob = base64ToBlob(payload.content, payload.mimeType || "image/png");
  await clipboard.write([
    new ClipboardItem({
      [payload.mimeType || "image/png"]: blob
    })
  ]);
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function base64ToBlob(content: string, mimeType: string): Blob {
  const markerIndex = content.indexOf("base64,");
  const payload = markerIndex >= 0 ? content.slice(markerIndex + "base64,".length) : content;
  if (typeof Buffer !== "undefined") {
    return new Blob([Buffer.from(payload, "base64")], {
      type: mimeType || "image/png"
    });
  }

  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], {
    type: mimeType || "image/png"
  });
}
