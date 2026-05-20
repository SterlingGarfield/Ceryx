import type { CodexWindowStatus } from "./devices";

export const CaptureModes = [
  "balanced",
  "low_latency",
  "high_quality",
  "power_save"
] as const;
export type CaptureMode = (typeof CaptureModes)[number];

export interface CodexWindowSnapshot {
  status: CodexWindowStatus | string;
  windowId?: string | null;
  title?: string | null;
  processName?: string | null;
  candidateCount: number;
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

export interface CaptureStartRequest {
  mode: CaptureMode | string;
  target: "codex_window" | "full_desktop" | string;
}

export interface CaptureStateResponse {
  ok: boolean;
  active: boolean;
  paused: boolean;
  mode: string;
  windowId?: string | null;
  width: number;
  height: number;
}

export interface CaptureSignalRequest {
  sessionId: string;
  type: string;
  payload: string;
}

export interface CaptureSignalResponse {
  ok: boolean;
  status: string;
}

export interface UploadImageResponse {
  ok: boolean;
  assetId: string;
  fileName: string;
  sizeBytes: number;
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
}

export interface RecordingStopResponse {
  ok: boolean;
  status: string;
  fileName: string;
  sizeBytes: number;
}
