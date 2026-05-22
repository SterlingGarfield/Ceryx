import { ceryxColors } from "@ceryx/design-tokens";
import type { TrustedDevice } from "@ceryx/client-sdk";
import { useConnectionStore } from "@ceryx/feature-remote-control";
import { Button, Panel, StatusChip } from "@ceryx/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  type AgentProbeResult,
  listTrustedDevices,
  probeAgent
} from "../platform/ipad/agentGateway";
import { localNetworkGuidance } from "../platform/ipad/localNetworkGuidance";

const defaultBaseUrl = "http://127.0.0.1:41527";

export function ConnectionsRoute() {
  const navigate = useNavigate();
  const currentDevice = useConnectionStore((state) => state.currentDevice);
  const setCurrentDevice = useConnectionStore((state) => state.setCurrentDevice);
  const setAgentStatus = useConnectionStore((state) => state.setAgentStatus);
  const setLatency = useConnectionStore((state) => state.setLatency);
  const [manualBaseUrl, setManualBaseUrl] = useState("");
  const [manualCandidates, setManualCandidates] = useState<string[]>([]);
  const [probes, setProbes] = useState<AgentProbeResult[]>([]);
  const [trustedDevices, setTrustedDevices] = useState<TrustedDevice[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [isVisible, setIsVisible] = useState(
    typeof document === "undefined" ? true : document.visibilityState === "visible"
  );

  const candidates = useMemo(() => {
    const seed = [defaultBaseUrl, ...manualCandidates];
    if (currentDevice?.baseUrl) {
      seed.push(currentDevice.baseUrl);
    }

    return Array.from(new Set(seed.map((item) => item.trim()).filter(Boolean)));
  }, [currentDevice?.baseUrl, manualCandidates]);

  const refreshConnections = useCallback(async () => {
    setIsRefreshing(true);
    setRefreshError("");

    try {
      const probeResults = await Promise.all(candidates.map((baseUrl) => probeAgent(baseUrl)));
      setProbes(probeResults);

      const activeBaseUrl = currentDevice?.baseUrl ?? defaultBaseUrl;
      setTrustedDevices(await listTrustedDevices(activeBaseUrl));

      const activeProbe = probeResults.find((probe) => probe.baseUrl === activeBaseUrl);
      if (activeProbe) {
        setLatency(activeProbe.latencyMs);
        setAgentStatus(
          activeProbe.runtimeStatus === "unpaired" || activeProbe.runtimeStatus === "offline"
            ? null
            : (activeProbe.runtimeStatus as "starting" | "running" | "paused" | "stopping" | "error")
        );
      }
    } catch (error) {
      setRefreshError(
        error instanceof Error ? error.message : "Failed to refresh connection state."
      );
    } finally {
      setIsRefreshing(false);
    }
  }, [candidates, currentDevice?.baseUrl, setAgentStatus, setLatency]);

  useEffect(() => {
    const handleVisibility = () => {
      setIsVisible(document.visibilityState === "visible");
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    void refreshConnections();
    const intervalId = window.setInterval(() => {
      void refreshConnections();
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isVisible, refreshConnections]);

  return (
    <section style={{ margin: "0 auto", maxWidth: 1040, padding: 24 }}>
      <header
        style={{
          alignItems: "center",
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 16
        }}
      >
        <h1 style={{ fontSize: 30, margin: 0 }}>Connections</h1>
        <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
          <StatusChip tone={isRefreshing ? "warning" : "success"}>
            {isRefreshing ? "refreshing" : "live"}
          </StatusChip>
          <Button
            size="ipad"
            variant="secondary"
            style={{ minWidth: 120 }}
            onClick={() => void refreshConnections()}
          >
            Refresh
          </Button>
        </div>
      </header>

      <p style={{ color: ceryxColors.onSurfaceVariant, margin: "0 0 20px" }}>
        Auto-refresh runs every 3 seconds while this page is visible.
      </p>

      {refreshError ? (
        <Panel size="ipad" style={{ marginBottom: 14 }}>
          <p style={{ color: ceryxColors.error, margin: 0 }}>{refreshError}</p>
        </Panel>
      ) : null}

      <div
        style={{
          display: "grid",
          gap: 14
        }}
      >
        <Panel size="ipad" style={{ display: "grid", gap: 10 }}>
          <h2 style={{ margin: 0 }}>Trusted Devices</h2>
          {trustedDevices.length === 0 ? (
            <p style={{ margin: 0 }}>No trusted devices yet. Complete pairing first.</p>
          ) : (
            trustedDevices.map((device) => (
              <div
                key={device.id}
                style={{
                  alignItems: "center",
                  display: "flex",
                  justifyContent: "space-between"
                }}
              >
                <div>
                  <strong>{device.name}</strong>
                  <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 13 }}>
                    {device.platform}
                  </div>
                </div>
                <StatusChip tone="success">trusted</StatusChip>
              </div>
            ))
          )}
        </Panel>

        <Panel size="ipad" style={{ display: "grid", gap: 10 }}>
          <h2 style={{ margin: 0 }}>Discovered Agents</h2>
          {probes.length === 0 ? (
            <p style={{ margin: 0 }}>No agents discovered yet.</p>
          ) : (
            probes.map((probe) => (
              <div
                key={probe.baseUrl}
                style={{
                  borderTop: `1px solid ${ceryxColors.outlineVariant}`,
                  display: "grid",
                  gap: 8,
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
                  <div>
                    <strong>{probe.deviceName}</strong>
                    <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 13 }}>
                      {probe.baseUrl}
                    </div>
                  </div>
                  <StatusChip tone={probe.reachable ? "success" : "error"}>
                    {probe.reachable ? "online" : "offline"}
                  </StatusChip>
                </div>
                <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 13 }}>
                  latency: {probe.latencyMs ?? "-"} ms | codex: {probe.codexStatus} | state:{" "}
                  {probe.runtimeStatus}
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <Button
                    size="ipad"
                    style={{ minWidth: 150 }}
                    disabled={!probe.reachable}
                    onClick={() => {
                      setCurrentDevice({
                        deviceId: `device:${probe.baseUrl}`,
                        deviceName: probe.deviceName,
                        platform: "windows",
                        baseUrl: probe.baseUrl
                      });
                      navigate(`/pair/${encodeURIComponent(probe.baseUrl)}`);
                    }}
                  >
                    Pair This Agent
                  </Button>
                  <Button
                    size="ipad"
                    variant="secondary"
                    style={{ minWidth: 150 }}
                    disabled={!probe.reachable}
                    onClick={() => {
                      setCurrentDevice({
                        deviceId: `device:${probe.baseUrl}`,
                        deviceName: probe.deviceName,
                        platform: "windows",
                        baseUrl: probe.baseUrl
                      });
                      navigate("/console");
                    }}
                  >
                    Open Console
                  </Button>
                </div>
              </div>
            ))
          )}
        </Panel>

        <Panel size="ipad" style={{ display: "grid", gap: 12 }}>
          <h2 style={{ margin: 0 }}>Manual IP Fallback</h2>
          <div style={{ display: "flex", gap: 10 }}>
            <input
              value={manualBaseUrl}
              placeholder="http://192.168.1.88:41527"
              onChange={(event) => setManualBaseUrl(event.target.value)}
              style={{
                border: `1px solid ${ceryxColors.outlineVariant}`,
                borderRadius: 12,
                color: ceryxColors.onSurface,
                flex: 1,
                font: "inherit",
                minHeight: 44,
                padding: "0 12px"
              }}
            />
            <Button
              size="ipad"
              style={{ minWidth: 138 }}
              onClick={() => {
                const normalized = manualBaseUrl.trim();
                if (!normalized) {
                  return;
                }

                setManualCandidates((current) =>
                  current.includes(normalized) ? current : [...current, normalized]
                );
                setManualBaseUrl("");
              }}
            >
              Add Address
            </Button>
          </div>
        </Panel>

        <Panel size="ipad" style={{ display: "grid", gap: 8 }}>
          <h2 style={{ margin: 0 }}>Local Network Permission</h2>
          <ul style={{ margin: 0, paddingInlineStart: 18 }}>
            {localNetworkGuidance.map((line) => (
              <li key={line} style={{ lineHeight: 1.4, marginBottom: 4 }}>
                {line}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </section>
  );
}
