import type { CaptureStateResponse, CeryxPermission, RemoteSessionStatus } from "@ceryx/protocol";
import { create } from "zustand";

const defaultCaptureState: CaptureStateResponse = {
  ok: true,
  active: false,
  paused: false,
  mode: "balanced",
  windowId: null,
  width: 0,
  height: 0
};

export interface RemoteSessionState {
  sessionId: string;
  deviceId: string;
  status: RemoteSessionStatus | "idle";
  permissions: CeryxPermission[];
  captureState: CaptureStateResponse;
  latencyMs: number | null;
  lastError: string;
}

export interface RemoteSessionActions {
  connectSession(input: {
    sessionId: string;
    deviceId: string;
    status?: RemoteSessionStatus;
    permissions: CeryxPermission[];
  }): void;
  setStatus(status: RemoteSessionStatus): void;
  setLatency(latencyMs: number | null): void;
  setPermissions(permissions: CeryxPermission[]): void;
  setCaptureState(captureState: CaptureStateResponse): void;
  markActive(): void;
  markStandby(): void;
  setError(message: string): void;
  clear(): void;
}

export type RemoteSessionStore = RemoteSessionState & RemoteSessionActions;

const initialState: RemoteSessionState = {
  sessionId: "",
  deviceId: "",
  status: "idle",
  permissions: [],
  captureState: defaultCaptureState,
  latencyMs: null,
  lastError: ""
};

export function createRemoteSessionStore() {
  return create<RemoteSessionStore>()((set) => ({
    ...initialState,
    connectSession(input) {
      set({
        sessionId: input.sessionId,
        deviceId: input.deviceId,
        permissions: input.permissions,
        status: input.status ?? "connected",
        lastError: ""
      });
    },
    setStatus(status) {
      set({ status });
    },
    setLatency(latencyMs) {
      set({ latencyMs });
    },
    setPermissions(permissions) {
      set({ permissions });
    },
    setCaptureState(captureState) {
      set({ captureState });
    },
    markActive() {
      set({ status: "active" });
    },
    markStandby() {
      set({ status: "standby" });
    },
    setError(lastError) {
      set({
        lastError,
        status: "error"
      });
    },
    clear() {
      set(initialState);
    }
  }));
}

export const useRemoteSessionStore = createRemoteSessionStore();
