import type {
  CaptureStateResponse,
  GestureActionId,
  GestureBindingId,
  GestureMapping,
  GestureProfile,
  InputHotkeyRequest,
  InputScrollRequest
} from "@ceryx/protocol";
import {
  gestureActionIds,
  normalizeGestureProfile
} from "@ceryx/protocol";
import type { RefObject, TouchEvent as ReactTouchEvent } from "react";
import { useEffect, useRef } from "react";

export {
  createDefaultCustomGestureProfile,
  defaultGestureDefinitions,
  defaultGestureProfiles,
  gestureActionIds,
  gestureActionLabel,
  gestureBindingIds,
  gestureBindingsForProfile,
  normalizeGestureProfile,
  resolveGestureProfile,
  type GestureActionId,
  type GestureBindingId,
  type GestureDefinition,
  type GestureMapping,
  type GestureProfile
} from "@ceryx/protocol";

export interface TouchPoint {
  clientX: number;
  clientY: number;
}

export interface RemotePoint {
  x: number;
  y: number;
}

export interface GestureEngineCallbacks {
  mouseMove: (point: RemotePoint) => Promise<unknown> | void;
  leftClick: (point: RemotePoint) => Promise<unknown> | void;
  rightClick: (point: RemotePoint) => Promise<unknown> | void;
  pressHold: (point: RemotePoint) => Promise<unknown> | void;
  scroll: (request: InputScrollRequest) => Promise<unknown> | void;
  hotkey: (request: InputHotkeyRequest) => Promise<unknown> | void;
  toggleToolbar: () => Promise<unknown> | void;
}

export interface GestureEngineOptions {
  callbacks: GestureEngineCallbacks;
  captureState: Pick<CaptureStateResponse, "width" | "height"> | null | undefined;
  enabled?: boolean;
  onError?: (message: string) => void;
  profile: GestureProfile;
  surfaceRef: RefObject<HTMLElement | null>;
}

export interface GestureEngineHandlers {
  onTouchEnd: (event: ReactTouchEvent<HTMLDivElement>) => void;
  onTouchMove: (event: ReactTouchEvent<HTMLDivElement>) => void;
  onTouchStart: (event: ReactTouchEvent<HTMLDivElement>) => void;
}

type TouchCollection = ArrayLike<TouchPoint> & {
  item?: (index: number) => TouchPoint | null;
};

type GestureState = {
  lastRemote: RemotePoint | null;
  longPressTriggered: boolean;
  moved: boolean;
  latestCentroid: TouchPoint;
  latestDistance: number;
  startCentroid: TouchPoint;
  startDistance: number;
  startRemote: RemotePoint | null;
  startTouches: number;
  startedAt: number;
};

export function readTouchPoints(touches: TouchCollection): TouchPoint[] {
  const points: TouchPoint[] = [];
  for (let index = 0; index < touches.length; index += 1) {
    const point =
      typeof touches.item === "function" ? touches.item(index) : (touches[index] ?? null);
    if (!point) {
      continue;
    }

    points.push({
      clientX: point.clientX,
      clientY: point.clientY
    });
  }

  return points;
}

export function centroidOf(points: TouchPoint[]): TouchPoint {
  const total = points.reduce(
    (accumulator, point) => ({
      clientX: accumulator.clientX + point.clientX,
      clientY: accumulator.clientY + point.clientY
    }),
    { clientX: 0, clientY: 0 }
  );

  return {
    clientX: total.clientX / points.length,
    clientY: total.clientY / points.length
  };
}

export function distanceBetween(a: TouchPoint, b: TouchPoint): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

export function mapTouchPointToRemote(
  point: TouchPoint,
  surface: HTMLElement | null,
  captureState: Pick<CaptureStateResponse, "width" | "height"> | null | undefined
): RemotePoint | null {
  if (!surface) {
    return null;
  }

  const rect = surface.getBoundingClientRect();
  const targetWidth = captureState?.width && captureState.width > 0 ? captureState.width : Math.round(rect.width);
  const targetHeight = captureState?.height && captureState.height > 0 ? captureState.height : Math.round(rect.height);
  const referenceWidth = rect.width > 0 ? rect.width : Math.max(1, targetWidth);
  const referenceHeight = rect.height > 0 ? rect.height : Math.max(1, targetHeight);
  const referenceLeft = rect.width > 0 ? rect.left : 0;
  const referenceTop = rect.height > 0 ? rect.top : 0;

  const localX = clamp(point.clientX - referenceLeft, 0, referenceWidth);
  const localY = clamp(point.clientY - referenceTop, 0, referenceHeight);

  return {
    x: Math.round((localX / referenceWidth) * targetWidth),
    y: Math.round((localY / referenceHeight) * targetHeight)
  };
}

