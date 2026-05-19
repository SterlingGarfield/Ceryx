import { ceryxColors } from "@ceryx/design-tokens";
import { Button, Panel, StatusChip } from "@ceryx/ui";

const mockDevices = [
  { name: "Office Windows PC", state: "paired" },
  { name: "Home Windows PC", state: "offline" }
] as const;

export function App() {
  return (
    <main
      style={{
        backgroundColor: ceryxColors.background,
        color: ceryxColors.onSurface,
        fontFamily:
          "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        minHeight: "100vh",
        padding: 24
      }}
    >
      <h1 style={{ fontSize: 28, margin: "0 0 12px" }}>Connections</h1>
      <p style={{ color: ceryxColors.onSurfaceVariant, margin: "0 0 20px" }}>
        Pair and manage Windows agents for iPad remote control.
      </p>

      <Panel size="ipad" style={{ display: "grid", gap: 12 }}>
        {mockDevices.map((device) => (
          <div
            key={device.name}
            style={{
              alignItems: "center",
              display: "flex",
              justifyContent: "space-between"
            }}
          >
            <strong>{device.name}</strong>
            <StatusChip tone={device.state === "paired" ? "success" : "warning"}>
              {device.state}
            </StatusChip>
          </div>
        ))}

        <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
          <Button size="ipad">Pair New Device</Button>
          <Button size="ipad" variant="secondary">
            Refresh
          </Button>
        </div>
      </Panel>
    </main>
  );
}
