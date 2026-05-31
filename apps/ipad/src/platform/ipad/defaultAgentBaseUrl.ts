const localFallbackBaseUrl = "http://127.0.0.1:41527";

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isHttpOrigin(protocol: string): boolean {
  return protocol === "http:" || protocol === "https:";
}

export function resolveDefaultAgentBaseUrl(): string {
  if (typeof window === "undefined") {
    return localFallbackBaseUrl;
  }

  if (!isHttpOrigin(window.location.protocol)) {
    return localFallbackBaseUrl;
  }

  return stripTrailingSlash(window.location.origin);
}

export function isWebOriginBaseUrl(value: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  if (!isHttpOrigin(window.location.protocol)) {
    return false;
  }

  const candidate = stripTrailingSlash(value);
  const origin = stripTrailingSlash(window.location.origin);
  return candidate === origin;
}

export function normalizeAgentBaseUrl(value: string | undefined): string | undefined {
  return value;
}
