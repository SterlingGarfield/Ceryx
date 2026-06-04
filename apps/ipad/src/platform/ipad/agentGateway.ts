import {
  AgentClient,
  isTokenInvalidError,
  type ClipboardClearResponse,
  type ClipboardReceiveResponse,
  type ClipboardSendRequest,
  type ClipboardSendResponse,
  type AgentSettingsPatch,
  type AgentStatus,
  type CaptureFrameResult,
  type CaptureSignalRequest,
  type CaptureSignalResponse,
  type CaptureMode,
  type CaptureStateResponse,
  type ConnectionStatsResponse,
  type CodexWindowListResponse,
  type CodexSelectWindowRequest,
  type CodexWindowSnapshot,
  type FileTransferEntry,
  type InputActionResponse,
  type LogsQuery,
  type LogsResponse,
  type NotificationClearResponse,
  type NotificationReadResponse,
  type NotificationsResponse,
  type ProjectDiffFileResponse,
  type ProjectDiffFilesResponse,
  type ProjectFilesResponse,
  type ProjectTasksResponse,
  type PairingConfirmResponse,
  type PairingConfirmRejectedResponse,
  type PairingDesktopConfirmResponse,
  type PairingRequestResponse,
  type ProjectDiffResponse,
  type PromptSendResponse,
  type RecordingListResponse,
  type RecordingStartRequest,
  type RecordingStartResponse,
  type RecordingStopResponse,
  type SettingsResponse,
  type ScreenshotResponse,
  type TrustedDevice,
  type PairingRequestRejectedResponse,
  type FileTransferUploadResponse,
  type UploadImageResponse
} from "@ceryx/client-sdk";
import {
  clearDeviceToken,
  readDeviceToken,
  writeDeviceToken
} from "./tokenVault";
import {
  readTrustedDevicesCache,
  writeTrustedDevicesCache
} from "@ceryx/feature-remote-control";

export interface AgentProbeResult {
  baseUrl: string;
  reachable: boolean;
  latencyMs: number | null;
  deviceName: string;
  codexStatus: string;
  runtimeStatus: string;
  tokenState: "missing" | "valid" | "invalid" | "expired";
  message: string;
}

function createClient(baseUrl: string): AgentClient {
  return new AgentClient({
    baseUrl,
    getToken: () => readDeviceToken(baseUrl),
    setToken: (token) => writeDeviceToken(baseUrl, token),
    clearToken: () => clearDeviceToken(baseUrl)
  });
}

export async function probeAgent(baseUrl: string): Promise<AgentProbeResult> {
  const start = Date.now();
  const token = readDeviceToken(baseUrl);
  const client = createClient(baseUrl);

  try {
    await client.health();
    const latencyMs = Date.now() - start;

    let agentStatus: AgentStatus | null = null;
    try {
      agentStatus = await client.agentStatus();
    } catch (error) {
      if (isTokenInvalidError(error)) {
        clearDeviceToken(baseUrl);
      }

      return {
        baseUrl,
        reachable: true,
        latencyMs,
        deviceName: "Windows Agent",
        codexStatus: "unknown",
        runtimeStatus: "unpaired",
        tokenState: token ? (isTokenInvalidError(error) ? "invalid" : "expired") : "missing",
        message: token
          ? "Agent reachable, but stored iPad token is invalid."
          : "Agent reachable. Pair this iPad to continue."
      };
    }

    return {
      baseUrl,
      reachable: true,
      latencyMs,
      deviceName: agentStatus?.deviceName ?? "Windows Agent",
      codexStatus: agentStatus?.codexStatus ?? "unknown",
      runtimeStatus: agentStatus?.status ?? "unpaired",
      tokenState: "valid",
      message: agentStatus ? "Connected" : "Reachable (pairing required)"
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error ?? "");
    return {
      baseUrl,
      reachable: false,
      latencyMs: null,
      deviceName: "Windows Agent",
      codexStatus: "unknown",
      runtimeStatus: "offline",
      tokenState: token ? "expired" : "missing",
      message: errorMessage ? `Offline or unreachable: ${errorMessage}` : "Offline or unreachable"
    };
  }
}

