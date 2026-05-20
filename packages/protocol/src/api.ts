import type { CeryxPermission } from "./permissions";

export const ApiPrefix = "/api/v1" as const;

export const PublicApiRoutes = [
  "GET /api/v1/health",
  "POST /api/v1/pairing/request"
] as const;
export type PublicApiRoute = (typeof PublicApiRoutes)[number];

export const ProtectedApiRoutes = [
  "GET /api/v1/agent/status",
  "POST /api/v1/pairing/confirm",
  "POST /api/v1/auth/connect",
  "GET /api/v1/devices",
  "DELETE /api/v1/devices/{deviceId}",
  "GET /api/v1/codex/window",
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
  "POST /api/v1/capture/webrtc/signal",
  "POST /api/v1/assets/upload-image",
  "GET /api/v1/project/diff",
  "POST /api/v1/project/test-request",
  "POST /api/v1/media/screenshot",
  "POST /api/v1/media/recording/start",
  "POST /api/v1/media/recording/stop",
  "GET /api/v1/logs",
  "GET /api/v1/settings",
  "PATCH /api/v1/settings"
] as const;
export type ProtectedApiRoute = (typeof ProtectedApiRoutes)[number];

export interface RoutePermission {
  route: ProtectedApiRoute;
  permission?: CeryxPermission;
}

export const RoutePermissions: RoutePermission[] = [
  { route: "GET /api/v1/agent/status" },
  { route: "POST /api/v1/pairing/confirm" },
  { route: "POST /api/v1/auth/connect" },
  { route: "GET /api/v1/devices", permission: "manage_devices" },
  { route: "DELETE /api/v1/devices/{deviceId}", permission: "manage_devices" },
  { route: "GET /api/v1/codex/window", permission: "view_window" },
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
  { route: "POST /api/v1/capture/webrtc/signal", permission: "view_window" },
  { route: "POST /api/v1/assets/upload-image", permission: "upload_image" },
  { route: "GET /api/v1/project/diff", permission: "read_diff" },
  { route: "POST /api/v1/project/test-request", permission: "run_test" },
  { route: "POST /api/v1/media/screenshot", permission: "screenshot" },
  { route: "POST /api/v1/media/recording/start", permission: "recording" },
  { route: "POST /api/v1/media/recording/stop", permission: "recording" },
  { route: "GET /api/v1/logs" },
  { route: "GET /api/v1/settings" },
  { route: "PATCH /api/v1/settings", permission: "manage_agent" }
];

export interface HealthResponse {
  ok: true;
  service: "ceryx-agent";
  version: string;
}
