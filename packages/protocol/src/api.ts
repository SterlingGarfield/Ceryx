import type { CeryxPermission } from "./permissions.js";

export const ApiPrefix = "/api/v1" as const;

export const PublicApiRoutes = [
  "GET /api/v1/health",
  "POST /api/v1/pairing/request",
  "POST /api/v1/pairing/desktop-confirm"
] as const;
export type PublicApiRoute = (typeof PublicApiRoutes)[number];

export const ProtectedApiRoutes = [
  "GET /api/v1/agent/status",
  "GET /api/v1/agent/paths",
  "POST /api/v1/pairing/confirm",
  "POST /api/v1/auth/connect",
  "GET /api/v1/devices",
  "DELETE /api/v1/devices/{deviceId}",
  "GET /api/v1/codex/window",
  "GET /api/v1/codex/windows",
  "POST /api/v1/codex/focus",
  "POST /api/v1/codex/refresh",
  "POST /api/v1/codex/select-window",
  "POST /api/v1/prompt/send",
  "POST /api/v1/input/key",
  "POST /api/v1/input/mouse",
  "POST /api/v1/input/scroll",
  "POST /api/v1/input/hotkey",
  "POST /api/v1/input/text",
  "POST /api/v1/capture/start",
  "POST /api/v1/capture/stop",
  "GET /api/v1/capture/state",
  "GET /api/v1/capture/frame",
  "POST /api/v1/capture/webrtc/signal",
  "POST /api/v1/files/upload",
  "GET /api/v1/files/list",
  "GET /api/v1/files/download/{fileId}",
  "DELETE /api/v1/files/{fileId}",
  "GET /api/v1/media/recordings",
  "GET /api/v1/media/recordings/download/{fileName}",
  "POST /api/v1/clipboard/send",
  "GET /api/v1/clipboard/receive",
  "POST /api/v1/clipboard/clear",
  "POST /api/v1/assets/upload-image",
  "GET /api/v1/project/diff",
  "GET /api/v1/project/diff/files",
  "GET /api/v1/project/diff/file",
  "GET /api/v1/project/files",
  "POST /api/v1/project/test-request",
  "GET /api/v1/project/tasks",
  "POST /api/v1/media/screenshot",
  "POST /api/v1/media/recording/start",
  "POST /api/v1/media/recording/stop",
  "POST /api/v1/agent/pause-control",
  "POST /api/v1/agent/resume-control",
  "POST /api/v1/agent/open-logs-folder",
  "POST /api/v1/agent/restart-request",
  "GET /api/v1/logs",
  "GET /api/v1/settings",
  "PATCH /api/v1/settings",
  "GET /api/v1/notifications",
  "POST /api/v1/notifications/{notificationId}/read",
  "POST /api/v1/notifications/clear"
] as const;
export type ProtectedApiRoute = (typeof ProtectedApiRoutes)[number];

export interface RoutePermission {
  route: ProtectedApiRoute;
  permission?: CeryxPermission;
}

export const RoutePermissions: RoutePermission[] = [
  { route: "GET /api/v1/agent/status" },
  { route: "GET /api/v1/agent/paths" },
  { route: "POST /api/v1/pairing/confirm" },
  { route: "POST /api/v1/auth/connect" },
  { route: "GET /api/v1/devices", permission: "manage_devices" },
  { route: "DELETE /api/v1/devices/{deviceId}", permission: "manage_devices" },
  { route: "GET /api/v1/codex/window", permission: "view_window" },
  { route: "GET /api/v1/codex/windows", permission: "view_window" },
  { route: "POST /api/v1/codex/focus", permission: "control_input" },
  { route: "POST /api/v1/codex/refresh", permission: "view_window" },
  { route: "POST /api/v1/codex/select-window", permission: "control_input" },
  { route: "POST /api/v1/prompt/send", permission: "send_prompt" },
  { route: "POST /api/v1/input/key", permission: "control_input" },
  { route: "POST /api/v1/input/mouse", permission: "control_input" },
  { route: "POST /api/v1/input/scroll", permission: "control_input" },
  { route: "POST /api/v1/input/hotkey", permission: "control_input" },
  { route: "POST /api/v1/input/text", permission: "control_input" },
  { route: "POST /api/v1/capture/start", permission: "view_window" },
  { route: "POST /api/v1/capture/stop", permission: "view_window" },
  { route: "GET /api/v1/capture/state", permission: "view_window" },
  { route: "GET /api/v1/capture/frame", permission: "view_window" },
  { route: "POST /api/v1/capture/webrtc/signal", permission: "view_window" },
  { route: "POST /api/v1/files/upload", permission: "manage_agent" },
  { route: "GET /api/v1/files/list", permission: "manage_agent" },
  { route: "GET /api/v1/files/download/{fileId}", permission: "manage_agent" },
  { route: "DELETE /api/v1/files/{fileId}", permission: "manage_agent" },
  { route: "POST /api/v1/clipboard/send", permission: "manage_agent" },
  { route: "GET /api/v1/clipboard/receive", permission: "manage_agent" },
  { route: "POST /api/v1/clipboard/clear", permission: "manage_agent" },
  { route: "POST /api/v1/assets/upload-image", permission: "upload_image" },
  { route: "GET /api/v1/project/diff", permission: "read_diff" },
  { route: "GET /api/v1/project/diff/files", permission: "read_diff" },
  { route: "GET /api/v1/project/diff/file", permission: "read_diff" },
  { route: "GET /api/v1/project/files", permission: "read_diff" },
  { route: "POST /api/v1/project/test-request", permission: "run_test" },
  { route: "GET /api/v1/project/tasks" },
  { route: "POST /api/v1/media/screenshot", permission: "screenshot" },
  { route: "POST /api/v1/media/recording/start", permission: "recording" },
  { route: "POST /api/v1/media/recording/stop", permission: "recording" },
  { route: "GET /api/v1/media/recordings", permission: "recording" },
  { route: "GET /api/v1/media/recordings/download/{fileName}", permission: "recording" },
  { route: "POST /api/v1/agent/pause-control", permission: "manage_agent" },
  { route: "POST /api/v1/agent/resume-control", permission: "manage_agent" },
  { route: "POST /api/v1/agent/open-logs-folder", permission: "manage_agent" },
  { route: "POST /api/v1/agent/restart-request", permission: "manage_agent" },
  { route: "GET /api/v1/logs" },
  { route: "GET /api/v1/settings" },
  { route: "PATCH /api/v1/settings", permission: "manage_agent" },
  { route: "GET /api/v1/notifications" },
  { route: "POST /api/v1/notifications/{notificationId}/read" },
  { route: "POST /api/v1/notifications/clear" }
];

export interface HealthResponse {
  ok: true;
  service: "ceryx-agent";
  version: string;
}
