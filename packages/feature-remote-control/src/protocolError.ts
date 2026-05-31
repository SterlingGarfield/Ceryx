import { CeryxApiError } from "@ceryx/client-sdk";

export type RemoteErrorState =
  | "agent_offline"
  | "not_paired"
  | "permission_denied"
  | "codex_not_found"
  | "codex_minimized"
  | "capture_failed"
  | "input_blocked"
  | "diff_too_large"
  | "disk_low"
  | "token_invalid"
  | "unknown";

export interface ResolvedProtocolError {
  state: RemoteErrorState;
  code?: string;
  hint?: string;
  traceId?: string;
  message: string;
}

type ErrorMessagePreset = {
  state: RemoteErrorState;
  message: string;
};

const messageByCode: Record<string, ErrorMessagePreset> = {
  E_AGENT_OFFLINE: {
    state: "agent_offline",
    message: "Local Agent is offline or unreachable."
  },
  E_NOT_PAIRED: {
    state: "not_paired",
    message: "Device is not paired. Pair this client before continuing."
  },
  E_TOKEN_INVALID: {
    state: "token_invalid",
    message: "Device token is invalid. Re-pair this client."
  },
  E_PERMISSION_DENIED: {
    state: "permission_denied",
    message: "Permission denied for this action."
  },
  E_CODEX_NOT_FOUND: {
    state: "codex_not_found",
    message: "Codex window not found."
  },
  E_CODEX_MINIMIZED: {
    state: "codex_minimized",
    message: "Codex window is minimized."
  },
  E_CAPTURE_FAILED: {
    state: "capture_failed",
    message: "Capture failed. Refresh Codex window and retry."
  },
  E_CAPTURE_INACTIVE: {
    state: "capture_failed",
    message: "Capture is inactive. Start capture and retry."
  },
  E_INPUT_BLOCKED: {
    state: "input_blocked",
    message: "Input is blocked by another active controller."
  },
  E_DIFF_TOO_LARGE: {
    state: "diff_too_large",
    message: "Diff is too large to render fully."
  },
  E_DISK_LOW: {
    state: "disk_low",
    message: "Recording stopped because disk space is low."
  }
};

function normalizeErrorMessage(message: string | undefined, fallback: string): string {
  if (message && message.trim()) {
    return message.trim();
  }

  return fallback;
}

function composeMessage(baseMessage: string, hint?: string, traceId?: string): string {
  const segments = [baseMessage];
  if (hint?.trim()) {
    segments.push(`Hint: ${hint.trim()}`);
  }
  if (traceId?.trim()) {
    segments.push(`traceId=${traceId.trim()}`);
  }

  return segments.join(" ");
}

export function resolveProtocolError(
  error: unknown,
  fallbackMessage: string
): ResolvedProtocolError {
  if (error instanceof CeryxApiError) {
    const preset = messageByCode[error.code];
    const baseMessage = normalizeErrorMessage(
      error.message,
      preset?.message ?? fallbackMessage
    );

    return {
      state: preset?.state ?? "unknown",
      code: error.code,
      hint: error.hint,
      traceId: error.traceId,
      message: composeMessage(baseMessage, error.hint, error.traceId)
    };
  }

  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (
      lower.includes("offline") ||
      lower.includes("network") ||
      lower.includes("fetch")
    ) {
      return {
        state: "agent_offline",
        message: "Local Agent is offline or unreachable."
      };
    }

    return {
      state: "unknown",
      message: normalizeErrorMessage(error.message, fallbackMessage)
    };
  }

  return {
    state: "unknown",
    message: fallbackMessage
  };
}
