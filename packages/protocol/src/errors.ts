export const CeryxErrorCodes = [
  "E_AGENT_OFFLINE",
  "E_NOT_PAIRED",
  "E_TOKEN_INVALID",
  "E_PERMISSION_DENIED",
  "E_CODEX_NOT_FOUND",
  "E_CODEX_MINIMIZED",
  "E_CAPTURE_DENIED",
  "E_CAPTURE_FAILED",
  "E_CLIPBOARD_INVALID_REQUEST",
  "E_CLIPBOARD_TOO_LARGE",
  "E_CLIPBOARD_EMPTY",
  "E_INPUT_BLOCKED",
  "E_UPLOAD_TOO_LARGE",
  "E_DIFF_TOO_LARGE",
  "E_RECORDING_BUSY",
  "E_DISK_LOW",
  "E_AGENT_PAUSED"
] as const;

export type CeryxErrorCode = (typeof CeryxErrorCodes)[number];

export interface CeryxErrorResponse {
  ok: false;
  error: {
    code: CeryxErrorCode;
    message: string;
    hint?: string;
    traceId: string;
  };
}

export interface CeryxOkResponse {
  ok: true;
}

export type CeryxApiResponse<TPayload extends object = Record<string, never>> =
  | (CeryxOkResponse & TPayload)
  | CeryxErrorResponse;
