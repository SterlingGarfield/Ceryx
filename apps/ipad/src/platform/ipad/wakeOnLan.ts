import { Capacitor, registerPlugin } from "@capacitor/core";
import type { WakeOnLanInfo } from "@ceryx/protocol";
import { probeAgent, type AgentProbeResult } from "./agentGateway";

interface WakeOnLanPluginApi {
  send(request: {
    broadcastAddress: string;
    port: number;
    macAddresses: string[];
    repeatCount?: number;
    repeatIntervalMs?: number;
  }): Promise<{ sentCount: number }>;
}

const wakeOnLanPlugin = registerPlugin<WakeOnLanPluginApi>("WakeOnLanPlugin");

export interface WakeOnLanTarget {
  baseUrl: string;
  deviceName: string;
  wol: WakeOnLanInfo;
}

export interface WakeOnLanResult {
  probe: AgentProbeResult;
  woke: boolean;
}

export function buildMagicPacket(macAddress: string): Uint8Array {
  const normalized = normalizeMacAddress(macAddress);
  if (!normalized) {
    throw new Error("Invalid MAC address.");
  }

  const bytes = new Uint8Array(102);
  bytes.fill(0xff, 0, 6);

  const macBytes = normalized.match(/.{1,2}/g)?.map((value) => Number.parseInt(value, 16)) ?? [];
  for (let index = 0; index < 16; index += 1) {
    bytes.set(macBytes, 6 + index * 6);
  }

  return bytes;
}

export async function sendWakeOnLan(info: WakeOnLanInfo): Promise<void> {
  if (!info.supported) {
    throw new Error("Wake on LAN is not available for this agent.");
  }

  if (!info.macAddresses.length) {
    throw new Error("No MAC addresses were provided for Wake on LAN.");
  }

  if (!Capacitor.isNativePlatform()) {
    throw new Error("Wake on LAN requires the native iPad app.");
  }

  await wakeOnLanPlugin.send({
    broadcastAddress: info.broadcastAddress,
    port: info.port,
    macAddresses: info.macAddresses,
    repeatCount: 3,
    repeatIntervalMs: 100
  });
}

export async function wakeAgent(target: WakeOnLanTarget): Promise<WakeOnLanResult> {
  await sendWakeOnLan(target.wol);

  const deadline = Date.now() + 90_000;
  let probe = await probeAgent(target.baseUrl);
  while (!probe.reachable && Date.now() < deadline) {
    await wait(2_000);
    probe = await probeAgent(target.baseUrl);
  }

  return {
    probe,
    woke: probe.reachable
  };
}

function normalizeMacAddress(macAddress: string): string {
  const hex = macAddress.replace(/[^a-fA-F0-9]/g, "");
  return hex.length === 12 ? hex.toUpperCase() : "";
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}
