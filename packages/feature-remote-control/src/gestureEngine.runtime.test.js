import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultCustomGestureProfile,
  defaultGestureProfiles,
  useGestureEngine
} from "../dist/gestureEngine.js";

function createCallbacks() {
  return {
    mouseMove: vi.fn(),
    leftClick: vi.fn(),
    rightClick: vi.fn(),
    pressHold: vi.fn(),
    scroll: vi.fn(),
    hotkey: vi.fn(),
    toggleToolbar: vi.fn()
  };
}

function stubSurfaceRect(surface, width = 200, height = 100) {
  Object.defineProperty(surface, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      bottom: height,
      height,
      left: 0,
      right: width,
      top: 0,
      width,
      x: 0,
      y: 0,
      toJSON() {
        return { bottom: height, height, left: 0, right: width, top: 0, width, x: 0, y: 0 };
      }
    })
  });
}

function GestureHarness({ callbacks, profile }) {
  const surfaceRef = React.useRef(null);
  const gestureEngine = useGestureEngine({
    enabled: true,
    profile,
    captureState: {
      width: 400,
      height: 200
    },
    surfaceRef,
    callbacks
  });

  return React.createElement("div", {
    "data-testid": "gesture-surface",
    ref: surfaceRef,
    onTouchEnd: gestureEngine.onTouchEnd,
    onTouchMove: gestureEngine.onTouchMove,
    onTouchStart: gestureEngine.onTouchStart
  });
}

describe("gesture engine runtime", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("maps the same tap gesture to different actions across profiles", async () => {
    const callbacks = createCallbacks();
    const customProfile = createDefaultCustomGestureProfile(defaultGestureProfiles.default);
    customProfile.bindings.singleFingerTap = { action: "right_click" };
    const view = render(
      React.createElement(GestureHarness, {
        callbacks,
        profile: defaultGestureProfiles.default
      })
    );
    const surface = screen.getByTestId("gesture-surface");
    stubSurfaceRect(surface);

    fireEvent.touchStart(surface, {
      touches: [{ clientX: 40, clientY: 30 }]
    });
    fireEvent.touchEnd(surface, {
      touches: [],
      changedTouches: [{ clientX: 40, clientY: 30 }]
    });

    await waitFor(() => expect(callbacks.leftClick).toHaveBeenCalledTimes(1));

    view.rerender(
      React.createElement(GestureHarness, {
        callbacks,
        profile: customProfile
      })
    );

    fireEvent.touchStart(surface, {
      touches: [{ clientX: 40, clientY: 30 }]
    });
    fireEvent.touchEnd(surface, {
      touches: [],
      changedTouches: [{ clientX: 40, clientY: 30 }]
    });

    await waitFor(() => expect(callbacks.rightClick).toHaveBeenCalledTimes(1));
  });

  it("applies single finger drag sensitivity to remote pointer movement", async () => {
    const callbacks = createCallbacks();
    const customProfile = createDefaultCustomGestureProfile(defaultGestureProfiles.default);
    customProfile.bindings.singleFingerDrag = {
      action: "mouse_move",
      params: {
        sensitivity: 0.5
      }
    };

    render(
      React.createElement(GestureHarness, {
        callbacks,
        profile: customProfile
      })
    );
    const surface = screen.getByTestId("gesture-surface");
    stubSurfaceRect(surface);

    fireEvent.touchStart(surface, {
      touches: [{ clientX: 50, clientY: 20 }]
    });
    fireEvent.touchMove(surface, {
      touches: [{ clientX: 90, clientY: 60 }]
    });

    await waitFor(() => expect(callbacks.mouseMove).toHaveBeenCalledTimes(1));
    expect(callbacks.mouseMove).toHaveBeenCalledWith({ x: 120, y: 60 });
  });

  it("inverts scroll direction when the profile requests it", async () => {
    const callbacks = createCallbacks();
    const customProfile = createDefaultCustomGestureProfile(defaultGestureProfiles.default);
    customProfile.bindings.doubleFingerDrag = {
      action: "scroll",
      params: {
        sensitivity: 2,
        invertScroll: true
      }
    };

    render(
      React.createElement(GestureHarness, {
        callbacks,
        profile: customProfile
      })
    );
    const surface = screen.getByTestId("gesture-surface");
    stubSurfaceRect(surface);

    fireEvent.touchStart(surface, {
      touches: [
        { clientX: 80, clientY: 40 },
        { clientX: 100, clientY: 40 }
      ]
    });
    fireEvent.touchMove(surface, {
      touches: [
        { clientX: 80, clientY: 60 },
        { clientX: 100, clientY: 60 }
      ]
    });
    fireEvent.touchEnd(surface, {
      touches: [],
      changedTouches: [
        { clientX: 80, clientY: 60 },
        { clientX: 100, clientY: 60 }
      ]
    });

    await waitFor(() => expect(callbacks.scroll).toHaveBeenCalledTimes(1));
    expect(callbacks.scroll).toHaveBeenCalledWith({ deltaX: 0, deltaY: -40 });
  });

  it("uses drag mode for zoom when requested by the profile", async () => {
    const callbacks = createCallbacks();
    const customProfile = createDefaultCustomGestureProfile(defaultGestureProfiles.default);
    customProfile.bindings.doubleFingerPinch = {
      action: "zoom",
      params: {
        sensitivity: 1.5,
        zoomMode: "drag"
      }
    };

    render(
      React.createElement(GestureHarness, {
        callbacks,
        profile: customProfile
      })
    );
    const surface = screen.getByTestId("gesture-surface");
    stubSurfaceRect(surface);

    fireEvent.touchStart(surface, {
      touches: [
        { clientX: 90, clientY: 70 },
        { clientX: 110, clientY: 70 }
      ]
    });
    fireEvent.touchMove(surface, {
      touches: [
        { clientX: 90, clientY: 42 },
        { clientX: 110, clientY: 42 }
      ]
    });
    fireEvent.touchEnd(surface, {
      touches: [],
      changedTouches: [
        { clientX: 90, clientY: 42 },
        { clientX: 110, clientY: 42 }
      ]
    });

    await waitFor(() => expect(callbacks.hotkey).toHaveBeenCalledTimes(1));
    expect(callbacks.hotkey).toHaveBeenCalledWith({ keys: ["ctrl", "plus"] });
  });
});
