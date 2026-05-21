import { ceryxColors } from "@ceryx/design-tokens";
import { BrowserRouter } from "react-router-dom";
import { AppRoutes } from "./routes/AppRoutes";

export function App() {
  return (
    <main
      style={{
        backgroundColor: ceryxColors.background,
        color: ceryxColors.onSurface,
        fontFamily:
          "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        minHeight: "100vh"
      }}
    >
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </main>
  );
}
