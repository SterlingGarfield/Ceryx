import type { CeryxPermission } from "@ceryx/protocol";
import { Button, Panel } from "@ceryx/ui";
import { hasPermission } from "./defaultPermissions";

type ToolbarAction =
  | "approve"
  | "reject"
  | "diff"
  | "test"
  | "screenshot"
  | "stop"
  | "record"
  | "copy-output"
  | "paste-to-windows"
  | "copy-from-windows";

export interface CodexToolbarProps {
  size?: "desktop" | "ipad";
  connected: boolean;
  permissions: readonly CeryxPermission[];
  recordingActive?: boolean;
  captureActive?: boolean;
  busy?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
  onDiff?: () => void;
  onTest?: () => void;
  onScreenshot?: () => void;
  onStop?: () => void;
  onRecord?: () => void;
  onCopyOutput?: () => void;
  onPasteToWindows?: () => void;
  onCopyFromWindows?: () => void;
}

function canRunAction(
  permissions: readonly CeryxPermission[],
  connected: boolean,
  action: ToolbarAction
): boolean {
  if (!connected) {
    return false;
  }

  switch (action) {
    case "approve":
    case "reject":
      return hasPermission(permissions, "control_input");
    case "diff":
      return hasPermission(permissions, "read_diff");
    case "test":
      return hasPermission(permissions, "run_test");
    case "screenshot":
      return hasPermission(permissions, "screenshot");
    case "stop":
      return hasPermission(permissions, "view_window") || hasPermission(permissions, "recording");
    case "record":
      return hasPermission(permissions, "recording");
    case "copy-output":
      return hasPermission(permissions, "copy_output");
    case "paste-to-windows":
    case "copy-from-windows":
      return hasPermission(permissions, "manage_agent");
    default:
      return false;
  }
}

export function CodexToolbar({
  size = "desktop",
  connected,
  permissions,
  recordingActive = false,
  captureActive = false,
  busy = false,
  onApprove,
  onReject,
  onDiff,
  onTest,
  onScreenshot,
  onStop,
  onRecord,
  onCopyOutput,
  onPasteToWindows,
  onCopyFromWindows
}: CodexToolbarProps) {
  const actions: Array<{
    key: ToolbarAction;
    label: string;
    variant?: "primary" | "secondary" | "ghost";
    onClick?: () => void;
  }> = [
    { key: "approve", label: "Approve", onClick: onApprove },
    { key: "reject", label: "Reject", variant: "secondary", onClick: onReject },
    { key: "diff", label: "Diff", variant: "secondary", onClick: onDiff },
    { key: "test", label: "Test", variant: "secondary", onClick: onTest },
    { key: "screenshot", label: "Screenshot", variant: "secondary", onClick: onScreenshot },
    { key: "stop", label: captureActive || recordingActive ? "Stop Active" : "Stop", variant: "ghost", onClick: onStop },
    { key: "record", label: recordingActive ? "Stop Record" : "Record", variant: "ghost", onClick: onRecord },
    { key: "copy-output", label: "Copy Output", variant: "ghost", onClick: onCopyOutput },
    { key: "paste-to-windows", label: "Paste to Windows", variant: "ghost", onClick: onPasteToWindows },
    { key: "copy-from-windows", label: "Copy from Windows", variant: "ghost", onClick: onCopyFromWindows }
  ];

  return (
    <Panel size={size} style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
      {actions.map((action) => (
        <Button
          key={action.key}
          size={size}
          variant={action.variant}
          disabled={
            busy ||
            !action.onClick ||
            !canRunAction(permissions, connected, action.key)
          }
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      ))}
    </Panel>
  );
}
