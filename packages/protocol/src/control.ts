import type { CodexWindowStatus } from "./devices.js";
import type { GestureProfile } from "./gestures.js";
import type { ShortcutProfile } from "./shortcuts.js";

export const CaptureModes = [
  "balanced",
  "low_latency",
  "high_quality",
  "power_save"
] as const;
export type CaptureMode = (typeof CaptureModes)[number];

export const PreviewRefreshProfiles = ["balanced", "high_frequency"] as const;
export type PreviewRefreshProfile = (typeof PreviewRefreshProfiles)[number];
export const ViewportTransports = ["webrtc", "polling"] as const;
export type ViewportTransport = (typeof ViewportTransports)[number];

export interface CodexWindowSnapshot {
  status: CodexWindowStatus | string;
  windowId?: string | null;
  title?: string | null;
  processName?: string | null;
  candidateCount: number;
  lastUpdatedAt: string;
}

export interface CodexWindowListResponse {
  windows: CodexWindowSnapshot[];
  activeWindowId?: string | null;
  totalCount: number;
  lastUpdatedAt: string;
}

export interface CodexSelectWindowRequest {
  windowId: string;
}

export interface InputKeyRequest {
  key: string;
  action: string;
  modifiers?: string[];
}

export interface InputMouseRequest {
  x: number;
  y: number;
  button: string;
  action: string;
}

export interface InputScrollRequest {
  deltaX: number;
  deltaY: number;
}

export interface InputHotkeyRequest {
  keys: string[];
}

export interface InputTextRequest {
  text: string;
}

export interface InputActionResponse {
  ok: boolean;
  action: string;
  status: string;
  message: string;
}

export interface PromptSendRequest {
  prompt: string;
  submit: boolean;
}

export interface PromptSendResponse {
  ok: boolean;
  status: string;
  submitted: boolean;
}

export const ClipboardPayloadTypes = ["text", "image"] as const;
export type ClipboardPayloadType = (typeof ClipboardPayloadTypes)[number];

export interface ClipboardSendRequest {
  type: ClipboardPayloadType | string;
  content: string;
  mimeType: string;
}

export interface ClipboardSendResponse {
  ok: boolean;
  type: ClipboardPayloadType | string;
  mimeType: string;
  sizeBytes: number;
}

