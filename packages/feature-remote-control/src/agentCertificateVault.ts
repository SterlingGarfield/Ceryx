const keyPrefix = "ceryx.agent-cert-fingerprint.";

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

export function readAgentCertificateFingerprint(baseUrl: string): string | undefined {
  if (!baseUrl.trim()) {
    return undefined;
  }

  try {
    const direct = globalThis.localStorage?.getItem(keyFor(baseUrl)) ?? undefined;
    if (direct) {
      return direct;
    }

    const alternateBaseUrl = resolveAlternateBaseUrl(baseUrl);
    return alternateBaseUrl
      ? globalThis.localStorage?.getItem(keyFor(alternateBaseUrl)) ?? undefined
      : undefined;
  } catch {
    return undefined;
  }
}

export function writeAgentCertificateFingerprint(baseUrl: string, fingerprint: string): void {
  if (!baseUrl.trim() || !fingerprint.trim()) {
    return;
  }

  try {
    globalThis.localStorage?.setItem(keyFor(baseUrl), fingerprint.trim().toUpperCase());
  } catch {
    // Ignore storage failures.
  }
}

export function clearAgentCertificateFingerprint(baseUrl: string): void {
  if (!baseUrl.trim()) {
    return;
  }

  try {
    globalThis.localStorage?.removeItem(keyFor(baseUrl));
  } catch {
    // Ignore storage failures.
  }
}
