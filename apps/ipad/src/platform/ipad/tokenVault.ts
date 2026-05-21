const keyPrefix = "ceryx.ipad.device-token.";

function keyFor(baseUrl: string): string {
  return `${keyPrefix}${encodeURIComponent(baseUrl.trim().toLowerCase())}`;
}

export function readDeviceToken(baseUrl: string): string | undefined {
  if (!baseUrl.trim()) {
    return undefined;
  }

  try {
    return globalThis.localStorage.getItem(keyFor(baseUrl)) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeDeviceToken(baseUrl: string, token: string): void {
  if (!baseUrl.trim() || !token.trim()) {
    return;
  }

  try {
    globalThis.localStorage.setItem(keyFor(baseUrl), token);
  } catch {
    // Ignore storage failures.
  }
}

export function clearDeviceToken(baseUrl: string): void {
  if (!baseUrl.trim()) {
    return;
  }

  try {
    globalThis.localStorage.removeItem(keyFor(baseUrl));
  } catch {
    // Ignore storage failures.
  }
}
