import type { AgentManagementResponse } from "@ceryx/client-sdk";

export interface DesktopShellApi {
  startLocalAgent?: () => Promise<AgentManagementResponse>;
  restartLocalAgent?: () => Promise<AgentManagementResponse>;
  openLogsFolder?: () => Promise<AgentManagementResponse>;
}

declare global {
  interface Window {
    __CERYX_DESKTOP__?: DesktopShellApi;
  }
}

function unavailable(action: string, message: string): AgentManagementResponse {
  return {
    ok: true,
    action,
    status: "unavailable",
    executed: false,
    message
  };
}

function getShellApi(): DesktopShellApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.__CERYX_DESKTOP__;
}

export async function startLocalAgentViaShell(): Promise<AgentManagementResponse> {
  const api = getShellApi();
  if (!api?.startLocalAgent) {
    return unavailable(
      "start-local-agent",
      "Desktop shell integration is unavailable in browser preview."
    );
  }

  return api.startLocalAgent();
}

export async function restartLocalAgentViaShell(): Promise<AgentManagementResponse> {
  const api = getShellApi();
  if (!api?.restartLocalAgent) {
    return unavailable(
      "restart-local-agent",
      "Desktop shell integration is unavailable in browser preview."
    );
  }

  return api.restartLocalAgent();
}

export async function openLogsFolderViaShell(): Promise<AgentManagementResponse> {
  const api = getShellApi();
  if (!api?.openLogsFolder) {
    return unavailable(
      "open-logs-folder",
      "Desktop shell integration is unavailable in browser preview."
    );
  }

  return api.openLogsFolder();
}
