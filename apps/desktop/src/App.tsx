import { ceryxColors } from "@ceryx/design-tokens";
import { Button, Panel, StatusChip } from "@ceryx/ui";

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
      <h1 style={{ fontSize: 28, margin: "0 0 12px" }}>Desktop Home</h1>
      <p style={{ color: ceryxColors.onSurfaceVariant, margin: "0 0 20px" }}>
        Local agent connectivity and Codex window readiness.
      </p>

      <Panel style={{ display: "grid", gap: 12, maxWidth: 640 }}>
        <div
          style={{
            alignItems: "center",
            display: "flex",
            justifyContent: "space-between"
          }}
        >
          <span>Local Agent</span>
          <StatusChip tone="success">running</StatusChip>
        </div>
        <div
          style={{
            alignItems: "center",
            display: "flex",
            justifyContent: "space-between"
          }}
        >
          <span>Codex Window</span>
          <StatusChip tone="warning">not_found</StatusChip>
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
          <Button>Open Pairing</Button>
          <Button variant="secondary">View Logs</Button>
        </div>
      </Panel>
    </main>
  );
}
