import type {
  AgentStatus,
  PairingConfirmRequest,
  PairingConfirmResponse,
  PairingRequest,
  PairingRequestResponse,
  TrustedDevice
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

    if (config.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    if (config.auth) {
      const token = this.options.getToken?.();
      if (!token) {
        throw new Error(`Missing device token for authenticated request: ${path}`);
      }
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await this.fetchImpl(`${stripTrailingSlash(this.options.baseUrl)}${path}`, {
      body: config.body === undefined ? undefined : JSON.stringify(config.body),
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
