const tokenKeyPrefix = "ceryx.desktop.token::";

function buildTokenKey(baseUrl: string): string {
  return `${tokenKeyPrefix}${baseUrl}`;
}

export function readDeviceToken(baseUrl: string): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.localStorage.getItem(buildTokenKey(baseUrl)) ?? undefined;
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
