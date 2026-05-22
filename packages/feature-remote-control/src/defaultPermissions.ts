import type { ClientType, CeryxPermission } from "@ceryx/protocol";

const ipadPermissions: CeryxPermission[] = [
  "view_window",
  "control_input",
  "send_prompt",
  "upload_image",
  "read_diff",
  "screenshot",
  "recording",
  "copy_output"
];

const desktopPermissions: CeryxPermission[] = [
  "view_window",
  "control_input",
  "send_prompt",
  "upload_image",
  "read_diff",
  "run_test",
  "screenshot",
  "recording",
  "copy_output",
  "manage_agent",
  "manage_devices"
];

export function defaultPermissionsForClient(clientType: ClientType): CeryxPermission[] {
  return clientType === "desktop" ? [...desktopPermissions] : [...ipadPermissions];
}

export function hasPermission(
  permissions: readonly CeryxPermission[],
  permission: CeryxPermission
): boolean {
  return permissions.includes(permission);
}