export function useGestureEngine(options: GestureEngineOptions): GestureEngineHandlers {
  const profile = normalizeGestureProfile(options.profile);
  const latestOptionsRef = useRef(options);
  latestOptionsRef.current = options;
  const stateRef = useRef<GestureState | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => clearGestureTimer(longPressTimerRef), []);

  function dispatchError(message: string) {
    latestOptionsRef.current.onError?.(message);
  }

  async function dispatchMapping(
    bindingId: GestureBindingId,
    mapping: GestureMapping,
    context: {
      deltaX: number;
      deltaY: number;
      direction?: "in" | "out";
      durationMs: number;
      point: TouchPoint | null;
      remotePoint: RemotePoint | null;
      touchCount: number;
    }
  ) {
    const callbacks = latestOptionsRef.current.callbacks;
    try {
      switch (mapping.action as GestureActionId) {
        case "none":
          return;
        case "mouse_move":
          if (context.remotePoint) {
            await callbacks.mouseMove(context.remotePoint);
          }
          return;
        case "left_click":
          if (context.remotePoint) {
            await callbacks.leftClick(context.remotePoint);
          }
          return;
        case "right_click":
          if (context.remotePoint) {
            await callbacks.rightClick(context.remotePoint);
          }
          return;
        case "press_hold":
          if (context.remotePoint) {
            await callbacks.pressHold(context.remotePoint);
          }
          return;
        case "scroll": {
          const sensitivity = normalizeSensitivity(mapping.params?.sensitivity ?? 1);
          const invertScroll = mapping.params?.invertScroll ?? false;
          const signedDeltaX = Math.round(context.deltaX * sensitivity * (invertScroll ? -1 : 1));
          const signedDeltaY = Math.round(context.deltaY * sensitivity * (invertScroll ? -1 : 1));
          const normalizedDeltaX = Object.is(signedDeltaX, -0) ? 0 : signedDeltaX;
          const normalizedDeltaY = Object.is(signedDeltaY, -0) ? 0 : signedDeltaY;
          if (normalizedDeltaX !== 0 || normalizedDeltaY !== 0) {
            await callbacks.scroll({
              deltaX: normalizedDeltaX,
              deltaY: normalizedDeltaY
            });
          }
          return;
        }
        case "zoom": {
          const direction = context.direction ?? (context.deltaY >= 0 ? "in" : "out");
          const keys = direction === "in" ? ["ctrl", "plus"] : ["ctrl", "minus"];
          await callbacks.hotkey({ keys });
          return;
        }
        case "hotkey": {
          const hotkey = mapping.params?.hotkey?.trim();
          if (!hotkey) {
            return;
          }

          await callbacks.hotkey({
            keys: parseHotkeyCombo(hotkey)
          });
          return;
        }
        case "toggle_toolbar":
          await callbacks.toggleToolbar();
          return;
        default:
          dispatchError(`Unsupported gesture action: ${String(mapping.action)} (${bindingId})`);
      }
    } catch (error) {
      dispatchError(error instanceof Error ? error.message : `Gesture ${bindingId} failed.`);
    }
  }

  function startGestureTracking(points: TouchPoint[]) {
    const centroid = centroidOf(points);
    const distance = points.length >= 2 ? distanceBetween(points[0], points[1]) : 0;
    stateRef.current = {
      lastRemote: mapTouchPointToRemote(centroid, latestOptionsRef.current.surfaceRef.current, latestOptionsRef.current.captureState),
      longPressTriggered: false,
      moved: false,
      latestCentroid: centroid,
      latestDistance: distance,
      startCentroid: centroid,
      startDistance: distance,
      startRemote: mapTouchPointToRemote(centroid, latestOptionsRef.current.surfaceRef.current, latestOptionsRef.current.captureState),
      startTouches: points.length,
      startedAt: Date.now()
    };
  }

  function handleTouchStart(event: ReactTouchEvent<HTMLDivElement>) {
    if (!latestOptionsRef.current.enabled) {
      return;
    }

    const points = readTouchPoints(event.touches);
    if (points.length === 0) {
      return;
    }

    if (points.length >= 2) {
      event.preventDefault();
    } else if ((profile.bindings.singleFingerDrag.action as GestureActionId) === "mouse_move") {
      event.preventDefault();
    }

    clearGestureTimer(longPressTimerRef);
    startGestureTracking(points);

    if (points.length === 1) {
      longPressTimerRef.current = setTimeout(() => {
        const state = stateRef.current;
        if (!state || state.startTouches !== 1 || state.moved || state.longPressTriggered) {
          return;
        }

        state.longPressTriggered = true;
        const mapping = profile.bindings.longPress;
        void dispatchMapping("longPress", mapping, buildContext(state, profile, "longPress"));
      }, 550);
    }
  }

  function handleTouchMove(event: ReactTouchEvent<HTMLDivElement>) {
    if (!latestOptionsRef.current.enabled) {
      return;
    }

    const state = stateRef.current;
    if (!state) {
      return;
    }

    const points = readTouchPoints(event.touches);
    if (points.length === 0) {
      return;
    }

    if (points.length >= 2) {
      event.preventDefault();
    }

    const centroid = centroidOf(points);
    state.latestCentroid = centroid;
    if (
      Math.abs(centroid.clientX - state.startCentroid.clientX) > 10 ||
      Math.abs(centroid.clientY - state.startCentroid.clientY) > 10
    ) {
      state.moved = true;
      clearGestureTimer(longPressTimerRef);
    }

    if (points.length >= 2) {
      state.latestDistance = distanceBetween(points[0], points[1]);
    }

    if (state.startTouches === 1) {
      const mapping = profile.bindings.singleFingerDrag;
      if ((mapping.action as GestureActionId) !== "mouse_move") {
        return;
      }

      const sensitivity = normalizeSensitivity(mapping.params?.sensitivity ?? 1);
      const remotePoint = resolveRemotePoint(
        state,
        latestOptionsRef.current.captureState,
        latestOptionsRef.current.surfaceRef.current,
        sensitivity
      );
      if (!remotePoint) {
        return;
      }

      if (
        state.lastRemote &&
        state.lastRemote.x === remotePoint.x &&
        state.lastRemote.y === remotePoint.y
      ) {
        return;
      }

      state.lastRemote = remotePoint;
      void dispatchMapping(
        "singleFingerDrag",
        mapping,
        buildContext(state, profile, "singleFingerDrag", remotePoint)
      );
      return;
    }
  }

  function handleTouchEnd(event: ReactTouchEvent<HTMLDivElement>) {
    if (!latestOptionsRef.current.enabled) {
      return;
    }

    if (event.changedTouches.length >= 2) {
      event.preventDefault();
    }

    clearGestureTimer(longPressTimerRef);
    const state = stateRef.current;
    stateRef.current = null;
    if (!state) {
      return;
    }

    const duration = Date.now() - state.startedAt;

    if (state.startTouches === 3) {
      const bindingId: GestureBindingId = state.moved ? "tripleFingerDrag" : "tripleFingerTap";
      const mapping = profile.bindings[bindingId];
      void dispatchMapping(bindingId, mapping, buildContext(state, profile, bindingId));
      return;
    }

    if (state.startTouches === 1) {
      if (!state.moved && !state.longPressTriggered && duration <= 350) {
        const mapping = profile.bindings.singleFingerTap;
        void dispatchMapping("singleFingerTap", mapping, buildContext(state, profile, "singleFingerTap"));
      } else if (
        state.moved &&
        (profile.bindings.singleFingerDrag.action as GestureActionId) !== "mouse_move"
      ) {
        const mapping = profile.bindings.singleFingerDrag;
        void dispatchMapping("singleFingerDrag", mapping, buildContext(state, profile, "singleFingerDrag"));
      }
      return;
    }

    if (state.startTouches !== 2) {
      return;
    }

    const pinchMapping = profile.bindings.doubleFingerPinch;
    if ((pinchMapping.action as GestureActionId) === "zoom") {
      const sensitivity = normalizeSensitivity(pinchMapping.params?.sensitivity ?? 1);
      const threshold = Math.max(12, 24 / sensitivity);
      const pinchDelta = state.latestDistance - state.startDistance;
      const dragDeltaY = state.latestCentroid.clientY - state.startCentroid.clientY;
      const zoomMode = pinchMapping.params?.zoomMode ?? "pinch";

      if (zoomMode === "drag") {
        if (Math.abs(dragDeltaY) >= threshold) {
          const direction = dragDeltaY < 0 ? "in" : "out";
          void dispatchMapping(
            "doubleFingerPinch",
            pinchMapping,
            buildContext(state, profile, "doubleFingerPinch", undefined, direction, 0, dragDeltaY)
          );
          return;
        }
      } else if (Math.abs(pinchDelta) >= threshold) {
        const direction = pinchDelta > 0 ? "in" : "out";
        void dispatchMapping(
          "doubleFingerPinch",
          pinchMapping,
          buildContext(state, profile, "doubleFingerPinch", undefined, direction)
        );
        return;
      }
    }

    if (!state.moved && duration <= 350) {
      const mapping = profile.bindings.doubleFingerTap;
      void dispatchMapping("doubleFingerTap", mapping, buildContext(state, profile, "doubleFingerTap"));
      return;
    }

    const mapping = profile.bindings.doubleFingerDrag;
    const deltaX = state.latestCentroid.clientX - state.startCentroid.clientX;
    const deltaY = state.latestCentroid.clientY - state.startCentroid.clientY;
    void dispatchMapping(
      "doubleFingerDrag",
      mapping,
      buildContext(state, profile, "doubleFingerDrag", undefined, undefined, deltaX, deltaY)
    );
  }

  return {
    onTouchEnd: handleTouchEnd,
    onTouchMove: handleTouchMove,
    onTouchStart: handleTouchStart
  };
}

