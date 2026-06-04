import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { ViewportQualityIndicator } from "../dist/ViewportQualityIndicator.js";

describe("ViewportQualityIndicator runtime", () => {
  it("renders a high quality state", () => {
    render(
      React.createElement(ViewportQualityIndicator, {
        captureState: {
          ok: true,
          active: true,
          paused: false,
          mode: "high_quality",
          windowId: "w_001",
          width: 1280,
          height: 720,
          frameRate: 30,
          quality: "high"
        },
        frameRate: 30,
        latencyMs: 24
      })
    );

    expect(screen.getByText("High quality")).toBeInTheDocument();
    expect(screen.getByText("1280 x 720 | 30 fps")).toBeInTheDocument();
  });

  it("renders a degraded quality warning", () => {
    render(
      React.createElement(ViewportQualityIndicator, {
        captureState: {
          ok: true,
          active: true,
          paused: false,
          mode: "high_quality",
          windowId: "w_001",
          width: 960,
          height: 540,
          frameRate: 12,
          quality: "network_degraded"
        },
        frameRate: 12,
        latencyMs: 180
      })
    );

    expect(screen.getByText("Low quality")).toBeInTheDocument();
    expect(screen.getByText("960 x 540 | 12 fps")).toBeInTheDocument();
    expect(screen.getByText("Network degraded")).toBeInTheDocument();
  });
});
