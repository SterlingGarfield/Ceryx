import type {
  AgentStatus,
  CaptureSignalRequest,
  CaptureSignalResponse,
  CaptureStartRequest,
  CaptureStateResponse,
  CodexSelectWindowRequest,
  CodexWindowSnapshot,
  InputActionResponse,
  InputHotkeyRequest,
  InputKeyRequest,
  InputMouseRequest,
  InputScrollRequest,
  InputTextRequest,
  PairingConfirmRequest,
  PairingConfirmResponse,
  PairingRequest,
  PairingRequestResponse,
  PromptSendRequest,
  PromptSendResponse,
  RecordingStartResponse,
  RecordingStopResponse,
  ScreenshotResponse,
  TrustedDevice,
  UploadImageResponse
} from "@ceryx/protocol";

export interface AgentClientOptions {
  baseUrl: string;
  getToken?: () => string | undefined;
  setToken?: (token: string) => void;
  clearToken?: () => void;
  onTokenInvalid?: (error: CeryxApiError) => void;
  fetchImpl?: typeof fetch;
  waitImpl?: (delayMs: number) => Promise<void>;
}

interface RequestConfig {
  auth: boolean;
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  allowNon2xx?: boolean;
}

interface StandardErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
    hint?: string;
    traceId?: string;
  };
}

export interface PairingRequestRejectedResponse {
  ok: false;
  state: string;
  pairingId?: string;
  expiresAt?: string;
  rejectedReason?: string;
}

export interface PairingConfirmRejectedResponse {
  ok: false;
  state: string;
  isLocked: boolean;
  failedAttempts: number;
  rejectedReason?: string;
}

export interface ReconnectOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

export interface UploadImageFile {
  fileName: string;
  content: Blob;
}

export class CeryxApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly hint?: string,
    public readonly traceId?: string
  ) {
    super(message);
    this.name = "CeryxApiError";
  }
}

export function isTokenInvalidError(error: unknown): error is CeryxApiError {
  return error instanceof CeryxApiError && error.code === "E_TOKEN_INVALID";
}

export class AgentClient {
  private readonly fetchImpl: typeof fetch;
  private readonly waitImpl: (delayMs: number) => Promise<void>;

  constructor(private readonly options: AgentClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.waitImpl = options.waitImpl ?? wait;
  }

  async health(): Promise<{ ok: true }> {
    return this.request<{ ok: true }>("/api/v1/health", { auth: false });
  }

  async requestPairing(
    request: PairingRequest
  ): Promise<PairingRequestResponse | PairingRequestRejectedResponse> {
    return this.request<PairingRequestResponse | PairingRequestRejectedResponse>(
      "/api/v1/pairing/request",
      {
        auth: false,
        method: "POST",
        body: request,
        allowNon2xx: true
      }
    );
  }

  async confirmPairing(
    request: PairingConfirmRequest
  ): Promise<PairingConfirmResponse | PairingConfirmRejectedResponse> {
    const response = await this.request<PairingConfirmResponse | PairingConfirmRejectedResponse>(
      "/api/v1/pairing/confirm",
      {
        auth: false,
        method: "POST",
        body: request,
        allowNon2xx: true
      }
    );

    if (response.ok) {
      this.options.setToken?.(response.deviceToken);
    }

    return response;
  }

  async connect(): Promise<AgentStatus> {
    return this.agentStatus();
  }

  async agentStatus(): Promise<AgentStatus> {
    return this.request<AgentStatus>("/api/v1/agent/status", { auth: true });
  }

  async listDevices(): Promise<TrustedDevice[]> {
    return this.request<TrustedDevice[]>("/api/v1/devices", { auth: true });
  }

  async deleteDevice(deviceId: string): Promise<{ ok: boolean }> {
    if (!deviceId) {
      throw new Error("deviceId is required");
    }

    return this.request<{ ok: boolean }>(`/api/v1/devices/${encodeURIComponent(deviceId)}`, {
      auth: true,
      method: "DELETE"
    });
  }

  async getCodexWindow(): Promise<CodexWindowSnapshot> {
    return this.request<CodexWindowSnapshot>("/api/v1/codex/window", { auth: true });
  }

  async focusCodexWindow(): Promise<CodexWindowSnapshot> {
    return this.request<CodexWindowSnapshot>("/api/v1/codex/focus", {
      auth: true,
      method: "POST"
    });
  }

  async refreshCodexWindow(): Promise<CodexWindowSnapshot> {
    return this.request<CodexWindowSnapshot>("/api/v1/codex/refresh", {
      auth: true,
      method: "POST"
    });
  }

  async selectCodexWindow(request: CodexSelectWindowRequest): Promise<CodexWindowSnapshot> {
    return this.request<CodexWindowSnapshot>("/api/v1/codex/select-window", {
      auth: true,
      method: "POST",
      body: request
    });
  }

  async sendPrompt(request: PromptSendRequest): Promise<PromptSendResponse> {
    return this.request<PromptSendResponse>("/api/v1/prompt/send", {
      auth: true,
      method: "POST",
      body: request
    });
  }

  async inputKey(request: InputKeyRequest): Promise<InputActionResponse> {
    return this.request<InputActionResponse>("/api/v1/input/key", {
      auth: true,
      method: "POST",
      body: request
    });
  }

  async inputMouse(request: InputMouseRequest): Promise<InputActionResponse> {
    return this.request<InputActionResponse>("/api/v1/input/mouse", {
      auth: true,
      method: "POST",
      body: request
    });
  }

