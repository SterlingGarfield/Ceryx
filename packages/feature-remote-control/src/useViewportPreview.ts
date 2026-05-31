import type { CaptureFrameResult } from "@ceryx/client-sdk";
import { useCallback, useEffect, useRef, useState } from "react";

export interface ViewportPreviewState {
  frameUrl: string | null;
  capturedAt: string;
  width: number;
  height: number;
  hasFrame: boolean;
  isRefreshing: boolean;
  lastError: string;
}

export interface UseViewportPreviewOptions {
  enabled: boolean;
  pollIntervalMs: number;
  sessionKey: string;
  fetchFrame: () => Promise<CaptureFrameResult>;
  resolveErrorMessage: (error: unknown) => string;
  onFrame?: (frame: CaptureFrameResult) => void;
}

const initialState: ViewportPreviewState = {
  frameUrl: null,
  capturedAt: "",
  width: 0,
  height: 0,
  hasFrame: false,
  isRefreshing: false,
  lastError: ""
};

export function useViewportPreview({
  enabled,
  pollIntervalMs,
  sessionKey,
  fetchFrame,
  resolveErrorMessage,
  onFrame
}: UseViewportPreviewOptions) {
  const objectUrlRef = useRef<string | null>(null);
  const refreshInFlightRef = useRef(false);
  const fetchFrameRef = useRef(fetchFrame);
  const onFrameRef = useRef(onFrame);
  const resolveErrorRef = useRef(resolveErrorMessage);
  const [state, setState] = useState<ViewportPreviewState>(initialState);

  useEffect(() => {
    fetchFrameRef.current = fetchFrame;
    onFrameRef.current = onFrame;
    resolveErrorRef.current = resolveErrorMessage;
  }, [fetchFrame, onFrame, resolveErrorMessage]);

  const revokeObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const replaceFrame = useCallback((frame: CaptureFrameResult) => {
    const nextUrl = URL.createObjectURL(frame.blob);
    const previousUrl = objectUrlRef.current;
    objectUrlRef.current = nextUrl;
    if (previousUrl) {
      URL.revokeObjectURL(previousUrl);
    }

    setState({
      frameUrl: nextUrl,
      capturedAt: frame.capturedAt,
      width: frame.width,
      height: frame.height,
      hasFrame: true,
      isRefreshing: false,
      lastError: ""
    });
    onFrameRef.current?.(frame);
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled || refreshInFlightRef.current) {
      return;
    }

    refreshInFlightRef.current = true;
    setState((current) => ({ ...current, isRefreshing: true }));
    try {
      const frame = await fetchFrameRef.current();
      replaceFrame(frame);
    } catch (error) {
      setState((current) => ({
        ...current,
        isRefreshing: false,
        lastError: resolveErrorRef.current(error)
      }));
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [enabled, replaceFrame]);

  useEffect(() => {
    setState(initialState);
    revokeObjectUrl();
  }, [revokeObjectUrl, sessionKey]);

  useEffect(() => {
    if (!enabled) {
      setState((current) => ({ ...current, isRefreshing: false, lastError: "" }));
      return;
    }

    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, pollIntervalMs);

    return () => window.clearInterval(timer);
  }, [enabled, pollIntervalMs, refresh]);

  useEffect(() => revokeObjectUrl, [revokeObjectUrl]);

  return {
    ...state,
    refresh
  };
}
