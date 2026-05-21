import {
  AgentClient,
  type AgentStatus,
  type PairingConfirmResponse,
  type PairingConfirmRejectedResponse,
  type PairingRequestResponse,
  type TrustedDevice,
  type PairingRequestRejectedResponse
} from "@ceryx/client-sdk";
import {
  clearDeviceToken,
  readDeviceToken,
  writeDeviceToken
} from "./tokenVault";

export interface AgentProbeResult {
  baseUrl: string;
  reachable: boolean;
  latencyMs: number | null;
  deviceName: string;
  codexStatus: string;
  runtimeStatus: string;
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

export async function probeAgent(baseUrl: string): Promise<AgentProbeResult> {
  const start = Date.now();
  const client = createClient(baseUrl);

  try {
    await client.health();
    const latencyMs = Date.now() - start;

    let agentStatus: AgentStatus | null = null;
    try {
      agentStatus = await client.agentStatus();
    } catch {
      agentStatus = null;
    }

    return {
      baseUrl,
      reachable: true,
      latencyMs,
      deviceName: agentStatus?.deviceName ?? "Windows Agent",
      codexStatus: agentStatus?.codexStatus ?? "unknown",
      runtimeStatus: agentStatus?.status ?? "unpaired",
      message: agentStatus ? "Connected" : "Reachable (pairing required)"
    };
  } catch {
    return {
      baseUrl,
      reachable: false,
      latencyMs: null,
      deviceName: "Windows Agent",
      codexStatus: "unknown",
      runtimeStatus: "offline",
      message: "Offline or unreachable"
    };
  }
}

export async function listTrustedDevices(baseUrl: string): Promise<TrustedDevice[]> {
  if (!readDeviceToken(baseUrl)) {
    return [];
  }

  try {
    return await createClient(baseUrl).listDevices();
  } catch {
    return [];
  }
}

export async function requestPairing(
  baseUrl: string,
  request: { clientName: string; clientType: "ipad"; platform: string }
): Promise<PairingRequestResponse | PairingRequestRejectedResponse> {
  return createClient(baseUrl).requestPairing(request);
}

export async function confirmPairing(
  baseUrl: string,
  request: { pairingId: string; code: string }
): Promise<PairingConfirmResponse | PairingConfirmRejectedResponse> {
  return createClient(baseUrl).confirmPairing(request);
}