  async inputScroll(request: InputScrollRequest): Promise<InputActionResponse> {
    return this.request<InputActionResponse>("/api/v1/input/scroll", {
      auth: true,
      method: "POST",
      body: request
    });
  }

  async inputHotkey(request: InputHotkeyRequest): Promise<InputActionResponse> {
    return this.request<InputActionResponse>("/api/v1/input/hotkey", {
      auth: true,
      method: "POST",
      body: request
    });
  }

  async inputText(request: InputTextRequest): Promise<InputActionResponse> {
    return this.request<InputActionResponse>("/api/v1/input/text", {
      auth: true,
      method: "POST",
      body: request
    });
  }

  async startCapture(request: CaptureStartRequest): Promise<CaptureStateResponse> {
    return this.request<CaptureStateResponse>("/api/v1/capture/start", {
      auth: true,
      method: "POST",
      body: request
    });
  }

  async stopCapture(): Promise<CaptureStateResponse> {
    return this.request<CaptureStateResponse>("/api/v1/capture/stop", {
      auth: true,
      method: "POST"
    });
  }

  async getCaptureState(): Promise<CaptureStateResponse> {
    return this.request<CaptureStateResponse>("/api/v1/capture/state", {
      auth: true
    });
  }

  async sendCaptureSignal(request: CaptureSignalRequest): Promise<CaptureSignalResponse> {
    return this.request<CaptureSignalResponse>("/api/v1/capture/webrtc/signal", {
      auth: true,
      method: "POST",
      body: request
    });
  }

  async uploadImage(file: UploadImageFile): Promise<UploadImageResponse> {
    if (!file.fileName.trim()) {
      throw new Error("fileName is required");
    }

    const form = new FormData();
    form.append("file", file.content, file.fileName);

    return this.request<UploadImageResponse>("/api/v1/assets/upload-image", {
      auth: true,
      method: "POST",
      body: form
    });
  }

  async screenshot(): Promise<ScreenshotResponse> {
    return this.request<ScreenshotResponse>("/api/v1/media/screenshot", {
      auth: true,
      method: "POST"
    });
  }

  async startRecording(): Promise<RecordingStartResponse> {
    return this.request<RecordingStartResponse>("/api/v1/media/recording/start", {
      auth: true,
      method: "POST"
    });
  }

  async stopRecording(): Promise<RecordingStopResponse> {
    return this.request<RecordingStopResponse>("/api/v1/media/recording/stop", {
      auth: true,
      method: "POST"
    });
  }

  async reconnect(options: ReconnectOptions = {}): Promise<AgentStatus> {
    const maxAttempts = options.maxAttempts ?? 8;
    const maxDelayMs = options.maxDelayMs ?? 30_000;
    let delayMs = options.initialDelayMs ?? 1_000;
    let attempt = 0;

    while (true) {
      try {
        return await this.connect();
      } catch (error) {
        attempt += 1;
        if (attempt >= maxAttempts) {
          throw error;
        }

        await this.waitImpl(delayMs);
        delayMs = Math.min(maxDelayMs, delayMs * 2);
      }
    }
  }

  private async request<T>(path: string, config: RequestConfig): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json"
    };

    let requestBody: BodyInit | undefined;
    if (config.body !== undefined) {
      if (isBodyInitPayload(config.body)) {
        requestBody = config.body;
      } else {
        headers["Content-Type"] = "application/json";
        requestBody = JSON.stringify(config.body);
      }
    }

    if (config.auth) {
      const token = this.options.getToken?.();
      if (!token) {
        throw new Error(`Missing device token for authenticated request: ${path}`);
      }
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await this.fetchImpl(`${stripTrailingSlash(this.options.baseUrl)}${path}`, {
      body: requestBody,
      headers,
      method: config.method ?? "GET"
    });

    const payload = await response.json();

    if (!response.ok && config.allowNon2xx) {
      return payload as T;
    }

    if (!response.ok) {
      throw this.toApiError(response.status, payload);
    }

    return payload as T;
  }

  private toApiError(status: number, payload: unknown): CeryxApiError {
    if (isStandardErrorResponse(payload)) {
      const error = new CeryxApiError(
        payload.error.code,
        status,
        payload.error.message,
        payload.error.hint,
        payload.error.traceId
      );

      if (error.code === "E_TOKEN_INVALID") {
        this.options.clearToken?.();
        this.options.onTokenInvalid?.(error);
      }

      return error;
    }

    return new CeryxApiError(
      `E_HTTP_${status}`,
      status,
      `HTTP request failed with status ${status}.`
    );
  }
}

function stripTrailingSlash(input: string): string {
  return input.endsWith("/") ? input.slice(0, -1) : input;
}

function isBodyInitPayload(value: unknown): value is BodyInit {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return true;
  }

  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return true;
  }

  if (typeof FormData !== "undefined" && value instanceof FormData) {
    return true;
  }

  if (typeof URLSearchParams !== "undefined" && value instanceof URLSearchParams) {
    return true;
  }

  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return true;
  }

  if (typeof ReadableStream !== "undefined" && value instanceof ReadableStream) {
    return true;
  }

  return false;
}

function isStandardErrorResponse(value: unknown): value is StandardErrorResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const response = value as StandardErrorResponse;
  return response.ok === false &&
    !!response.error &&
    typeof response.error.code === "string" &&
    typeof response.error.message === "string";
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