export interface ClipboardReceiveResponse {
  ok: boolean;
  type: ClipboardPayloadType | string;
  content: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ClipboardClearResponse {
  ok: boolean;
  cleared: boolean;
}

export interface CaptureStartRequest {
  mode: CaptureMode | string;
  target: "codex_window" | "full_desktop" | string;
  windowId?: string | null;
}

export interface CaptureStateResponse {
  ok: boolean;
  active: boolean;
  paused: boolean;
  mode: string;
  windowId?: string | null;
  width: number;
  height: number;
  frameRate?: number;
  quality?: string;
  recordingAudioActive?: boolean;
}

export interface ConnectionViewportStats {
  currentTier: string;
  resolution: string;
  fps: number;
  bitrateKbps: number;
  packetsLost: number;
  packetsSent: number;
  packetLossPercent: number;
  roundTripTimeMs: number;
  jitterMs: number;
}

export interface ConnectionAgentStats {
  cpuPercent: number;
  memoryMB: number;
  uptimeSeconds: number;
}

export interface ConnectionStatsResponse {
  ok: boolean;
  observedAt: string;
  connectedSince: string;
  activeViewers: number;
  viewportStats: ConnectionViewportStats;
  agentStats: ConnectionAgentStats;
}

export interface RecordingStartRequest {
  confirmHighRisk?: boolean;
  includeAudio?: boolean;
  audioSource?: string;
  maxDurationMinutes?: number;
  segmentSizeMB?: number;
}

export interface CaptureSignalRequest {
  sessionId: string;
  type: string;
  payload?: string;
  sdp?: string;
  candidate?: CaptureIceCandidate;
}

export interface CaptureSignalResponse {
  ok: boolean;
  status: string;
  sessionId?: string;
  type?: string;
  sdp?: string;
  candidate?: CaptureIceCandidate;
}

export interface CaptureIceCandidate {
  candidate: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
}

export interface UploadImageResponse {
  ok: boolean;
  assetId: string;
  fileName: string;
  sizeBytes: number;
}

export interface FileTransferUploadResponse {
  ok: boolean;
  fileId: string;
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  storedPath: string;
  uploadedAt: string;
  targetPath?: string | null;
}

export interface FileTransferEntry {
  fileId: string;
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  storedPath: string;
  uploadedAt: string;
  targetPath?: string | null;
}

export interface FileTransferListResponse {
  ok: boolean;
  path: string;
  limit: number;
  total: number;
  files: FileTransferEntry[];
}

export interface FileTransferDeleteResponse {
  ok: boolean;
  deleted: boolean;
  fileId: string;
}

export interface ScreenshotResponse {
  ok: boolean;
  fileName: string;
  sizeBytes: number;
}

export interface RecordingStartResponse {
  ok: boolean;
  status: string;
  startedAt: string;
  audioEnabled: boolean;
  audioFormat: string;
}

export interface RecordingStopResponse {
  ok: boolean;
  status: string;
  fileName: string;
  sizeBytes: number;
  durationSeconds: number;
  outputPaths: string[];
  audioEnabled: boolean;
  audioFormat: string;
}

export interface RecordingEntryResponse {
  recordingId: string;
  fileName: string;
  sizeBytes: number;
  durationSeconds: number;
  audioEnabled: boolean;
  audioFormat: string;
  thumbnailFileName?: string | null;
  outputPaths: string[];
  startedAt: string;
  stoppedAt: string;
}

export interface RecordingListResponse {
  ok: boolean;
  total: number;
  items: RecordingEntryResponse[];
}

export interface AgentPathsResponse {
  root: string;
  logs: string;
  uploads: string;
  screenshots: string;
  recordings: string;
  database: string;
}

export interface AgentManagementResponse {
  ok: boolean;
  action: string;
  status: string;
  executed: boolean;
  message: string;
}

export const LogSeverityValues = ["info", "warning", "error"] as const;
export type LogSeverity = (typeof LogSeverityValues)[number];

export interface AgentLogEntry {
  id: string;
  action: string;
  details: string;
  severity: LogSeverity | string;
  sessionId: string;
  createdAt: string;
}

export interface LogsResponse {
  ok: boolean;
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  items: AgentLogEntry[];
}

export interface LogsQuery {
  page?: number;
  pageSize?: number;
  severity?: LogSeverity | string;
  action?: string;
  sessionId?: string;
}

export interface AgentSettingsState {
  httpPort: number;
  directTestCommand: string;
  allowFullscreenCapture: boolean;
  allowClearLogs: boolean;
  defaultCaptureMode: string;
}

export interface ClientSettingsState {
  theme: "system" | "light" | "dark" | string;
  compactMode: boolean;
  showLatency: boolean;
  keyboardShortcuts: boolean;
  notificationsEnabled: boolean;
  logsAutoRefresh: boolean;
  clipboardAutoSync?: boolean;
  lockLocalInputWhenCapturing?: boolean;
  activeGestureProfile?: string;
  customGestures?: GestureProfile;
  activeShortcutProfile?: string;
  customShortcuts?: ShortcutProfile;
  previewRefreshProfile: PreviewRefreshProfile | string;
  viewportTransport?: ViewportTransport | string;
}

export interface SettingsResponse {
  ok: boolean;
  updatedAt: string;
  agentSettings: AgentSettingsState;
  clientSettings: ClientSettingsState;
}

export interface AgentSettingsPatch {
  httpPort?: number;
  directTestCommand?: string;
  allowFullscreenCapture?: boolean;
  allowClearLogs?: boolean;
  defaultCaptureMode?: string;
}

export interface SettingsPatchRequest {
  agentSettings?: AgentSettingsPatch;
  confirmHighRisk?: boolean;
}

export interface ProjectDiffResponse {
  ok: boolean;
  status: string;
  summary: string;
  diffText?: string;
}

export interface ProjectDiffFileEntry {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface ProjectDiffFilesResponse {
  ok: boolean;
  projectId: string;
  projectName: string;
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  files: ProjectDiffFileEntry[];
}

export interface ProjectDiffFileResponse {
  ok: boolean;
  projectId: string;
  path: string;
  status: string;
  additions: number;
  deletions: number;
  diffText: string;
  truncated: boolean;
  lineLimit: number;
}

export interface ProjectFileEntry {
  path: string;
  extension: string;
  tracked: boolean;
  changed: boolean;
}

export interface ProjectFilesResponse {
  ok: boolean;
  projectId: string;
  projectName: string;
  generatedAt: string;
  files: ProjectFileEntry[];
}

export interface ProjectTestRequest {
  scope?: string;
}

export interface ProjectTestResponse {
  ok: boolean;
  status: string;
  message: string;
  requestId?: string;
}

export interface ProjectTaskState {
  status: string;
  currentAction?: string | null;
  updatedAt: string;
}

export interface ProjectTaskPromptAction {
  id: string;
  action: string;
  details: string;
  severity: string;
  sessionId: string;
  createdAt: string;
}

export interface ProjectTestRequestState {
  status: string;
  requestId?: string | null;
  scope?: string | null;
  message: string;
  requestedAt?: string | null;
}

export interface ProjectTasksResponse {
  ok: boolean;
  taskState: ProjectTaskState;
  recentPromptActions: ProjectTaskPromptAction[];
  testRequest: ProjectTestRequestState;
}

export interface AgentNotificationEntry {
  id: string;
  title: string;
  message: string;
  severity: string;
  createdAt: string;
  read: boolean;
}

export interface NotificationsResponse {
  ok: boolean;
  total: number;
  unread: number;
  items: AgentNotificationEntry[];
}

export interface NotificationReadResponse {
  ok: boolean;
  id: string;
  read: boolean;
}

export interface NotificationClearResponse {
  ok: boolean;
  clearedBefore: string;
}
