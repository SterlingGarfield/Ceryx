import type {
  AgentManagementResponse,
  ClipboardClearResponse,
  ClipboardReceiveResponse,
  ClipboardSendRequest,
  ClipboardSendResponse,
  AgentSettingsPatch,
  AgentPathsResponse,
  AgentStatus,
  CaptureSignalRequest,
  CaptureSignalResponse,
  CaptureStartRequest,
  CaptureStateResponse,
  FileTransferDeleteResponse,
  FileTransferEntry,
  FileTransferListResponse,
  FileTransferUploadResponse,
  CodexSelectWindowRequest,
  CodexWindowListResponse,
  CodexWindowSnapshot,
  InputActionResponse,
  InputHotkeyRequest,
  InputKeyRequest,
  InputMouseRequest,
  InputScrollRequest,
  InputTextRequest,
  LogsQuery,
  LogsResponse,
  PairingDesktopConfirmRequest,
  PairingDesktopConfirmResponse,
  PairingConfirmRequest,
  PairingConfirmResponse,
  PairingRequest,
  PairingRequestResponse,
  PromptSendRequest,
  PromptSendResponse,
  ProjectDiffFileResponse,
  ProjectDiffFilesResponse,
  ProjectDiffResponse,
  ProjectFilesResponse,
  ProjectTasksResponse,
  ProjectTestRequest,
  ProjectTestResponse,
  NotificationClearResponse,
  NotificationReadResponse,
  NotificationsResponse,
  PreviewRefreshProfile,
  RecordingListResponse,
  RecordingStartRequest,
  RecordingStartResponse,
  RecordingStopResponse,
  ScreenshotResponse,
  SettingsPatchRequest,
  SettingsResponse,
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
  method?: "GET" | "POST" | "PATCH" | "DELETE";
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

export interface CaptureFrameResult {
  blob: Blob;
  contentType: string;
  capturedAt: string;
  width: number;
  height: number;
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
    this.fetchImpl = options.fetchImpl ?? resolveDefaultFetchImpl();
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

  async desktopConfirmPairing(
    request: PairingDesktopConfirmRequest
  ): Promise<PairingDesktopConfirmResponse> {
    return this.request<PairingDesktopConfirmResponse>("/api/v1/pairing/desktop-confirm", {
      auth: false,
      method: "POST",
      body: request
    });
  }

  async connect(): Promise<AgentStatus> {
    return this.agentStatus();
  }

  async agentStatus(): Promise<AgentStatus> {
    return this.request<AgentStatus>("/api/v1/agent/status", { auth: true });
  }

  async agentPaths(): Promise<AgentPathsResponse> {
    return this.request<AgentPathsResponse>("/api/v1/agent/paths", { auth: true });
  }

  async listDevices(): Promise<TrustedDevice[]> {
    return this.request<TrustedDevice[]>("/api/v1/devices", { auth: true });
  }

  async deleteDevice(deviceId: string, confirmHighRisk = false): Promise<{ ok: boolean }> {
    if (!deviceId) {
      throw new Error("deviceId is required");
    }

    return this.request<{ ok: boolean }>(`/api/v1/devices/${encodeURIComponent(deviceId)}`, {
      auth: true,
      method: "DELETE",
      body: { confirmHighRisk }
    });
  }

  async getCodexWindow(): Promise<CodexWindowSnapshot> {
    return this.request<CodexWindowSnapshot>("/api/v1/codex/window", { auth: true });
  }

  async listCodexWindows(): Promise<CodexWindowListResponse> {
    return this.request<CodexWindowListResponse>("/api/v1/codex/windows", { auth: true });
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

  async sendClipboard(request: ClipboardSendRequest): Promise<ClipboardSendResponse> {
    return this.request<ClipboardSendResponse>("/api/v1/clipboard/send", {
      auth: true,
      method: "POST",
      body: request
    });
  }

  async receiveClipboard(): Promise<ClipboardReceiveResponse> {
    return this.request<ClipboardReceiveResponse>("/api/v1/clipboard/receive", {
      auth: true
    });
  }

  async clearClipboard(): Promise<ClipboardClearResponse> {
    return this.request<ClipboardClearResponse>("/api/v1/clipboard/clear", {
      auth: true,
      method: "POST"
    });
  }

  async getProjectDiff(): Promise<ProjectDiffResponse> {
    return this.request<ProjectDiffResponse>("/api/v1/project/diff", {
      auth: true
    });
  }

  async getProjectDiffFiles(
    projectId: string,
    options: { page?: number; pageSize?: number } = {}
  ): Promise<ProjectDiffFilesResponse> {
    if (!projectId.trim()) {
      throw new Error("projectId is required");
    }

    if (options.page !== undefined && options.page <= 0) {
      throw new Error("page must be greater than 0");
    }

    if (options.pageSize !== undefined && options.pageSize <= 0) {
      throw new Error("pageSize must be greater than 0");
    }

    const search = new URLSearchParams();
    search.set("projectId", projectId);
    if (options.page !== undefined) {
      search.set("page", String(options.page));
    }

    if (options.pageSize !== undefined) {
      search.set("pageSize", String(options.pageSize));
    }

    return this.request<ProjectDiffFilesResponse>(
      `/api/v1/project/diff/files?${search.toString()}`,
      {
        auth: true
      }
    );
  }

  async getProjectDiffFile(projectId: string, path: string): Promise<ProjectDiffFileResponse> {
    if (!projectId.trim()) {
      throw new Error("projectId is required");
    }

    if (!path.trim()) {
      throw new Error("path is required");
    }

    return this.request<ProjectDiffFileResponse>(
      `/api/v1/project/diff/file?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path)}`,
      {
        auth: true
      }
    );
  }

  async getProjectFiles(
    projectId: string,
    options: { query?: string; limit?: number } = {}
  ): Promise<ProjectFilesResponse> {
    if (!projectId.trim()) {
      throw new Error("projectId is required");
    }

    if (options.limit !== undefined && options.limit <= 0) {
      throw new Error("limit must be greater than 0");
    }

    const search = new URLSearchParams();
    search.set("projectId", projectId);
    if (options.query && options.query.trim()) {
      search.set("query", options.query.trim());
    }

    if (options.limit !== undefined) {
      search.set("limit", String(options.limit));
    }

    return this.request<ProjectFilesResponse>(
      `/api/v1/project/files?${search.toString()}`,
      {
        auth: true
      }
    );
  }

  async requestProjectTest(request: ProjectTestRequest = {}): Promise<ProjectTestResponse> {
    return this.request<ProjectTestResponse>("/api/v1/project/test-request", {
      auth: true,
      method: "POST",
      body: request
    });
  }

  async getProjectTasks(promptLimit?: number): Promise<ProjectTasksResponse> {
    if (promptLimit !== undefined && promptLimit <= 0) {
      throw new Error("promptLimit must be greater than 0");
    }

    const path = promptLimit === undefined
      ? "/api/v1/project/tasks"
      : `/api/v1/project/tasks?promptLimit=${encodeURIComponent(String(promptLimit))}`;
    return this.request<ProjectTasksResponse>(path, { auth: true });
  }

  async getNotifications(limit?: number): Promise<NotificationsResponse> {
    if (limit !== undefined && limit <= 0) {
      throw new Error("limit must be greater than 0");
    }

    const path = limit === undefined
      ? "/api/v1/notifications"
      : `/api/v1/notifications?limit=${encodeURIComponent(String(limit))}`;
    return this.request<NotificationsResponse>(path, { auth: true });
  }

  async markNotificationRead(notificationId: string): Promise<NotificationReadResponse> {
    if (!notificationId.trim()) {
      throw new Error("notificationId is required");
    }

    return this.request<NotificationReadResponse>(
      `/api/v1/notifications/${encodeURIComponent(notificationId)}/read`,
      {
        auth: true,
        method: "POST"
      }
    );
  }

  async clearNotifications(): Promise<NotificationClearResponse> {
    return this.request<NotificationClearResponse>("/api/v1/notifications/clear", {
      auth: true,
      method: "POST"
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

  async getCaptureFrame(windowId?: string): Promise<CaptureFrameResult> {
    const headers: Record<string, string> = {
      Accept: "image/jpeg"
    };
    const query = windowId?.trim();

    const token = this.options.getToken?.();
    if (!token) {
      throw new Error("Missing device token for authenticated request: /api/v1/capture/frame");
    }
    headers.Authorization = `Bearer ${token}`;

    const response = await this.fetchImpl(
      `${stripTrailingSlash(this.options.baseUrl)}/api/v1/capture/frame${
        query ? `?windowId=${encodeURIComponent(query)}` : ""
      }`,
      {
        headers,
        method: "GET"
      }
    );

    if (!response.ok) {
      const payload = await readJsonPayload(response);
      throw this.toApiError(response.status, payload);
    }

    return {
      blob: await response.blob(),
      contentType: response.headers.get("Content-Type") ?? "image/jpeg",
      capturedAt: response.headers.get("X-Ceryx-Frame-Captured-At") ?? "",
      width: parseHeaderNumber(response.headers.get("X-Ceryx-Frame-Width")),
      height: parseHeaderNumber(response.headers.get("X-Ceryx-Frame-Height"))
    };
  }

  async sendCaptureSignal(request: CaptureSignalRequest): Promise<CaptureSignalResponse> {
    return this.request<CaptureSignalResponse>("/api/v1/capture/webrtc/signal", {
      auth: true,
      method: "POST",
      body: request
    });
  }

  async uploadFile(file: File, targetPath?: string): Promise<FileTransferUploadResponse> {
    if (!file.name.trim()) {
      throw new Error("file.name is required");
    }

    const form = new FormData();
    form.append("file", file, file.name);
    if (targetPath && targetPath.trim()) {
      form.append("targetPath", targetPath.trim());
    }

    return this.request<FileTransferUploadResponse>("/api/v1/files/upload", {
      auth: true,
      method: "POST",
      body: form
    });
  }

  async listFiles(path = "uploads", limit = 100): Promise<FileTransferEntry[]> {
    if (limit <= 0) {
      throw new Error("limit must be greater than 0");
    }

    const search = new URLSearchParams();
    if (path.trim()) {
      search.set("path", path.trim());
    }

    search.set("limit", String(limit));

    const response = await this.request<FileTransferListResponse>(
      `/api/v1/files/list?${search.toString()}`,
      {
        auth: true
      }
    );

    return response.files;
  }

  async downloadFile(fileId: string, signal?: AbortSignal): Promise<Blob> {
    if (!fileId.trim()) {
      throw new Error("fileId is required");
    }

    const headers: Record<string, string> = {
      Accept: "application/octet-stream"
    };

    const token = this.options.getToken?.();
    if (!token) {
      throw new Error(`Missing device token for authenticated request: /api/v1/files/download/${fileId}`);
    }

    headers.Authorization = `Bearer ${token}`;

    const response = await this.fetchImpl(
      `${stripTrailingSlash(this.options.baseUrl)}/api/v1/files/download/${encodeURIComponent(fileId)}`,
      {
        headers,
        method: "GET",
        signal
      }
    );

    if (!response.ok) {
      const payload = await readJsonPayload(response);
      throw this.toApiError(response.status, payload);
    }

    return await response.blob();
  }

  async deleteFile(fileId: string): Promise<void> {
    if (!fileId.trim()) {
      throw new Error("fileId is required");
    }

    await this.request<FileTransferDeleteResponse>(`/api/v1/files/${encodeURIComponent(fileId)}`, {
      auth: true,
      method: "DELETE"
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

  async screenshot(windowId?: string): Promise<ScreenshotResponse> {
    const query = windowId?.trim();
    return this.request<ScreenshotResponse>(
      `/api/v1/media/screenshot${query ? `?windowId=${encodeURIComponent(query)}` : ""}`,
      {
        auth: true,
        method: "POST"
      }
    );
  }

  async startRecording(
    request: boolean | RecordingStartRequest = false
  ): Promise<RecordingStartResponse> {
    const body =
      typeof request === "boolean"
        ? { confirmHighRisk: request }
        : {
            confirmHighRisk: request.confirmHighRisk ?? false,
            includeAudio: request.includeAudio ?? false,
            audioSource: request.audioSource,
            maxDurationMinutes: request.maxDurationMinutes,
            segmentSizeMB: request.segmentSizeMB
          };

    return this.request<RecordingStartResponse>("/api/v1/media/recording/start", {
      auth: true,
      method: "POST",
      body
    });
  }

  async stopRecording(): Promise<RecordingStopResponse> {
    return this.request<RecordingStopResponse>("/api/v1/media/recording/stop", {
      auth: true,
      method: "POST"
    });
  }

  async listRecordings(limit = 100): Promise<RecordingListResponse> {
    if (limit <= 0) {
      throw new Error("limit must be greater than 0");
    }

    return this.request<RecordingListResponse>(`/api/v1/media/recordings?limit=${encodeURIComponent(String(limit))}`, {
      auth: true,
      method: "GET"
    });
  }

  async downloadRecording(fileName: string, signal?: AbortSignal): Promise<Blob> {
    if (!fileName.trim()) {
      throw new Error("fileName is required");
    }

    if (signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    const token = this.options.getToken?.();
    if (!token) {
      throw new Error(`Missing device token for authenticated request: /api/v1/media/recordings/download/${fileName}`);
    }

    const response = await this.fetchImpl(
      `${stripTrailingSlash(this.options.baseUrl)}/api/v1/media/recordings/download/${encodeURIComponent(fileName)}`,
      {
        method: "GET",
        headers: {
          Accept: "application/octet-stream",
          Authorization: `Bearer ${token}`
        },
        signal
      }
    );

    if (!response.ok) {
      const payload = await readJsonPayload(response);
      throw this.toApiError(response.status, payload);
    }

    return response.blob();
  }

  async pauseControl(confirmHighRisk = false): Promise<AgentManagementResponse> {
    return this.request<AgentManagementResponse>("/api/v1/agent/pause-control", {
      auth: true,
      method: "POST",
      body: { confirmHighRisk }
    });
  }

  async resumeControl(): Promise<AgentManagementResponse> {
    return this.request<AgentManagementResponse>("/api/v1/agent/resume-control", {
      auth: true,
      method: "POST"
    });
  }

  async openLogsFolder(): Promise<AgentManagementResponse> {
    return this.request<AgentManagementResponse>("/api/v1/agent/open-logs-folder", {
      auth: true,
      method: "POST"
    });
  }

  async restartRequest(): Promise<AgentManagementResponse> {
    return this.request<AgentManagementResponse>("/api/v1/agent/restart-request", {
      auth: true,
      method: "POST"
    });
  }

  async getLogs(query: LogsQuery = {}): Promise<LogsResponse> {
    if (query.page !== undefined && query.page <= 0) {
      throw new Error("page must be greater than 0");
    }

    if (query.pageSize !== undefined && query.pageSize <= 0) {
      throw new Error("pageSize must be greater than 0");
    }

    const search = new URLSearchParams();
    if (query.page !== undefined) {
      search.set("page", String(query.page));
    }

    if (query.pageSize !== undefined) {
      search.set("pageSize", String(query.pageSize));
    }

    if (query.severity && query.severity.trim()) {
      search.set("severity", query.severity.trim());
    }

    if (query.action && query.action.trim()) {
      search.set("action", query.action.trim());
    }

    if (query.sessionId && query.sessionId.trim()) {
      search.set("sessionId", query.sessionId.trim());
    }

    const queryString = search.toString();
    const path = queryString ? `/api/v1/logs?${queryString}` : "/api/v1/logs";
    return this.request<LogsResponse>(path, { auth: true });
  }

  async getSettings(): Promise<SettingsResponse> {
    return this.request<SettingsResponse>("/api/v1/settings", { auth: true });
  }

  async patchSettings(request: SettingsPatchRequest): Promise<SettingsResponse> {
    return this.request<SettingsResponse>("/api/v1/settings", {
      auth: true,
      method: "PATCH",
      body: request
    });
  }

  async patchAgentSettings(
    patch: AgentSettingsPatch,
    confirmHighRisk = false
  ): Promise<SettingsResponse> {
    return this.patchSettings({
      agentSettings: patch,
      confirmHighRisk
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

    const payload = await readJsonPayload(response);

    if (!response.ok && config.allowNon2xx) {
      if (payload === null) {
        throw new CeryxApiError(
          `E_HTTP_${response.status}`,
          response.status,
          `HTTP request failed with status ${response.status}.`
        );
      }

      return payload as T;
    }

    if (!response.ok) {
      throw this.toApiError(response.status, payload);
    }

    if (payload === null) {
      throw new CeryxApiError(
        "E_HTTP_EMPTY_BODY",
        response.status,
        `HTTP ${response.status} returned an empty JSON body.`
      );
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

export function normalizePreviewRefreshProfile(
  value: PreviewRefreshProfile | string | null | undefined
): PreviewRefreshProfile {
  return value === "high_frequency" ? "high_frequency" : "balanced";
}

function stripTrailingSlash(input: string): string {
  return input.endsWith("/") ? input.slice(0, -1) : input;
}

function parseHeaderNumber(value: string | null): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function resolveDefaultFetchImpl(): typeof fetch {
  const fetchImpl = globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("Global fetch is unavailable.");
  }

  return fetchImpl.bind(globalThis);
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

async function readJsonPayload(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw.trim()) {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
