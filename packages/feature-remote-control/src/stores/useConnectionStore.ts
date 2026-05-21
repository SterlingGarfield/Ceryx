import type { AgentRuntimeStatus } from "@ceryx/protocol";
import { create } from "zustand";

export type ConnectionTokenState = "missing" | "valid" | "invalid" | "expired";
export type ConnectionReconnectState =
  | "idle"
  | "scheduled"
  | "reconnecting"
  | "connected"
  | "failed";

export interface CurrentDevice {
  deviceId: string;
  deviceName: string;
  platform: string;
  baseUrl: string;
}

export interface ConnectionState {
  currentDevice: CurrentDevice | null;
  agentStatus: AgentRuntimeStatus | null;
  latencyMs: number | null;
  tokenState: ConnectionTokenState;
  reconnectState: ConnectionReconnectState;
  reconnectAttempt: number;
  lastError: string | null;
}

export interface ConnectionActions {
  setCurrentDevice(device: CurrentDevice): void;
  clearCurrentDevice(): void;
  setAgentStatus(status: AgentRuntimeStatus | null): void;
  setLatency(latencyMs: number | null): void;
  setTokenState(state: ConnectionTokenState): void;
  scheduleReconnect(attempt: number): void;
  startReconnect(attempt: number): void;
  markConnected(): void;
  markReconnectFailed(message: string): void;
  reset(): void;
}

export type ConnectionStore = ConnectionState & ConnectionActions;

const initialState: ConnectionState = {
  currentDevice: null,
  agentStatus: null,
  latencyMs: null,
  tokenState: "missing",
  reconnectState: "idle",
  reconnectAttempt: 0,
  lastError: null
};

export function createConnectionStore() {
  return create<ConnectionStore>()((set) => ({
    ...initialState,
    setCurrentDevice(device) {
      set({
        currentDevice: device,
        lastError: null
      });
    },
    clearCurrentDevice() {
      set({
        currentDevice: null
      });
    },
    setAgentStatus(status) {
      set({
        agentStatus: status
      });
    },
    setLatency(latencyMs) {
      set({
        latencyMs
      });
    },
    setTokenState(tokenState) {
      set({
        tokenState
      });
    },
    scheduleReconnect(reconnectAttempt) {
      set({
        reconnectState: "scheduled",
        reconnectAttempt
      });
    },
    startReconnect(reconnectAttempt) {
      set({
        reconnectState: "reconnecting",
        reconnectAttempt
      });
    },
    markConnected() {
      set({
        reconnectState: "connected",
        reconnectAttempt: 0,
        lastError: null
      });
    },
    markReconnectFailed(lastError) {
      set({
        reconnectState: "failed",
        lastError
      });
    },
    reset() {
      set(initialState);
    }
  }));
}

export const useConnectionStore = createConnectionStore();