export async function listTrustedDevices(baseUrl: string): Promise<TrustedDevice[]> {
  if (!readDeviceToken(baseUrl)) {
    return readTrustedDevicesCache(baseUrl);
  }

  try {
    const devices = await createClient(baseUrl).listDevices();
    writeTrustedDevicesCache(baseUrl, devices);
    return devices;
  } catch {
    return readTrustedDevicesCache(baseUrl);
  }
}

export async function requestPairing(
  baseUrl: string,
  request: { clientName: string; clientType: "ipad"; platform: string }
): Promise<PairingRequestResponse | PairingRequestRejectedResponse> {
  return createClient(baseUrl).requestPairing(request);
}

export async function confirmPairing(
  baseUrl: string,
  request: { pairingId: string; code: string }
): Promise<PairingConfirmResponse | PairingConfirmRejectedResponse> {
  return createClient(baseUrl).confirmPairing(request);
}

export async function desktopConfirmPairing(
  baseUrl: string,
  request: { pairingId: string }
): Promise<PairingDesktopConfirmResponse> {
  return createClient(baseUrl).desktopConfirmPairing(request);
}

export async function getCodexWindow(baseUrl: string): Promise<CodexWindowSnapshot> {
  return createClient(baseUrl).getCodexWindow();
}

export async function listCodexWindows(baseUrl: string): Promise<CodexWindowListResponse> {
  return createClient(baseUrl).listCodexWindows();
}

export async function requestConnectionStats(baseUrl: string): Promise<ConnectionStatsResponse> {
  return createClient(baseUrl).getConnectionStats();
}

export async function refreshCodexWindow(baseUrl: string): Promise<CodexWindowSnapshot> {
  return createClient(baseUrl).refreshCodexWindow();
}

export async function selectCodexWindow(
  baseUrl: string,
  windowId: string
): Promise<CodexWindowSnapshot> {
  const request: CodexSelectWindowRequest = { windowId };
  return createClient(baseUrl).selectCodexWindow(request);
}

export async function getCaptureState(baseUrl: string): Promise<CaptureStateResponse> {
  return createClient(baseUrl).getCaptureState();
}

export async function getCaptureFrame(
  baseUrl: string,
  windowId?: string
): Promise<CaptureFrameResult> {
  return createClient(baseUrl).getCaptureFrame(windowId);
}

export async function startCapture(
  baseUrl: string,
  mode: CaptureMode = "balanced",
  windowId?: string
): Promise<CaptureStateResponse> {
  return createClient(baseUrl).startCapture({
    mode,
    target: "codex_window",
    windowId
  });
}

export async function stopCapture(baseUrl: string): Promise<CaptureStateResponse> {
  return createClient(baseUrl).stopCapture();
}

export async function sendCaptureSignal(
  baseUrl: string,
  request: CaptureSignalRequest
): Promise<CaptureSignalResponse> {
  return createClient(baseUrl).sendCaptureSignal(request);
}

export async function sendPrompt(
  baseUrl: string,
  request: { prompt: string; submit: boolean }
): Promise<PromptSendResponse> {
  return createClient(baseUrl).sendPrompt(request);
}

export async function sendClipboard(
  baseUrl: string,
  request: ClipboardSendRequest
): Promise<ClipboardSendResponse> {
  return createClient(baseUrl).sendClipboard(request);
}

export async function receiveClipboard(baseUrl: string): Promise<ClipboardReceiveResponse> {
  return createClient(baseUrl).receiveClipboard();
}

export async function clearClipboard(baseUrl: string): Promise<ClipboardClearResponse> {
  return createClient(baseUrl).clearClipboard();
}

export async function requestAgentFiles(
  baseUrl: string,
  path = "uploads",
  limit = 100
): Promise<FileTransferEntry[]> {
  const files = await createClient(baseUrl).listFiles(path, limit);
  return Array.isArray(files) ? files : [];
}

export async function uploadAgentFile(
  baseUrl: string,
  file: File,
  targetPath?: string
): Promise<FileTransferUploadResponse> {
  return createClient(baseUrl).uploadFile(file, targetPath);
}

export async function downloadAgentFile(
  baseUrl: string,
  fileId: string,
  signal?: AbortSignal
): Promise<Blob> {
  return createClient(baseUrl).downloadFile(fileId, signal);
}

