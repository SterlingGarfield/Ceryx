import type { CeryxPermission } from "./permissions.js";

export const ClientTypes = ["ipad", "desktop"] as const;
export type ClientType = (typeof ClientTypes)[number];

export const AgentPlatforms = ["windows"] as const;
export type AgentPlatform = (typeof AgentPlatforms)[number];

export const AgentRuntimeStatuses = [
  "starting",
  "running",
  "paused",
  "stopping",
  "error"
] as const;
export type AgentRuntimeStatus = (typeof AgentRuntimeStatuses)[number];

export const CodexWindowStatuses = [
  "not_found",
  "found",
  "focused",
  "minimized",
  "closed",
  "multiple_candidates",
  "permission_issue"
] as const;
export type CodexWindowStatus = (typeof CodexWindowStatuses)[number];

export interface AgentStatus {
  agentVersion: string;
  deviceName: string;
  platform: AgentPlatform;
  status: AgentRuntimeStatus;
  httpPort: number;
  supportsWebRTC: boolean;
  supportsDesktopClient: boolean;
  codexStatus: CodexWindowStatus;
  captureBackend?: "auto" | "wgc" | "gdi" | string;
}

export interface DiscoveredAgent {
  deviceName: string;
  agentVersion: string;
  platform: AgentPlatform;
  httpPort: number;
  supportsWebRTC: boolean;
  supportsDesktopClient: boolean;
  codexStatus: CodexWindowStatus;
  host?: string;
  latencyMs?: number;
}

export interface TrustedDevice {
  id: string;
  name: string;
  platform: string;
  permissions: CeryxPermission[];
  autoConnect: boolean;
  createdAt: string;
  lastConnectedAt?: string;
}
