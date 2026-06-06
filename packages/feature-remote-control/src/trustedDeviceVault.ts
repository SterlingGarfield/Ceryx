import type { TrustedDevice } from "@ceryx/protocol";

const keyPrefix = "ceryx.trusted-devices.";

function keyFor(baseUrl: string): string {
  return `${keyPrefix}${encodeURIComponent(baseUrl.trim().toLowerCase())}`;
}

function resolveAlternateBaseUrl(baseUrl: string): string | undefined {
  try {
    const parsed = new URL(baseUrl);
    if (parsed.port !== "41527") {
      return undefined;
    }

    if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost" && parsed.hostname !== "::1") {
      return undefined;
    }

    if (parsed.protocol === "https:") {
      parsed.protocol = "http:";
    } else if (parsed.protocol === "http:") {
      parsed.protocol = "https:";
    } else {
      return undefined;
    }

    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

export function readTrustedDevicesCache(baseUrl: string): TrustedDevice[] {
  if (!baseUrl.trim()) {
    return [];
  }

  try {
    const raw = globalThis.localStorage?.getItem(keyFor(baseUrl))
      ?? (() => {
        const alternateBaseUrl = resolveAlternateBaseUrl(baseUrl);
        return alternateBaseUrl
          ? globalThis.localStorage?.getItem(keyFor(alternateBaseUrl))
          : null;
      })();
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
