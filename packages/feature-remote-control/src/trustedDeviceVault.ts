import type { TrustedDevice } from "@ceryx/protocol";

const keyPrefix = "ceryx.trusted-devices.";

function keyFor(baseUrl: string): string {
  return `${keyPrefix}${encodeURIComponent(baseUrl.trim().toLowerCase())}`;
}

export function readTrustedDevicesCache(baseUrl: string): TrustedDevice[] {
  if (!baseUrl.trim()) {
    return [];
  }

  try {
    const raw = globalThis.localStorage?.getItem(keyFor(baseUrl));
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as TrustedDevice[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeTrustedDevicesCache(baseUrl: string, devices: TrustedDevice[]): void {
  if (!baseUrl.trim()) {
    return;
  }

  try {
    globalThis.localStorage?.setItem(keyFor(baseUrl), JSON.stringify(devices));
  } catch {
    // Ignore storage failures.
  }
}

export function clearTrustedDevicesCache(baseUrl: string): void {
  if (!baseUrl.trim()) {
    return;
  }

  try {
    globalThis.localStorage?.removeItem(keyFor(baseUrl));
  } catch {
    // Ignore storage failures.
  }
}
