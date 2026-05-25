import { ceryxColors } from "@ceryx/design-tokens";
import { Button, Panel } from "@ceryx/ui";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  requestLocalNotificationsPermission,
  type LocalNotificationPermissionState
} from "../platform/ipad/localNotificationsPermission";

export function LaunchRoute() {
  const navigate = useNavigate();
  const [notificationPermission, setNotificationPermission] =
    useState<LocalNotificationPermissionState>("prompt");
  const [permissionBusy, setPermissionBusy] = useState(false);

  async function handleRequestNotificationsPermission() {
    setPermissionBusy(true);
    try {
      const result = await requestLocalNotificationsPermission();
      setNotificationPermission(result);
    } finally {
      setPermissionBusy(false);
    }
  }

  const permissionLabel =
    notificationPermission === "granted"
      ? "granted"
      : notificationPermission === "denied"
        ? "denied"
        : notificationPermission === "unsupported"
          ? "unsupported"
          : "not requested";

  return (
    <section style={{ margin: "0 auto", maxWidth: 960, padding: 24 }}>
      <h1 style={{ fontSize: 30, margin: "0 0 12px" }}>Ceryx iPad Launch</h1>
      <p style={{ color: ceryxColors.onSurfaceVariant, margin: "0 0 20px" }}>
        Connect to a Windows Agent, pair your iPad, and enter remote control.
      </p>

      <Panel
        size="ipad"
        style={{
          display: "grid",
          gap: 14
        }}
      >
        <p style={{ margin: 0 }}>
          Step 1: Ensure the Windows Agent is running on the same network.
        </p>
        <p style={{ margin: 0 }}>
          Step 2: Open Connections to discover devices and start pairing.
        </p>
        <p style={{ margin: 0 }}>
          Step 3: Grant local notifications permission for status alerts.
        </p>
        <div style={{ display: "flex", gap: 12 }}>
          <Button
            size="ipad"
            style={{ minWidth: 168 }}
            onClick={() => navigate("/connections")}
          >
            Go to Connections
          </Button>
          <Button
            size="ipad"
            variant="secondary"
            style={{ minWidth: 168 }}
            onClick={() => navigate("/console")}
          >
            Open Live Console
          </Button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Button
            size="ipad"
            variant="secondary"
            style={{ minWidth: 240 }}
            disabled={permissionBusy}
            onClick={() => void handleRequestNotificationsPermission()}
          >
            {permissionBusy
              ? "Requesting Notification Permission..."
              : "Request Notification Permission"}
          </Button>
          <span style={{ color: ceryxColors.onSurfaceVariant }}>
            Notification permission: {permissionLabel}
          </span>
        </div>
      </Panel>
    </section>
  );
}
