const tokenKeyPrefix = "ceryx.desktop.token::";

function buildTokenKey(baseUrl: string): string {
  return `${tokenKeyPrefix}${baseUrl}`;
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

export function readDeviceToken(baseUrl: string): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  const direct = window.localStorage.getItem(buildTokenKey(baseUrl)) ?? undefined;
  if (direct) {
    return direct;
  }

  const alternateBaseUrl = resolveAlternateBaseUrl(baseUrl);
  return alternateBaseUrl
    ? window.localStorage.getItem(buildTokenKey(alternateBaseUrl)) ?? undefined
    : undefined;
}

export function writeDeviceToken(baseUrl: string, token: string): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(buildTokenKey(baseUrl), token);
}

export function clearDeviceToken(baseUrl: string): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(buildTokenKey(baseUrl));
}
