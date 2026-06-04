import { ceryxColors } from "@ceryx/design-tokens";
import type { TrustedDevice } from "@ceryx/client-sdk";
import { useConnectionStore } from "@ceryx/feature-remote-control";
import { Button, Panel, StatusChip } from "@ceryx/ui";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  defaultLocalAgentBaseUrl,
  listTrustedDevices,
  openLogsFolder,
  probeLocalAgent,
  restartLocalAgent,
  startLocalAgent,
  type LocalAgentProbeResult
} from "../platform/desktop/agentGateway";

type SortKey = "name" | "latency" | "status" | "recent";

type RemoteAgentView = TrustedDevice & {
  latencyMs?: number;
  status?: string;
};

function formatTimestamp(value?: string): string {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function formatLatency(value?: number | null): string {
  return typeof value === "number" ? `${value} ms` : "-";
}

function statusRank(status: string): number {
  switch (status) {
    case "running":
      return 0;
    case "starting":
      return 1;
    case "trusted":
      return 2;
    case "paused":
      return 3;
    case "stopping":
      return 4;
    case "error":
      return 5;
    case "offline":
      return 6;
    default:
      return 7;
  }
}

function toneForStatus(status: string): "neutral" | "success" | "warning" | "error" {
  switch (status) {
    case "running":
    case "trusted":
      return "success";
    case "starting":
    case "paused":
    case "stopping":
      return "warning";
    case "error":
    case "offline":
      return "error";
    default:
      return "neutral";
  }
}

function sortRemoteAgents(devices: RemoteAgentView[], sortKey: SortKey): RemoteAgentView[] {
  const next = [...devices];
  next.sort((left, right) => {
    switch (sortKey) {
      case "name":
        return left.name.localeCompare(right.name, "en");
      case "latency": {
        const leftLatency = left.latencyMs ?? Number.POSITIVE_INFINITY;
        const rightLatency = right.latencyMs ?? Number.POSITIVE_INFINITY;
        return leftLatency - rightLatency || left.name.localeCompare(right.name, "en");
      }
      case "status":
        return (
          statusRank(left.status ?? "trusted") - statusRank(right.status ?? "trusted") ||
          left.name.localeCompare(right.name, "en")
        );
      case "recent": {
        const leftRecent = Date.parse(left.lastConnectedAt ?? left.createdAt);
        const rightRecent = Date.parse(right.lastConnectedAt ?? right.createdAt);
        return rightRecent - leftRecent || left.name.localeCompare(right.name, "en");
      }
      default:
        return 0;
    }
  });
  return next;
}

function isRunning(localAgent: LocalAgentProbeResult | null): boolean {
  return localAgent?.runtimeStatus === "running";
}

function isOffline(localAgent: LocalAgentProbeResult | null): boolean {
  return !localAgent || !localAgent.reachable || localAgent.runtimeStatus === "offline";
}

export function HomeRoute() {
  const navigate = useNavigate();
  const setCurrentDevice = useConnectionStore((state) => state.setCurrentDevice);
  const setAgentStatus = useConnectionStore((state) => state.setAgentStatus);
  const setLatency = useConnectionStore((state) => state.setLatency);
  const setTokenState = useConnectionStore((state) => state.setTokenState);
  const [localAgent, setLocalAgent] = useState<LocalAgentProbeResult | null>(null);
  const [trustedDevices, setTrustedDevices] = useState<RemoteAgentView[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("recent");
  const [feedback, setFeedback] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [actionInFlight, setActionInFlight] = useState<null | "start" | "restart" | "logs">(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>("");
  const [isVisible, setIsVisible] = useState(
    typeof document === "undefined" ? true : document.visibilityState === "visible"
  );

  useEffect(() => {
    setCurrentDevice({
      deviceId: "local-agent",
      deviceName: "Local Windows PC",
      platform: "windows",
      baseUrl: defaultLocalAgentBaseUrl
    });
  }, [setCurrentDevice]);

  useEffect(() => {
    const handleVisibility = () => {
      setIsVisible(document.visibilityState === "visible");
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refreshHomeState() {
      setIsRefreshing(true);

      const nextLocalAgent = await probeLocalAgent(defaultLocalAgentBaseUrl);
      const nextTrustedDevices = await listTrustedDevices(defaultLocalAgentBaseUrl);
      if (cancelled) {
        return;
      }

      setLocalAgent(nextLocalAgent);
      setTrustedDevices(nextTrustedDevices as RemoteAgentView[]);
      setAgentStatus(
        nextLocalAgent.runtimeStatus === "running" ||
          nextLocalAgent.runtimeStatus === "starting" ||
          nextLocalAgent.runtimeStatus === "paused" ||
          nextLocalAgent.runtimeStatus === "stopping" ||
          nextLocalAgent.runtimeStatus === "error"
          ? nextLocalAgent.runtimeStatus
          : null
      );
      setLatency(nextLocalAgent.latencyMs);
      setTokenState(nextLocalAgent.tokenState);
      setLastRefreshedAt(new Date().toISOString());
      setIsRefreshing(false);
    }

    if (!isVisible) {
      return () => {
        cancelled = true;
      };
    }

    void refreshHomeState();
    const intervalId = window.setInterval(() => {
      void refreshHomeState();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isVisible, setAgentStatus, setLatency, setTokenState]);

  async function handleRefresh() {
    setIsRefreshing(true);
    const nextLocalAgent = await probeLocalAgent(defaultLocalAgentBaseUrl);
    const nextTrustedDevices = await listTrustedDevices(defaultLocalAgentBaseUrl);
    setLocalAgent(nextLocalAgent);
    setTrustedDevices(nextTrustedDevices as RemoteAgentView[]);
    setAgentStatus(
      nextLocalAgent.runtimeStatus === "running" ||
        nextLocalAgent.runtimeStatus === "starting" ||
        nextLocalAgent.runtimeStatus === "paused" ||
        nextLocalAgent.runtimeStatus === "stopping" ||
        nextLocalAgent.runtimeStatus === "error"
        ? nextLocalAgent.runtimeStatus
        : null
    );
    setLatency(nextLocalAgent.latencyMs);
    setTokenState(nextLocalAgent.tokenState);
    setLastRefreshedAt(new Date().toISOString());
    setIsRefreshing(false);
  }

  async function handleStartAgent() {
    setActionInFlight("start");
    const result = await startLocalAgent();
    setFeedback(result.message);
    setActionInFlight(null);
    await handleRefresh();
  }

  async function handleRestartAgent() {
    setActionInFlight("restart");
    const result = await restartLocalAgent(defaultLocalAgentBaseUrl);
    setFeedback(result.message);
    setActionInFlight(null);
    await handleRefresh();
  }

  async function handleOpenLogs() {
    setActionInFlight("logs");
    const result = await openLogsFolder(defaultLocalAgentBaseUrl);
    setFeedback(result.message);
    setActionInFlight(null);
    await handleRefresh();
  }

  const remoteAgents = sortRemoteAgents(trustedDevices, sortKey);
  const wakeOnLanInfo = useMemo(
    () => trustedDevices.find((device) => device.wol?.supported)?.wol ?? null,
    [trustedDevices]
  );

  return (
    <section
      style={{
        display: "grid",
        gridTemplateRows: "56px 1fr 36px",
        minHeight: "100vh"
      }}
    >
      <header
        style={{
          alignItems: "center",
          background:
            "linear-gradient(90deg, rgba(250,242,236,0.98), rgba(255,255,255,0.98))",
          borderBottom: `1px solid ${ceryxColors.outlineVariant}`,
          display: "flex",
          justifyContent: "space-between",
          padding: "0 18px"
        }}
      >
        <div style={{ alignItems: "center", display: "flex", gap: 18 }}>
          <strong style={{ fontSize: 15 }}>Ceryx Desktop</strong>
          <nav style={{ display: "flex", gap: 14 }}>
            <span>File</span>
            <span>Agent</span>
            <span>Window</span>
            <span>Help</span>
          </nav>
        </div>
        <StatusChip tone={isRefreshing ? "warning" : "success"}>
          {isRefreshing ? "refreshing" : "ready"}
        </StatusChip>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", minHeight: 0 }}>
        <aside
          style={{
            backgroundColor: ceryxColors.surfaceContainerLow,
            borderRight: `1px solid ${ceryxColors.outlineVariant}`,
            display: "grid",
            gap: 8,
            padding: 16,
            alignContent: "start"
          }}
        >
          <div
            style={{
              color: ceryxColors.onSurfaceVariant,
              fontSize: 12,
              letterSpacing: 0.3,
              textTransform: "uppercase"
            }}
          >
            Workspace
          </div>
          <Button size="desktop" style={{ justifyContent: "flex-start" }}>
            Home
          </Button>
          <Button size="desktop" variant="ghost" disabled style={{ justifyContent: "flex-start" }}>
            Connections
          </Button>
          <Button
            size="desktop"
            variant="ghost"
            style={{ justifyContent: "flex-start" }}
            onClick={() => navigate("/console")}
          >
            Console
          </Button>
          <Button size="desktop" variant="ghost" disabled style={{ justifyContent: "flex-start" }}>
            Settings
          </Button>
        </aside>

        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateRows: "auto auto 1fr",
            overflow: "auto",
            padding: 18
          }}
        >
          <div
            style={{
              alignItems: "center",
              display: "flex",
              justifyContent: "space-between"
            }}
          >
            <div>
              <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>Desktop Home</h1>
              <p style={{ color: ceryxColors.onSurfaceVariant, margin: 0 }}>
                Local agent connectivity, trusted devices, and desktop-side control readiness.
              </p>
            </div>
            <Button size="desktop" variant="secondary" onClick={() => void handleRefresh()}>
              Refresh
            </Button>
          </div>

          <Panel style={{ display: "grid", gap: 10 }}>
            <div
              style={{
                alignItems: "center",
                display: "flex",
                justifyContent: "space-between"
              }}
            >
              <h2 style={{ margin: 0 }}>Wake on LAN</h2>
              <StatusChip tone={wakeOnLanInfo ? "success" : "neutral"}>
                {wakeOnLanInfo ? "supported" : "unavailable"}
              </StatusChip>
            </div>
            {wakeOnLanInfo ? (
              <>
                <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 13 }}>
                  Broadcast: {wakeOnLanInfo.broadcastAddress}:{wakeOnLanInfo.port}
                </div>
                <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 13 }}>
                  MACs: {wakeOnLanInfo.macAddresses.join(", ")}
                </div>
                <Button
                  size="desktop"
                  variant="secondary"
                  style={{ width: "fit-content" }}
                  onClick={async () => {
                    const payload = [
                      `broadcast=${wakeOnLanInfo.broadcastAddress}`,
                      `port=${wakeOnLanInfo.port}`,
                      `macs=${wakeOnLanInfo.macAddresses.join(",")}`
                    ].join("\n");

                    try {
                      await navigator.clipboard.writeText(payload);
                      setFeedback("Wake-on-LAN details copied to clipboard.");
                    } catch {
                      setFeedback("Unable to copy Wake-on-LAN details.");
                    }
                  }}
                >
                  Copy Wake Details
                </Button>
              </>
            ) : (
              <p style={{ color: ceryxColors.onSurfaceVariant, margin: 0 }}>
                Pair this desktop client to cache Wake-on-LAN details for the local Windows host.
              </p>
            )}
          </Panel>

          {feedback ? (
            <Panel
              style={{
                backgroundColor: ceryxColors.surfaceContainerLow,
                borderColor: ceryxColors.outlineVariant
              }}
            >
              <p style={{ margin: 0 }}>{feedback}</p>
            </Panel>
          ) : null}

          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(340px, 420px) 1fr" }}>
            <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
              <Panel style={{ display: "grid", gap: 14 }}>
                <div
                  style={{
                    alignItems: "center",
                    display: "flex",
                    justifyContent: "space-between"
                  }}
                >
                  <div>
                    <div
                      style={{
                        color: ceryxColors.onSurfaceVariant,
                        fontSize: 12,
                        letterSpacing: 0.3,
                        textTransform: "uppercase"
                      }}
                    >
                      Local Agent
                    </div>
                    <strong style={{ fontSize: 18 }}>
                      {localAgent?.deviceName ?? "Local Windows PC"}
                    </strong>
                  </div>
                  <StatusChip tone={toneForStatus(localAgent?.runtimeStatus ?? "offline")}>
                    {localAgent?.runtimeStatus ?? "offline"}
                  </StatusChip>
                </div>

                <div style={{ color: ceryxColors.onSurfaceVariant, display: "grid", gap: 8 }}>
                  <div>Base URL: {defaultLocalAgentBaseUrl}</div>
                  <div>Latency: {formatLatency(localAgent?.latencyMs)}</div>
                  <div>Codex Window: {localAgent?.codexStatus ?? "unknown"}</div>
                  <div>Token State: {localAgent?.tokenState ?? "missing"}</div>
                </div>

                <p style={{ color: ceryxColors.onSurfaceVariant, margin: 0 }}>
                  {localAgent?.message ?? "Checking local agent state..."}
                </p>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {isOffline(localAgent) ? (
                    <Button
                      size="desktop"
                      style={{ minWidth: 140 }}
                      disabled={actionInFlight !== null}
                      onClick={() => void handleStartAgent()}
                    >
                      {actionInFlight === "start" ? "Starting..." : "Start Agent"}
                    </Button>
                  ) : null}

                  {isRunning(localAgent) ? (
                    <>
                      <Button
                        size="desktop"
                        style={{ minWidth: 140 }}
                        disabled={actionInFlight !== null}
                        onClick={() => void handleRestartAgent()}
                      >
                        {actionInFlight === "restart" ? "Restarting..." : "Restart Agent"}
                      </Button>
                      <Button
                        size="desktop"
                        variant="secondary"
                        style={{ minWidth: 160 }}
                        disabled={actionInFlight !== null}
                        onClick={() => void handleOpenLogs()}
                      >
                        {actionInFlight === "logs" ? "Opening..." : "Open Logs Folder"}
                      </Button>
                    </>
                  ) : null}
                </div>
              </Panel>

              <Panel style={{ display: "grid", gap: 12 }}>
                <div
                  style={{
                    alignItems: "center",
                    display: "flex",
                    justifyContent: "space-between"
                  }}
                >
                  <h2 style={{ fontSize: 18, margin: 0 }}>Trusted Devices</h2>
                  <StatusChip tone="neutral">{trustedDevices.length} devices</StatusChip>
                </div>

                {trustedDevices.length === 0 ? (
                  <p style={{ color: ceryxColors.onSurfaceVariant, margin: 0 }}>
                    No trusted devices available yet.
                  </p>
                ) : (
                  trustedDevices.map((device) => (
                    <div
                      key={device.id}
                      style={{
                        borderTop: `1px solid ${ceryxColors.outlineVariant}`,
                        display: "grid",
                        gap: 6,
                        paddingTop: 10
                      }}
                    >
                      <div
                        style={{
                          alignItems: "center",
                          display: "flex",
                          justifyContent: "space-between"
                        }}
                      >
                        <strong>{device.name}</strong>
                        <StatusChip tone="success">trusted</StatusChip>
                      </div>
                      <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 13 }}>
                        {device.platform} | recent:{" "}
                        {formatTimestamp(device.lastConnectedAt ?? device.createdAt)}
                      </div>
                    </div>
                  ))
                )}
              </Panel>
            </div>

            <Panel style={{ display: "grid", gap: 16, minHeight: 0 }}>
              <div
                style={{
                  alignItems: "center",
                  display: "flex",
                  justifyContent: "space-between"
                }}
              >
                <h2 style={{ fontSize: 18, margin: 0 }}>Connection Directory</h2>
                <label style={{ alignItems: "center", display: "flex", gap: 8 }}>
                  <span style={{ color: ceryxColors.onSurfaceVariant, fontSize: 13 }}>Sort by</span>
                  <select
                    aria-label="Sort remote agents"
                    value={sortKey}
                    onChange={(event) => setSortKey(event.target.value as SortKey)}
                    style={{
                      backgroundColor: ceryxColors.surfaceContainerLowest,
                      border: `1px solid ${ceryxColors.outlineVariant}`,
                      borderRadius: 8,
                      color: ceryxColors.onSurface,
                      minHeight: 32,
                      padding: "0 10px"
                    }}
                  >
                    <option value="recent">Recent connection</option>
                    <option value="name">Name</option>
                    <option value="latency">Latency</option>
                    <option value="status">Status</option>
                  </select>
                </label>
              </div>

              <div style={{ display: "grid", gap: 16 }}>
                <div style={{ display: "grid", gap: 8 }}>
                  <div
                    style={{
                      color: ceryxColors.onSurfaceVariant,
                      fontSize: 12,
                      letterSpacing: 0.3,
                      textTransform: "uppercase"
                    }}
                  >
                    Local Agent
                  </div>
                  <table style={{ borderCollapse: "collapse", width: "100%" }}>
                    <thead>
                      <tr style={{ color: ceryxColors.onSurfaceVariant, textAlign: "left" }}>
                        <th style={{ paddingBottom: 8 }}>Type</th>
                        <th style={{ paddingBottom: 8 }}>Name</th>
                        <th style={{ paddingBottom: 8 }}>Status</th>
                        <th style={{ paddingBottom: 8 }}>Latency</th>
                        <th style={{ paddingBottom: 8 }}>Recent</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ borderTop: `1px solid ${ceryxColors.outlineVariant}` }}>
                        <td style={{ padding: "10px 0" }}>Local Agent</td>
                        <td style={{ padding: "10px 0" }}>{localAgent?.deviceName ?? "Local Windows PC"}</td>
                        <td style={{ padding: "10px 0" }}>
                          <StatusChip tone={toneForStatus(localAgent?.runtimeStatus ?? "offline")}>
                            {localAgent?.runtimeStatus ?? "offline"}
                          </StatusChip>
                        </td>
                        <td style={{ padding: "10px 0" }}>{formatLatency(localAgent?.latencyMs)}</td>
                        <td style={{ padding: "10px 0" }}>{formatTimestamp(lastRefreshedAt)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  <div
                    style={{
                      color: ceryxColors.onSurfaceVariant,
                      fontSize: 12,
                      letterSpacing: 0.3,
                      textTransform: "uppercase"
                    }}
                  >
                    Remote Agents
                  </div>
                  <table style={{ borderCollapse: "collapse", width: "100%" }}>
                    <thead>
                      <tr style={{ color: ceryxColors.onSurfaceVariant, textAlign: "left" }}>
                        <th style={{ paddingBottom: 8 }}>Type</th>
                        <th style={{ paddingBottom: 8 }}>Name</th>
                        <th style={{ paddingBottom: 8 }}>Status</th>
                        <th style={{ paddingBottom: 8 }}>Latency</th>
                        <th style={{ paddingBottom: 8 }}>Recent</th>
                      </tr>
                    </thead>
                    <tbody>
                      {remoteAgents.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            style={{
                              borderTop: `1px solid ${ceryxColors.outlineVariant}`,
                              color: ceryxColors.onSurfaceVariant,
                              padding: "12px 0"
                            }}
                          >
                            No remote agents yet.
                          </td>
                        </tr>
                      ) : (
                        remoteAgents.map((device) => (
                          <tr
                            key={device.id}
                            style={{ borderTop: `1px solid ${ceryxColors.outlineVariant}` }}
                          >
                            <td style={{ padding: "10px 0" }}>Remote Agent</td>
                            <td data-testid="remote-agent-name" style={{ padding: "10px 0" }}>
                              {device.name}
                            </td>
                            <td style={{ padding: "10px 0" }}>
                              <StatusChip tone={toneForStatus(device.status ?? "trusted")}>
                                {device.status ?? "trusted"}
                              </StatusChip>
                            </td>
                            <td style={{ padding: "10px 0" }}>
                              {formatLatency(device.latencyMs)}
                            </td>
                            <td style={{ padding: "10px 0" }}>
                              {formatTimestamp(device.lastConnectedAt ?? device.createdAt)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </Panel>
          </div>
        </div>
      </div>

      <footer
        style={{
          alignItems: "center",
          backgroundColor: ceryxColors.surfaceContainerLow,
          borderTop: `1px solid ${ceryxColors.outlineVariant}`,
          color: ceryxColors.onSurfaceVariant,
          display: "flex",
          fontSize: 12,
          gap: 18,
          padding: "0 16px"
        }}
      >
        <span>Local: {localAgent?.runtimeStatus ?? "offline"}</span>
        <span>Sort: {sortKey}</span>
        <span>Trusted devices: {trustedDevices.length}</span>
        <span>Last refresh: {formatTimestamp(lastRefreshedAt)}</span>
      </footer>
    </section>
  );
}
