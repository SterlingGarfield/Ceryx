import type { ClientType, PairingState } from "@ceryx/protocol";
import { create } from "zustand";

export interface PairingStateModel {
  state: PairingState | "requesting";
  clientName: string;
  clientType: ClientType;
  platform: string;
  pairingId: string;
  expiresAt: string;
  code: string;
  deviceId: string;
  failedAttempts: number;
  isLocked: boolean;
  rejectedReason: string;
  lastError: string;
}

export interface PairingActions {
  beginRequest(input: { clientName: string; clientType: ClientType; platform: string }): void;
  setRequestAccepted(input: { pairingId: string; expiresAt: string; state: PairingState }): void;
  setCode(code: string): void;
  markCodeInput(): void;
  markVerifying(): void;
  markSuccess(deviceId: string): void;
  markRejected(input: {
    rejectedReason: string;
    failedAttempts?: number;
    isLocked?: boolean;
    state?: PairingState;
  }): void;
  markExpired(): void;
  markNetworkError(message: string): void;
  reset(): void;
}

export type PairingStore = PairingStateModel & PairingActions;

const initialState: PairingStateModel = {
  state: "idle",
  clientName: "",
  clientType: "ipad",
  platform: "",
  pairingId: "",
  expiresAt: "",
  code: "",
  deviceId: "",
  failedAttempts: 0,
  isLocked: false,
  rejectedReason: "",
  lastError: ""
};

export function createPairingStore() {
  return create<PairingStore>()((set) => ({
    ...initialState,
    beginRequest(input) {
      set({
        state: "requesting",
        clientName: input.clientName,
        clientType: input.clientType,
        platform: input.platform,
        lastError: "",
        rejectedReason: "",
        code: ""
      });
    },
    setRequestAccepted(input) {
      set({
        state: input.state,
        pairingId: input.pairingId,
        expiresAt: input.expiresAt,
        lastError: "",
        failedAttempts: 0,
        isLocked: false
      });
    },
    setCode(code) {
      set({
        code
      });
    },
    markCodeInput() {
      set({
        state: "code_input"
      });
    },
    markVerifying() {
      set({
        state: "verifying",
        lastError: ""
      });
    },
    markSuccess(deviceId) {
      set({
        state: "success",
        deviceId,
        lastError: "",
        rejectedReason: ""
      });
    },
    markRejected(input) {
      set({
        state: input.state ?? "rejected",
        rejectedReason: input.rejectedReason,
        failedAttempts: input.failedAttempts ?? 0,
        isLocked: input.isLocked ?? false
      });
    },
    markExpired() {
      set({
        state: "expired",
        lastError: ""
      });
    },
    markNetworkError(lastError) {
      set({
        state: "network_error",
        lastError
      });
    },
    reset() {
      set(initialState);
    }
  }));
}

export const usePairingStore = createPairingStore();
