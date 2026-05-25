import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

export type LocalNotificationPermissionState =
  | "granted"
  | "denied"
  | "prompt"
  | "unsupported";

function normalizePermission(
  permission: string
): LocalNotificationPermissionState {
  if (permission === "granted") {
    return "granted";
  }

  if (permission === "denied") {
    return "denied";
  }

  if (permission === "prompt") {
    return "prompt";
  }

  return "unsupported";
}

export async function requestLocalNotificationsPermission(): Promise<LocalNotificationPermissionState> {
  if (!Capacitor.isNativePlatform()) {
    if (!("Notification" in globalThis)) {
      return "unsupported";
    }

    const result = await Notification.requestPermission();
    return normalizePermission(result);
  }

  try {
    const current = await LocalNotifications.checkPermissions();
    if (current.display === "granted") {
      return "granted";
    }

    const requested = await LocalNotifications.requestPermissions();
    return normalizePermission(requested.display);
  } catch {
    return "unsupported";
  }
}
