import { ceryxColors } from "@ceryx/design-tokens";
import { Button, Panel } from "@ceryx/ui";
import { useNavigate } from "react-router-dom";

export function LaunchRoute() {
  const navigate = useNavigate();

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
      </Panel>
    </section>
  );
}
