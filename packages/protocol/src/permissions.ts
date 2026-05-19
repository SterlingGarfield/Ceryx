export const CeryxPermissions = [
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
] as const;

export type CeryxPermission = (typeof CeryxPermissions)[number];