export async function deleteAgentFile(
  baseUrl: string,
  fileId: string
): Promise<void> {
  await createClient(baseUrl).deleteFile(fileId);
}

export async function requestDiff(baseUrl: string): Promise<ProjectDiffResponse> {
  return createClient(baseUrl).getProjectDiff();
}

export async function requestDiffFiles(
  baseUrl: string,
  projectId = "workspace-default"
): Promise<ProjectDiffFilesResponse> {
  return createClient(baseUrl).getProjectDiffFiles(projectId);
}

export async function requestDiffFile(
  baseUrl: string,
  projectId: string,
  path: string
): Promise<ProjectDiffFileResponse> {
  return createClient(baseUrl).getProjectDiffFile(projectId, path);
}

export async function requestLogs(
  baseUrl: string,
  query: LogsQuery = {}
): Promise<LogsResponse> {
  return createClient(baseUrl).getLogs(query);
}

export async function requestProjectFiles(
  baseUrl: string,
  projectId = "workspace-default",
  options: { query?: string; limit?: number } = {}
): Promise<ProjectFilesResponse> {
  return createClient(baseUrl).getProjectFiles(projectId, options);
}

export async function requestProjectTasks(
  baseUrl: string,
  promptLimit = 8
): Promise<ProjectTasksResponse> {
  return createClient(baseUrl).getProjectTasks(promptLimit);
}

export async function requestNotifications(
  baseUrl: string,
  limit = 80
): Promise<NotificationsResponse> {
  return createClient(baseUrl).getNotifications(limit);
}

export async function markNotificationRead(
  baseUrl: string,
  notificationId: string
): Promise<NotificationReadResponse> {
  return createClient(baseUrl).markNotificationRead(notificationId);
}

export async function clearNotifications(
  baseUrl: string
): Promise<NotificationClearResponse> {
  return createClient(baseUrl).clearNotifications();
}

export async function requestSettings(baseUrl: string): Promise<SettingsResponse> {
  return createClient(baseUrl).getSettings();
}

export async function patchAgentSettings(
  baseUrl: string,
  patch: AgentSettingsPatch,
  confirmHighRisk = false
): Promise<SettingsResponse> {
  return createClient(baseUrl).patchAgentSettings(patch, confirmHighRisk);
}

export async function takeScreenshot(
  baseUrl: string,
  windowId?: string
): Promise<ScreenshotResponse> {
  return createClient(baseUrl).screenshot(windowId);
}

export async function startRecordingCapture(
  baseUrl: string,
  request: boolean | RecordingStartRequest = false
): Promise<RecordingStartResponse> {
  return createClient(baseUrl).startRecording(request);
}

export async function stopRecordingCapture(baseUrl: string): Promise<RecordingStopResponse> {
  return createClient(baseUrl).stopRecording();
}

export async function requestRecordings(
  baseUrl: string,
  limit = 100
): Promise<RecordingListResponse> {
  return createClient(baseUrl).listRecordings(limit);
}

export async function downloadRecording(
  baseUrl: string,
  fileName: string,
  signal?: AbortSignal
): Promise<Blob> {
  return createClient(baseUrl).downloadRecording(fileName, signal);
}

export async function sendMouseInput(
  baseUrl: string,
  request: { x: number; y: number; button: string; action: string }
): Promise<InputActionResponse> {
  return createClient(baseUrl).inputMouse({
    x: request.x,
    y: request.y,
    button: request.button,
    action: request.action
  });
}

export async function sendScrollInput(
  baseUrl: string,
  request: { deltaX: number; deltaY: number }
): Promise<InputActionResponse> {
  return createClient(baseUrl).inputScroll({
    deltaX: request.deltaX,
    deltaY: request.deltaY
  });
}

export async function sendHotkeyInput(
  baseUrl: string,
  request: { keys: string[] }
): Promise<InputActionResponse> {
  return createClient(baseUrl).inputHotkey({
    keys: request.keys
  });
}

export async function uploadImageAsset(
  baseUrl: string,
  file: File
): Promise<UploadImageResponse> {
  return createClient(baseUrl).uploadImage({
    fileName: file.name,
    content: file
  });
}