function buildContext(
  state: GestureState,
  profile: GestureProfile,
  bindingId: GestureBindingId,
  remotePoint?: RemotePoint | undefined,
  direction?: "in" | "out",
  deltaX?: number,
  deltaY?: number
) {
  const mapping = profile.bindings[bindingId];
  return {
    deltaX: deltaX ?? state.latestCentroid.clientX - state.startCentroid.clientX,
    deltaY: deltaY ?? state.latestCentroid.clientY - state.startCentroid.clientY,
    direction,
    durationMs: Date.now() - state.startedAt,
    point: state.latestCentroid,
    remotePoint: remotePoint ?? state.lastRemote ?? null,
    touchCount: state.startTouches,
    mapping
  };
}

function clearGestureTimer(timerRef: { current: ReturnType<typeof setTimeout> | null }) {
  if (timerRef.current) {
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }
}

function resolveRemotePoint(
  state: GestureState,
  captureState: Pick<CaptureStateResponse, "width" | "height"> | null | undefined,
  surface: HTMLElement | null,
  sensitivity: number
): RemotePoint | null {
  const baseRemote =
    state.startRemote ?? mapTouchPointToRemote(state.startCentroid, surface, captureState);
  if (!baseRemote) {
    return null;
  }

  const deltaX = (state.latestCentroid.clientX - state.startCentroid.clientX) * sensitivity;
  const deltaY = (state.latestCentroid.clientY - state.startCentroid.clientY) * sensitivity;
  const targetWidth = captureState?.width && captureState.width > 0 ? captureState.width : 0;
  const targetHeight = captureState?.height && captureState.height > 0 ? captureState.height : 0;

  return {
    x: clamp(Math.round(baseRemote.x + deltaX), 0, targetWidth > 0 ? targetWidth : Number.MAX_SAFE_INTEGER),
    y: clamp(Math.round(baseRemote.y + deltaY), 0, targetHeight > 0 ? targetHeight : Number.MAX_SAFE_INTEGER)
  };
}

function parseHotkeyCombo(combo: string): string[] {
  return combo
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeSensitivity(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }

  return Math.min(3, Math.max(0.1, Number(value)));
}
