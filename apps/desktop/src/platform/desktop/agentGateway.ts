import {
  type AgentSettingsPatch,
  type ClipboardClearResponse,
  type ClipboardReceiveResponse,
  type ClipboardSendRequest,
  type ClipboardSendResponse,
  AgentClient,
  isTokenInvalidError,
  type AgentManagementResponse,
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
  type InputActionResponse,
  type LogsQuery,
  type LogsResponse,
  type ProjectDiffFileResponse,
  type ProjectDiffFilesResponse,
  type ProjectDiffResponse,
  type FileTransferEntry,
  type FileTransferUploadResponse,
  type ProjectFilesResponse,
  type ProjectTasksResponse,
  type ProjectTestResponse,
  type NotificationClearResponse,
  type NotificationReadResponse,
  type NotificationsResponse,
  type PromptSendResponse,
  type RecordingListResponse,
  type RecordingStartRequest,
  type RecordingStartResponse,
  type RecordingStopResponse,
  type SettingsResponse,
  type ScreenshotResponse,
  type TrustedDevice
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
import {
  openLogsFolderViaShell,
  restartLocalAgentViaShell,
  startLocalAgentViaShell
} from "./localShell";

export const defaultLocalAgentBaseUrl = "http://127.0.0.1:41527";

export interface LocalAgentProbeResult {
  baseUrl: string;
  reachable: boolean;
  latencyMs: number | null;
  agentStatus: AgentStatus | null;
  deviceName: string;
  runtimeStatus: string;
  codexStatus: string;
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

function getClient(baseUrl = defaultLocalAgentBaseUrl): AgentClient {
  return createClient(baseUrl);
}

export async function probeLocalAgent(
  baseUrl = defaultLocalAgentBaseUrl
): Promise<LocalAgentProbeResult> {
  const token = readDeviceToken(baseUrl);
  const client = createClient(baseUrl);
  const start = Date.now();

  try {
    await client.health();
    const latencyMs = Date.now() - start;

    try {
      const agentStatus = await client.agentStatus();
      return {
        baseUrl,
        reachable: true,
        latencyMs,
        agentStatus,
        deviceName: agentStatus.deviceName,
        runtimeStatus: agentStatus.status,
        codexStatus: agentStatus.codexStatus,
        tokenState: "valid",
        message: "Local Agent is online."
      };
    } catch (error) {
      if (isTokenInvalidError(error)) {
        clearDeviceToken(baseUrl);
      }

      return {
        baseUrl,
        reachable: true,
        latencyMs,
        agentStatus: null,
        deviceName: "Local Windows PC",
        runtimeStatus: "unpaired",
        codexStatus: "unknown",
        tokenState: token ? (isTokenInvalidError(error) ? "invalid" : "expired") : "missing",
        message: token
          ? "Local Agent is reachable, but the stored desktop token is no longer valid."
          : "Local Agent is reachable. Pair this desktop client to unlock trusted device management."
      };
    }
  } catch {
    return {
      baseUrl,
      reachable: false,
      latencyMs: null,
      agentStatus: null,
      deviceName: "Local Windows PC",
      runtimeStatus: "offline",
      codexStatus: "unknown",
      tokenState: token ? "expired" : "missing",
      message: "Local Agent is offline or unreachable."
    };
  }
}

export async function listTrustedDevices(
  baseUrl = defaultLocalAgentBaseUrl
): Promise<TrustedDevice[]> {
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

export async function getCodexWindow(
  baseUrl = defaultLocalAgentBaseUrl
): Promise<CodexWindowSnapshot> {
  return getClient(baseUrl).getCodexWindow();
}

export async function listCodexWindows(
  baseUrl = defaultLocalAgentBaseUrl
): Promise<CodexWindowListResponse> {
  return getClient(baseUrl).listCodexWindows();
}

export async function requestConnectionStats(
  baseUrl = defaultLocalAgentBaseUrl
): Promise<ConnectionStatsResponse> {
  return getClient(baseUrl).getConnectionStats();
}

export async function refreshCodexWindow(
  baseUrl = defaultLocalAgentBaseUrl
): Promise<CodexWindowSnapshot> {
  return getClient(baseUrl).refreshCodexWindow();
}

export async function selectCodexWindow(
  baseUrl = defaultLocalAgentBaseUrl,
  windowId: string
): Promise<CodexWindowSnapshot> {
  const request: CodexSelectWindowRequest = { windowId };
  return getClient(baseUrl).selectCodexWindow(request);
}

export async function focusCodexWindow(
  baseUrl = defaultLocalAgentBaseUrl
): Promise<CodexWindowSnapshot> {
  return getClient(baseUrl).focusCodexWindow();
}

export async function getCaptureState(
  baseUrl = defaultLocalAgentBaseUrl
): Promise<CaptureStateResponse> {
  return getClient(baseUrl).getCaptureState();
}

export async function getCaptureFrame(
  baseUrl = defaultLocalAgentBaseUrl,
  windowId?: string
): Promise<CaptureFrameResult> {
  return getClient(baseUrl).getCaptureFrame(windowId);
}

export async function startCapture(
  baseUrl = defaultLocalAgentBaseUrl,
  mode: CaptureMode = "balanced",
  windowId?: string
): Promise<CaptureStateResponse> {
  return getClient(baseUrl).startCapture({
    mode,
    target: "codex_window",
    windowId
  });
}

export async function stopCapture(
  baseUrl = defaultLocalAgentBaseUrl
): Promise<CaptureStateResponse> {
  return getClient(baseUrl).stopCapture();
}

export async function sendCaptureSignal(
  request: CaptureSignalRequest,
  baseUrl = defaultLocalAgentBaseUrl
): Promise<CaptureSignalResponse> {
  return getClient(baseUrl).sendCaptureSignal(request);
}

export async function sendPrompt(
  prompt: string,
  submit: boolean,
  baseUrl = defaultLocalAgentBaseUrl
): Promise<PromptSendResponse> {
  return getClient(baseUrl).sendPrompt({ prompt, submit });
}

export async function sendClipboard(
  request: ClipboardSendRequest,
  baseUrl = defaultLocalAgentBaseUrl
): Promise<ClipboardSendResponse> {
  return getClient(baseUrl).sendClipboard(request);
}

export async function receiveClipboard(
  baseUrl = defaultLocalAgentBaseUrl
): Promise<ClipboardReceiveResponse> {
  return getClient(baseUrl).receiveClipboard();
}

export async function clearClipboard(
  baseUrl = defaultLocalAgentBaseUrl
): Promise<ClipboardClearResponse> {
  return getClient(baseUrl).clearClipboard();
}

export async function requestAgentFiles(
  baseUrl = defaultLocalAgentBaseUrl,
  path = "uploads",
  limit = 100
): Promise<FileTransferEntry[]> {
  const files = await getClient(baseUrl).listFiles(path, limit);
  return Array.isArray(files) ? files : [];
}

export async function uploadAgentFile(
  baseUrl = defaultLocalAgentBaseUrl,
  file: File,
  targetPath?: string
): Promise<FileTransferUploadResponse> {
  return getClient(baseUrl).uploadFile(file, targetPath);
}

export async function downloadAgentFile(
  baseUrl = defaultLocalAgentBaseUrl,
  fileId: string,
  signal?: AbortSignal
): Promise<Blob> {
  return getClient(baseUrl).downloadFile(fileId, signal);
}

export async function deleteAgentFile(
  baseUrl = defaultLocalAgentBaseUrl,
  fileId: string
): Promise<void> {
  await getClient(baseUrl).deleteFile(fileId);
}

export async function approveFromToolbar(
  baseUrl = defaultLocalAgentBaseUrl
): Promise<InputActionResponse> {
  return getClient(baseUrl).inputHotkey({ keys: ["Control", "Enter"] });
}

export async function rejectFromToolbar(
  baseUrl = defaultLocalAgentBaseUrl
): Promise<InputActionResponse> {
  return getClient(baseUrl).inputKey({ key: "Escape", action: "press" });
}

export async function requestDiff(
  baseUrl = defaultLocalAgentBaseUrl
): Promise<ProjectDiffResponse> {
  return getClient(baseUrl).getProjectDiff();
}

export async function requestDiffFiles(
  projectId = "workspace-default",
  baseUrl = defaultLocalAgentBaseUrl
): Promise<ProjectDiffFilesResponse> {
  return getClient(baseUrl).getProjectDiffFiles(projectId);
}

export async function requestDiffFile(
  projectId: string,
  path: string,
  baseUrl = defaultLocalAgentBaseUrl
): Promise<ProjectDiffFileResponse> {
  return getClient(baseUrl).getProjectDiffFile(projectId, path);
}

export async function requestProjectTest(
  baseUrl = defaultLocalAgentBaseUrl
): Promise<ProjectTestResponse> {
  return getClient(baseUrl).requestProjectTest({ scope: "changed-modules" });
}

export async function requestProjectFiles(
  projectId = "workspace-default",
  options: { query?: string; limit?: number } = {},
  baseUrl = defaultLocalAgentBaseUrl
): Promise<ProjectFilesResponse> {
  return getClient(baseUrl).getProjectFiles(projectId, options);
}

export async function requestProjectTasks(
  promptLimit = 8,
  baseUrl = defaultLocalAgentBaseUrl
): Promise<ProjectTasksResponse> {
  return getClient(baseUrl).getProjectTasks(promptLimit);
}

export async function requestNotifications(
  limit = 80,
  baseUrl = defaultLocalAgentBaseUrl
): Promise<NotificationsResponse> {
  return getClient(baseUrl).getNotifications(limit);
}

export async function markNotificationRead(
  notificationId: string,
  baseUrl = defaultLocalAgentBaseUrl
): Promise<NotificationReadResponse> {
  return getClient(baseUrl).markNotificationRead(notificationId);
}

export async function clearNotifications(
  baseUrl = defaultLocalAgentBaseUrl
): Promise<NotificationClearResponse> {
  return getClient(baseUrl).clearNotifications();
}

export async function requestLogs(
  query: LogsQuery = {},
  baseUrl = defaultLocalAgentBaseUrl
): Promise<LogsResponse> {
  return getClient(baseUrl).getLogs(query);
}

export async function requestSettings(
  baseUrl = defaultLocalAgentBaseUrl
): Promise<SettingsResponse> {
  return getClient(baseUrl).getSettings();
}

export async function patchAgentSettings(
  patch: AgentSettingsPatch,
  confirmHighRisk = false,
  baseUrl = defaultLocalAgentBaseUrl
): Promise<SettingsResponse> {
  return getClient(baseUrl).patchAgentSettings(patch, confirmHighRisk);
}

export async function takeScreenshot(
  baseUrl = defaultLocalAgentBaseUrl,
  windowId?: string
): Promise<ScreenshotResponse> {
  return getClient(baseUrl).screenshot(windowId);
}

export async function startRecordingCapture(
  baseUrl = defaultLocalAgentBaseUrl,
  request: boolean | RecordingStartRequest = false
): Promise<RecordingStartResponse> {
  return getClient(baseUrl).startRecording(request);
}

export async function stopRecordingCapture(
  baseUrl = defaultLocalAgentBaseUrl
): Promise<RecordingStopResponse> {
  return getClient(baseUrl).stopRecording();
}

export async function requestRecordings(
  baseUrl = defaultLocalAgentBaseUrl,
  limit = 100
): Promise<RecordingListResponse> {
  return getClient(baseUrl).listRecordings(limit);
}

export async function downloadRecording(
  baseUrl: string,
  fileName: string,
  signal?: AbortSignal
): Promise<Blob> {
  return getClient(baseUrl).downloadRecording(fileName, signal);
}

export async function startLocalAgent(): Promise<AgentManagementResponse> {
  return startLocalAgentViaShell();
}

export async function restartLocalAgent(
  baseUrl = defaultLocalAgentBaseUrl
): Promise<AgentManagementResponse> {
  if (readDeviceToken(baseUrl)) {
    try {
      return await createClient(baseUrl).restartRequest();
    } catch {
      return restartLocalAgentViaShell();
    }
  }

  return restartLocalAgentViaShell();
}

export async function openLogsFolder(
  baseUrl = defaultLocalAgentBaseUrl
): Promise<AgentManagementResponse> {
  if (readDeviceToken(baseUrl)) {
    try {
      return await createClient(baseUrl).openLogsFolder();
    } catch {
      return openLogsFolderViaShell();
    }
  }

  return openLogsFolderViaShell();
}
