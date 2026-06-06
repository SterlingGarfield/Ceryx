import type { WakeOnLanInfo } from "./devices.js";
import type { ClientType } from "./devices.js";
import type { CeryxPermission } from "./permissions.js";

export interface PairingRequest {
  clientName: string;
  clientType: ClientType;
  platform: string;
}

export interface PairingRequestResponse {
  ok: true;
  pairingId: string;
  expiresAt: string;
  state: PairingState;
  certFingerprint?: string;
}

export interface PairingConfirmRequest {
  pairingId: string;
  code: string;
}

export interface PairingDesktopConfirmRequest {
  pairingId: string;
}

export interface PairingDesktopConfirmResponse {
  ok: boolean;
  state: string;
  code?: string;
}

export interface PairingConfirmResponse {
  ok: true;
  deviceId: string;
  deviceToken: string;
  permissions: CeryxPermission[];
  certFingerprint: string;
  wol?: WakeOnLanInfo;
}

export const PairingStates = [
  "idle",
  "waiting_desktop_confirm",
  "code_input",
  "verifying",
  "success",
  "expired",
  "rejected",
  "network_error"
] as const;
export type PairingState = (typeof PairingStates)[number];

export const RemoteSessionStatuses = [
  "connecting",
  "connected",
  "standby",
  "active",
  "paused",
  "closed",
  "error"
] as const;
export type RemoteSessionStatus = (typeof RemoteSessionStatuses)[number];

export interface RemoteSession {
  id: string;
  deviceId: string;
  clientType: ClientType;
  status: RemoteSessionStatus;
  permissions: CeryxPermission[];
  startedAt: string;
  endedAt?: string;
  lastLatencyMs?: number;
}
