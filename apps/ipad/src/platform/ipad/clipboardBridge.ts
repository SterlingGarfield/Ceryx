import type { ClipboardReceiveResponse, ClipboardSendRequest, ClipboardSendResponse } from "@ceryx/client-sdk";
import {
  clipboardPayloadSignature,
  readLocalClipboardPayload,
  writeLocalClipboardPayload
} from "@ceryx/feature-remote-control";
import { receiveClipboard, sendClipboard } from "./agentGateway";

export {
  clipboardPayloadSignature,
  readLocalClipboardPayload,
  writeLocalClipboardPayload
};

export async function sendLocalClipboardPayloadToWindows(
  baseUrl: string,
  payload: ClipboardSendRequest
): Promise<ClipboardSendResponse> {
  return sendClipboard(baseUrl, payload);
}

export async function syncLocalClipboardToWindows(
  baseUrl: string
): Promise<ClipboardSendResponse | null> {
  const payload = await readLocalClipboardPayload();
  if (!payload) {
    return null;
  }

  return sendLocalClipboardPayloadToWindows(baseUrl, payload);
}

export async function copyWindowsClipboardToLocal(
  baseUrl: string
): Promise<ClipboardReceiveResponse> {
  const payload = await receiveClipboard(baseUrl);
  await writeLocalClipboardPayload(payload);
  return payload;
}
