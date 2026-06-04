import { ceryxColors } from "@ceryx/design-tokens";
import {
  CeryxApiError,
  normalizePreviewRefreshProfile,
  type CaptureFrameResult,
  type CaptureMode,
  type CaptureStateResponse,
  type CodexWindowSnapshot,
  type PreviewRefreshProfile
} from "@ceryx/client-sdk";
import type {
  AgentNotificationEntry,
  AgentLogEntry,
  AgentSettingsPatch,
  AgentSettingsState,
  ClientSettingsState,
  FileTransferEntry,
  LogsQuery,
  RecordingEntryResponse,
  ProjectFileEntry,
  ProjectDiffFileEntry,
  ProjectDiffFileResponse,
  ProjectTaskPromptAction,
  ProjectTaskState,
  ProjectTestRequestState
} from "@ceryx/client-sdk";
import {
  defaultShortcutDefinitions,
  createDefaultCustomGestureProfile,
  defaultGestureDefinitions,
  defaultGestureProfiles,
  gestureActionLabel,
  gestureActionOptions,
  gestureBindingsForProfile,
  normalizeGestureProfile,
  normalizeGestureBindings,
  resolveGestureProfile,
  type GestureActionId,
  type GestureBindingId,
  type GestureMapping,
  type GestureMappingParams,
  type GestureProfile,
  type ShortcutProfile
} from "@ceryx/protocol";
import {
  CodexToolbar,
  CodexWindowPipPreview,
  CodexWindowSwitcher,
  PromptComposer,
  RecordingPanel,
  RemoteViewport,
  defaultPermissionsForClient,
  hasPermission,
  resolveProtocolError,
  useGestureEngine,
  useConnectionStore,
  usePromptStore,
  useRemoteSessionStore,
  useViewportPreview,
  useWebRtcViewport,
  normalizeShortcutBindings,
  resolveShortcutProfile,
  type RecordingMode
} from "@ceryx/feature-remote-control";
import { Button, Panel, StatusChip, TextArea } from "@ceryx/ui";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import {
  clearNotifications,
  deleteAgentFile,
  getCaptureFrame,
  getCaptureState,
  getCodexWindow,
  listCodexWindows,
  downloadAgentFile,
  markNotificationRead,
  probeAgent,
  requestAgentFiles,
  requestNotifications,
  refreshCodexWindow,
  selectCodexWindow,
  requestDiffFile,
  requestDiffFiles,
  requestLogs,
  requestProjectFiles,
  requestProjectTasks,
  requestSettings,
  requestRecordings,
  sendHotkeyInput,
  sendMouseInput,
  patchAgentSettings,
  sendCaptureSignal,
  sendPrompt,
  sendScrollInput,
  startCapture,
  startRecordingCapture,
  stopCapture,
  stopRecordingCapture,
  takeScreenshot,
  downloadRecording,
  uploadAgentFile,
  uploadImageAsset
} from "../platform/ipad/agentGateway";
import {
  clipboardPayloadSignature,
  copyWindowsClipboardToLocal,
  readLocalClipboardPayload,
  sendLocalClipboardPayloadToWindows
} from "../platform/ipad/clipboardBridge";
import {
  normalizeAgentBaseUrl,
  resolveDefaultAgentBaseUrl
} from "../platform/ipad/defaultAgentBaseUrl";

const fallbackBaseUrl = resolveDefaultAgentBaseUrl();
const idleCaptureState = {
  ok: true as const,
  active: false,
  paused: false,
  mode: "balanced" as const,
  windowId: null,
  width: 0,
  height: 0
};

const defaultProjectId = "workspace-default";
const defaultLogsPageSize = 80;
const ipadLogRowHeight = 64;
const ipadClientSettingsStorageKey = "ceryx.ipad.client-settings.v1";
const defaultPreviewRefreshProfile: PreviewRefreshProfile = "balanced";
const defaultViewportTransport = "webrtc";
const balancedPreviewPollMs = 1000;
const highFrequencyPreviewPollMs = 400;

const ipadSettingsGroups = [
  {
    group: "Workspace",
    sections: [
      { id: "general", label: "General" },
      { id: "gestures", label: "Gestures" },
      { id: "shortcuts", label: "Shortcuts" },
      { id: "about", label: "About" }
    ]
  },
  {
    group: "Agent",
    sections: [
      { id: "agent", label: "Agent" },
      { id: "connection", label: "Connection" },
      { id: "permissions", label: "Permissions" },
      { id: "capture", label: "Capture" },
      { id: "logs", label: "Logs" }
    ]
  }
] as const;

type IpadSettingsSectionId = (typeof ipadSettingsGroups)[number]["sections"][number]["id"];

export function ConsoleRoute() {
  const navigate = useNavigate();
  const currentDevice = useConnectionStore((state) => state.currentDevice);
  const setCurrentDevice = useConnectionStore((state) => state.setCurrentDevice);
  const promptDraft = usePromptStore((state) => state.draft);
  const templates = usePromptStore((state) => state.templates);
  const history = usePromptStore((state) => state.history);
  const isSending = usePromptStore((state) => state.isSending);
  const promptError = usePromptStore((state) => state.lastError);
  const setDraft = usePromptStore((state) => state.setDraft);
  const applyTemplate = usePromptStore((state) => state.applyTemplate);
  const beginSend = usePromptStore((state) => state.beginSend);
  const markSendSuccess = usePromptStore((state) => state.markSendSuccess);
  const markSendFailure = usePromptStore((state) => state.markSendFailure);
  const clearHistory = usePromptStore((state) => state.clearHistory);
  const remoteSession = useRemoteSessionStore();

  const gestureSurfaceRef = useRef<HTMLDivElement | null>(null);
  const recordingPreviewUrlRef = useRef<string | null>(null);

  const [codexTitle, setCodexTitle] = useState("Codex window not loaded");
  const [codexStatus, setCodexStatus] = useState("unknown");
  const [viewportMessage, setViewportMessage] = useState("Refreshing iPad control session...");
  const [recordingActive, setRecordingActive] = useState(false);
  const [recordingAudioActive, setRecordingAudioActive] = useState(false);
  const [recordingMode, setRecordingMode] = useState<RecordingMode>("screen");
  const [recordings, setRecordings] = useState<RecordingEntryResponse[]>([]);
  const [recordingsLoading, setRecordingsLoading] = useState(false);
  const [recordingsError, setRecordingsError] = useState("");
  const [selectedRecordingFileName, setSelectedRecordingFileName] = useState<string | null>(null);
  const [selectedRecordingUrl, setSelectedRecordingUrl] = useState<string | null>(null);
  const [toolbarBusy, setToolbarBusy] = useState(false);
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const [feedback, setFeedback] = useState("");
  const [tokenState, setTokenState] = useState<"missing" | "valid" | "invalid" | "expired">("missing");
  const [isPortrait, setIsPortrait] = useState(() =>
    typeof window !== "undefined" ? window.innerHeight > window.innerWidth : false
  );
  const [sideDrawerOpen, setSideDrawerOpen] = useState(false);
  const [voiceSheetOpen, setVoiceSheetOpen] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState("");
  const [imageSheetOpen, setImageSheetOpen] = useState(false);
  const [settingsSheetOpen, setSettingsSheetOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [diffWorkspaceOpen, setDiffWorkspaceOpen] = useState(false);
  const [diffProjectId, setDiffProjectId] = useState(defaultProjectId);
  const [diffFiles, setDiffFiles] = useState<ProjectDiffFileEntry[]>([]);
  const [selectedDiffPath, setSelectedDiffPath] = useState<string | null>(null);
  const [selectedDiff, setSelectedDiff] = useState<ProjectDiffFileResponse | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffFileLoading, setDiffFileLoading] = useState(false);
  const [diffError, setDiffError] = useState("");
  const [logsWorkspaceOpen, setLogsWorkspaceOpen] = useState(false);
  const [logs, setLogs] = useState<AgentLogEntry[]>([]);
  const [logsPage, setLogsPage] = useState(1);
  const [logsPageSize, setLogsPageSize] = useState(defaultLogsPageSize);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsHasMore, setLogsHasMore] = useState(false);
  const [logsSeverity, setLogsSeverity] = useState("all");
  const [logsActionFilter, setLogsActionFilter] = useState("");
  const [logsSessionFilter, setLogsSessionFilter] = useState("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsExporting, setLogsExporting] = useState(false);
  const [logsError, setLogsError] = useState("");
  const [settingsSection, setSettingsSection] = useState<IpadSettingsSectionId>("general");
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [settingsNotice, setSettingsNotice] = useState("");
  const [settingsNeedsConfirm, setSettingsNeedsConfirm] = useState(false);
  const [settingsHighRiskKeys, setSettingsHighRiskKeys] = useState<string[]>([]);
  const [settingsUpdatedAt, setSettingsUpdatedAt] = useState("");
  const [agentSettingsSource, setAgentSettingsSource] = useState<AgentSettingsState | null>(null);
  const [agentSettingsDraft, setAgentSettingsDraft] = useState<AgentSettingsState | null>(null);
  const [clientSettingsSource, setClientSettingsSource] = useState<ClientSettingsState | null>(null);
  const [clientSettingsDraft, setClientSettingsDraft] = useState<ClientSettingsState | null>(null);
  const [codexWindows, setCodexWindows] = useState<CodexWindowSnapshot[]>([]);
  const [codexWindowsLoading, setCodexWindowsLoading] = useState(false);
  const [codexWindowsError, setCodexWindowsError] = useState("");
  const [windowPreviewUrls, setWindowPreviewUrls] = useState<Record<string, string>>({});
  const [pipDismissedWindowIds, setPipDismissedWindowIds] = useState<string[]>([]);
  const [filesWorkspaceOpen, setFilesWorkspaceOpen] = useState(false);
  const [filesQuery, setFilesQuery] = useState("");
  const [projectFiles, setProjectFiles] = useState<ProjectFileEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState("");
  const [filesPermissionDenied, setFilesPermissionDenied] = useState(false);
  const [transferFile, setTransferFile] = useState<File | null>(null);
  const [transferTargetPath, setTransferTargetPath] = useState("uploads");
  const [transferUploading, setTransferUploading] = useState(false);
  const [agentFiles, setAgentFiles] = useState<FileTransferEntry[]>([]);
  const [agentFilesLoading, setAgentFilesLoading] = useState(false);
  const [agentFilesError, setAgentFilesError] = useState("");
  const [agentFilesPermissionDenied, setAgentFilesPermissionDenied] = useState(false);
  const [tasksWorkspaceOpen, setTasksWorkspaceOpen] = useState(false);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState("");
  const [tasksPermissionDenied, setTasksPermissionDenied] = useState(false);
  const [taskState, setTaskState] = useState<ProjectTaskState | null>(null);
  const [taskPromptActions, setTaskPromptActions] = useState<ProjectTaskPromptAction[]>([]);
  const [taskTestRequest, setTaskTestRequest] = useState<ProjectTestRequestState | null>(null);
  const [notificationsWorkspaceOpen, setNotificationsWorkspaceOpen] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState("");
  const [notificationsPermissionDenied, setNotificationsPermissionDenied] = useState(false);
  const [notifications, setNotifications] = useState<AgentNotificationEntry[]>([]);
  const [notificationsUnread, setNotificationsUnread] = useState(0);
  const [forcePollingFallback, setForcePollingFallback] = useState(false);
  const webRtcVideoRef = useRef<HTMLVideoElement | null>(null);
  const clipboardAutoSyncSignatureRef = useRef<string | null>(null);
  const clipboardAutoSyncErrorRef = useRef("");

  const activeBaseUrl = normalizeAgentBaseUrl(currentDevice?.baseUrl) ?? fallbackBaseUrl;
  const deviceName = currentDevice?.deviceName ?? "Windows Agent";
  const sessionDeviceId = currentDevice?.deviceId ?? `device:${activeBaseUrl}`;

  useEffect(() => {
    if (currentDevice) {
      return;
    }

    setCurrentDevice({
      deviceId: sessionDeviceId,
      deviceName: "Windows Agent",
      platform: "windows",
      baseUrl: activeBaseUrl
    });
  }, [activeBaseUrl, currentDevice, sessionDeviceId, setCurrentDevice]);

  useEffect(() => {
    function handleResize() {
      setIsPortrait(window.innerHeight > window.innerWidth);
    }

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!isPortrait) {
      setSideDrawerOpen(false);
    }
  }, [isPortrait]);

  useEffect(() => {
    return () => {
      if (recordingPreviewUrlRef.current) {
        URL.revokeObjectURL(recordingPreviewUrlRef.current);
        recordingPreviewUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      Object.values(windowPreviewUrls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [windowPreviewUrls]);

  function resolveErrorMessage(error: unknown, fallback: string): string {
    return resolveProtocolError(error, fallback).message;
  }

  function applyConsoleError(error: unknown, fallback: string): string {
    const resolved = resolveProtocolError(error, fallback);

    switch (resolved.state) {
      case "agent_offline":
        setCodexStatus("not_found");
        setCodexTitle("Agent offline");
        break;
      case "not_paired":
      case "token_invalid":
        setCodexStatus("unpaired");
        setCodexTitle("Pairing required");
        break;
      case "codex_not_found":
        setCodexStatus("not_found");
        setCodexTitle("Codex window not found");
        break;
      case "codex_minimized":
        setCodexStatus("minimized");
        setCodexTitle("Codex window minimized");
        break;
      case "capture_failed":
        setCodexStatus("capture_failed");
        break;
      default:
        break;
    }

    return resolved.message;
  }

  function resolveActiveWindowId(windowList: CodexWindowSnapshot[] = codexWindows): string | null {
    const windows = Array.isArray(windowList) ? windowList : [];
    const focusedWindow = windows.find((window) => window.status === "focused");
    const windowId = remoteSession.captureState.windowId?.trim() || focusedWindow?.windowId?.trim() || windows[0]?.windowId?.trim();
    return windowId && windowId.length > 0 ? windowId : null;
  }

  async function captureWindowPreviews(windowList: CodexWindowSnapshot[]): Promise<Record<string, string>> {
    const previewEntries = await Promise.allSettled(
      windowList
        .map((window) => window.windowId?.trim())
        .filter((windowId): windowId is string => Boolean(windowId))
        .map(async (windowId) => {
          const frame = await getCaptureFrame(activeBaseUrl, windowId);
          return [windowId, URL.createObjectURL(frame.blob)] as const;
        })
    );

    const nextPreviewUrls: Record<string, string> = {};
    for (const entry of previewEntries) {
      if (entry.status === "fulfilled") {
        const [windowId, previewUrl] = entry.value;
        nextPreviewUrls[windowId] = previewUrl;
      }
    }

    return nextPreviewUrls;
  }

  async function refreshConsole() {
    setCodexWindowsLoading(true);
    setCodexWindowsError("");

    const probe = await probeAgent(activeBaseUrl);
    const canControl = probe.reachable && probe.runtimeStatus !== "unpaired";
    const permissions = canControl ? defaultPermissionsForClient("ipad") : [];
    setTokenState(probe.tokenState);

    remoteSession.connectSession({
      sessionId: `ipad-live-console:${activeBaseUrl}`,
      deviceId: sessionDeviceId,
      status: canControl ? "connected" : "error",
      permissions
    });
    remoteSession.setLatency(probe.latencyMs);

    if (!canControl) {
      remoteSession.setCaptureState(idleCaptureState);
      remoteSession.setError(probe.message);
      setCodexStatus(probe.reachable ? "unpaired" : probe.codexStatus);
      setCodexTitle(probe.reachable ? "Pairing required" : "Agent offline");
      setViewportMessage(probe.message);
      setCodexWindows([]);
      setWindowPreviewUrls({});
      setPipDismissedWindowIds([]);
      setCodexWindowsLoading(false);
      return;
    }

    try {
      const [windowSnapshot, captureState, windowList] = await Promise.all([
        getCodexWindow(activeBaseUrl),
        getCaptureState(activeBaseUrl),
        listCodexWindows(activeBaseUrl)
      ]);
      setCodexTitle(windowSnapshot.title ?? "Codex");
      setCodexStatus(windowSnapshot.status);
      remoteSession.setCaptureState(captureState);
      remoteSession.setPermissions(permissions);
      remoteSession.markActive();
      setCodexWindows(windowList.windows);
      setPipDismissedWindowIds((current) =>
        current.filter((windowId) => windowList.windows.some((window) => window.windowId === windowId))
      );
      if (captureState.active) {
        setWindowPreviewUrls(await captureWindowPreviews(windowList.windows));
      } else {
        setWindowPreviewUrls({});
      }
      setCodexWindowsError("");
      setViewportMessage(
        captureState.active
          ? "Waiting for real frame..."
          : "Capture inactive. Start capture to load a real frame."
      );
    } catch (error) {
      remoteSession.setPermissions([]);
      remoteSession.setCaptureState(idleCaptureState);
      const message = applyConsoleError(error, "Unable to fetch Codex window or capture state.");
      remoteSession.setError(message);
      setCodexWindows([]);
      setWindowPreviewUrls({});
      setPipDismissedWindowIds([]);
      setCodexWindowsError(message);
      setViewportMessage(message);
    } finally {
      setCodexWindowsLoading(false);
    }
  }

  useEffect(() => {
    void refreshConsole();
  }, [activeBaseUrl]);

  const connected = useMemo(
    () => remoteSession.status !== "idle" && remoteSession.status !== "error",
    [remoteSession.status]
  );

  useEffect(() => {
    if (!connected) {
      setRecordingActive(false);
      setRecordingAudioActive(false);
      setRecordingsLoading(false);
      setRecordings([]);
      setRecordingsError("");
      clearRecordingPreview();
      return;
    }

    void loadRecordings();
  }, [activeBaseUrl, connected]);

  const activeGestureProfileId =
    clientSettingsDraft?.activeGestureProfile ??
    clientSettingsSource?.activeGestureProfile ??
    "default";
  const gestureProfile = resolveGestureProfile(
    activeGestureProfileId,
    clientSettingsDraft?.customGestures ?? clientSettingsSource?.customGestures ?? createDefaultCustomGestureProfile()
  );
  const gestureBindings = gestureBindingsForProfile(gestureProfile);
  const previewRefreshProfile = normalizePreviewRefreshProfile(
    clientSettingsDraft?.previewRefreshProfile ??
      clientSettingsSource?.previewRefreshProfile ??
      defaultPreviewRefreshProfile
  );
  const previewPollIntervalMs = previewRefreshProfile === "high_frequency"
    ? highFrequencyPreviewPollMs
    : balancedPreviewPollMs;
  const previewCaptureMode: CaptureMode = previewRefreshProfile === "high_frequency"
    ? "low_latency"
    : "balanced";
  const viewportTransport =
    clientSettingsDraft?.viewportTransport === "polling" ||
    clientSettingsSource?.viewportTransport === "polling"
      ? "polling"
      : defaultViewportTransport;
  const clipboardAutoSyncEnabled = connected && Boolean(
    clientSettingsDraft?.clipboardAutoSync ?? clientSettingsSource?.clipboardAutoSync ?? false
  );
  const webRtcViewport = useWebRtcViewport({
    enabled: connected && remoteSession.captureState.active && viewportTransport === "webrtc" && !forcePollingFallback,
    sessionKey: `${sessionDeviceId}:webrtc:${activeBaseUrl}`,
    transport: viewportTransport,
    sendSignal: (request) => sendCaptureSignal(activeBaseUrl, request),
    onFallback: (message) => {
      setForcePollingFallback(true);
      setViewportMessage(`WebRTC degraded: ${message}`);
    }
  });
  const pollingPreviewEnabled =
    connected &&
    remoteSession.captureState.active &&
    (viewportTransport === "polling" || forcePollingFallback || webRtcViewport.phase === "degraded");
  const viewportPreview = useViewportPreview({
    enabled: pollingPreviewEnabled,
    pollIntervalMs: previewPollIntervalMs,
    sessionKey: `${sessionDeviceId}:${activeBaseUrl}`,
    fetchFrame: () => getCaptureFrame(activeBaseUrl),
    resolveErrorMessage: (error) =>
      resolveProtocolError(error, "Failed to load preview frame.").message,
    onFrame: (frame: CaptureFrameResult) => {
      remoteSession.setCaptureState({
        ...remoteSession.captureState,
        width: frame.width || remoteSession.captureState.width,
        height: frame.height || remoteSession.captureState.height
      });
    }
  });
  const viewportOverlayMessage = resolveViewportOverlayMessage({
    captureActive: remoteSession.captureState.active,
    hasFrame: viewportPreview.hasFrame,
    previewError: viewportPreview.lastError,
    statusMessage: viewportMessage
  });
  const activeWindowId = resolveActiveWindowId();
  const inputLockPreference =
    clientSettingsDraft?.lockLocalInputWhenCapturing ??
    clientSettingsSource?.lockLocalInputWhenCapturing ??
    true;
  const inputLockActive =
    connected && remoteSession.captureState.active && Boolean(activeWindowId) && inputLockPreference;
  function updateInputLockPreference(nextEnabled: boolean) {
    setClientSettingsDraft((current) =>
      current ? { ...current, lockLocalInputWhenCapturing: nextEnabled } : current
    );
  }
  const previewWindows = Array.isArray(codexWindows) ? codexWindows : [];
  const pipWindow = previewWindows.find((window) => {
    const windowId = window.windowId?.trim();
    if (!windowId) {
      return false;
    }

    return windowId !== activeWindowId && !pipDismissedWindowIds.includes(windowId);
  });
  const pipWindowId = pipWindow?.windowId?.trim() ?? null;
  const pipPreviewUrl = pipWindowId ? windowPreviewUrls[pipWindowId] : null;

  useEffect(() => {
    if (!remoteSession.captureState.active) {
      setForcePollingFallback(false);
    }
  }, [remoteSession.captureState.active]);

  useEffect(() => {
    if (viewportTransport === "polling") {
      setForcePollingFallback(false);
    }
  }, [viewportTransport]);

  useEffect(() => {
    if (!clipboardAutoSyncEnabled) {
      clipboardAutoSyncSignatureRef.current = null;
      clipboardAutoSyncErrorRef.current = "";
      return;
    }

    clipboardAutoSyncSignatureRef.current = null;
    clipboardAutoSyncErrorRef.current = "";

    let cancelled = false;

    async function pollClipboard() {
      let currentSignature: string | null = null;
      try {
        const payload = await readLocalClipboardPayload();
        if (cancelled || !payload) {
          return;
        }

        currentSignature = clipboardPayloadSignature(payload);
        if (currentSignature === clipboardAutoSyncSignatureRef.current) {
          return;
        }

        await sendLocalClipboardPayloadToWindows(activeBaseUrl, payload);
        if (cancelled) {
          return;
        }

        clipboardAutoSyncSignatureRef.current = currentSignature;
        clipboardAutoSyncErrorRef.current = "";
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (currentSignature) {
          clipboardAutoSyncSignatureRef.current = currentSignature;
        }

        const message = resolveErrorMessage(error, "Failed to auto-sync clipboard.");
        if (message !== clipboardAutoSyncErrorRef.current) {
          clipboardAutoSyncErrorRef.current = message;
          setFeedback(`Clipboard auto-sync paused: ${message}`);
        }
      }
    }

    void pollClipboard();
    const intervalId = window.setInterval(() => {
      void pollClipboard();
    }, 1200);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeBaseUrl, clipboardAutoSyncEnabled]);

  useEffect(() => {
    const video = webRtcVideoRef.current;
    if (!video) {
      return;
    }

    video.srcObject = webRtcViewport.stream;
    if (webRtcViewport.stream) {
      void video.play().catch(() => undefined);
    }

    return () => {
      video.srcObject = null;
    };
  }, [webRtcViewport.stream]);

  const canControlInput = connected && hasPermission(remoteSession.permissions, "control_input");
  const canUploadImage = connected && hasPermission(remoteSession.permissions, "upload_image");
  const canReadDiff = connected && hasPermission(remoteSession.permissions, "read_diff");
  const canScreenshot = connected && hasPermission(remoteSession.permissions, "screenshot");
  const canRecord = connected && hasPermission(remoteSession.permissions, "recording");
  const canCopyOutput = connected && hasPermission(remoteSession.permissions, "copy_output");
  const canManageAgent = connected && hasPermission(remoteSession.permissions, "manage_agent");
  const settingsReady = agentSettingsDraft !== null && clientSettingsDraft !== null;
  const settingsAgentDirty = agentSettingsDraft !== null
    ? !equalAgentSettings(agentSettingsSource ?? agentSettingsDraft, agentSettingsDraft)
    : false;
  const settingsClientDirty = clientSettingsDraft !== null
    ? !equalClientSettings(clientSettingsSource ?? clientSettingsDraft, clientSettingsDraft)
    : false;
  const settingsDirty = settingsAgentDirty || settingsClientDirty;

  async function runToolbarAction(action: () => Promise<unknown>, successMessage?: string) {
    setToolbarBusy(true);
    try {
      const result = await action();
      setFeedback(
        successMessage ??
          (typeof result === "object" && result && "message" in result
            ? String((result as { message?: string }).message ?? "Action completed.")
            : "Action completed.")
      );
      await refreshConsole();
    } catch (error) {
      setFeedback(applyConsoleError(error, "Action failed."));
    } finally {
      setToolbarBusy(false);
    }
  }

  async function selectWindow(windowId: string) {
    await runToolbarAction(async () => {
      const snapshot = await selectCodexWindow(activeBaseUrl, windowId);
      setCodexTitle(snapshot.title ?? "Codex");
      setCodexStatus(snapshot.status);

      if (remoteSession.captureState.active) {
        const captureState = await startCapture(activeBaseUrl, previewCaptureMode, windowId);
        remoteSession.setCaptureState(captureState);
        setViewportMessage("Waiting for real frame...");
      } else {
        setViewportMessage("Window selected. Start capture to load a live frame.");
      }

      return { message: `Switched to ${snapshot.title ?? windowId}.` };
    });
  }

  async function runGestureAction(action: () => Promise<unknown>, successMessage: string) {
    if (!canControlInput) {
      setFeedback("Input control permission denied for this device.");
      return;
    }

    await runToolbarAction(action, successMessage);
  }

  function updateGestureProfile(profileId: string) {
    const nextProfileId = normalizeGestureProfileId(profileId);
    setClientSettingsDraft((current) =>
      current
        ? {
            ...current,
            activeGestureProfile: nextProfileId,
            customGestures:
              nextProfileId === "custom"
                ? current.customGestures
                  ? normalizeGestureProfile(current.customGestures)
                  : createDefaultCustomGestureProfile(
                      resolveGestureProfile(
                        current.activeGestureProfile ?? activeGestureProfileId,
                        createDefaultCustomGestureProfile(defaultGestureProfiles.default)
                      )
                    )
                : current.customGestures ?? createDefaultCustomGestureProfile(defaultGestureProfiles.default)
          }
        : current
    );
  }

  function resetGestureProfile() {
    setClientSettingsDraft((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        activeGestureProfile: "default",
        customGestures: createDefaultCustomGestureProfile(defaultGestureProfiles.default)
      };
    });
  }

  function updateGestureBinding(bindingId: GestureBindingId, mapping: GestureMapping) {
    setClientSettingsDraft((current) => {
      if (!current) {
        return current;
      }

      const resolvedProfile = resolveGestureProfile(
        current.activeGestureProfile ?? activeGestureProfileId,
        current.customGestures ?? createDefaultCustomGestureProfile(defaultGestureProfiles.default)
      );
      const nextBindings = normalizeGestureBindings(
        {
          ...resolvedProfile.bindings,
          [bindingId]: mapping
        } as Partial<Record<GestureBindingId, GestureMapping>>,
        resolvedProfile.bindings
      );

      return {
        ...current,
        activeGestureProfile: "custom",
        customGestures: {
          id: "custom",
          name: "Custom",
          bindings: nextBindings
        }
      };
    });
  }

  async function sendGestureMouseMove(point: { x: number; y: number }) {
    if (!canControlInput) {
      return;
    }

    try {
      await sendMouseInput(activeBaseUrl, {
        x: point.x,
        y: point.y,
        button: "left",
        action: "move"
      });
    } catch (error) {
      setFeedback(resolveErrorMessage(error, "Gesture mouse move failed."));
    }
  }

  const gestureEngine = useGestureEngine({
    enabled: canControlInput,
    profile: gestureProfile,
    captureState: remoteSession.captureState,
    surfaceRef: gestureSurfaceRef,
    callbacks: {
      mouseMove: async (point) => {
        await sendGestureMouseMove(point);
      },
      leftClick: async (point) =>
        runGestureAction(
          () =>
            sendMouseInput(activeBaseUrl, {
              x: point.x,
              y: point.y,
              button: "left",
              action: "click"
            }),
          "Single tap mapped to left click."
        ),
      rightClick: async (point) =>
        runGestureAction(
          () =>
            sendMouseInput(activeBaseUrl, {
              x: point.x,
              y: point.y,
              button: "right",
              action: "click"
            }),
          "Two-finger tap mapped to right click."
        ),
      pressHold: async (point) =>
        runGestureAction(async () => {
          await sendMouseInput(activeBaseUrl, {
            x: point.x,
            y: point.y,
            button: "left",
            action: "down"
          });
          await waitMs(320);
          return sendMouseInput(activeBaseUrl, {
            x: point.x,
            y: point.y,
            button: "left",
            action: "up"
          });
        }, "Long press mapped to press-and-hold."),
      scroll: async (request) =>
        runGestureAction(
          () => sendScrollInput(activeBaseUrl, request),
          "Two-finger scroll mapped to input scroll."
        ),
      hotkey: async (request) =>
        runGestureAction(
          () => sendHotkeyInput(activeBaseUrl, request),
          request.keys.includes("plus")
            ? "Pinch mapped to zoom in."
            : request.keys.includes("minus")
              ? "Pinch mapped to zoom out."
              : `Hotkey sent: ${request.keys.join("+")}.`
        ),
      toggleToolbar: async () => {
        setToolbarVisible((current) => {
          const next = !current;
          setFeedback(next ? "Toolbar shown via three-finger tap." : "Toolbar hidden via three-finger tap.");
          return next;
        });
      }
    }
  });

  async function handleSendPrompt(submit: boolean) {
    if (inputLockActive) {
      setFeedback("Local input is locked while capturing.");
      return;
    }

    let historyId = "";

    try {
      historyId = beginSend(submit);
      const response = await sendPrompt(activeBaseUrl, {
        prompt: promptDraft.trim(),
        submit
      });
      if (!response.ok) {
        throw new Error("Prompt send was rejected.");
      }
      markSendSuccess(historyId);
      setFeedback(submit ? "Prompt sent to Codex." : "Prompt queued locally.");
    } catch (error) {
      if (historyId) {
        markSendFailure(
          historyId,
          resolveErrorMessage(error, "Failed to send prompt.")
        );
      }
      setFeedback(resolveErrorMessage(error, "Failed to send prompt."));
    }
  }

  async function handleRecord() {
    await runToolbarAction(async () => {
      if (recordingActive) {
        const response = await stopRecordingCapture(activeBaseUrl);
        setRecordingActive(false);
        setRecordingAudioActive(false);
        await loadRecordings(response.fileName);
        return response;
      }

      const confirmed = typeof window === "undefined"
        ? true
        : window.confirm(
            recordingMode === "screen-audio"
              ? "Start screen recording with system audio for current remote session?"
              : "Start screen recording for current remote session?"
          );
      if (!confirmed) {
        throw new Error("Recording start canceled.");
      }

      const response = await startRecordingCapture(activeBaseUrl, {
        confirmHighRisk: true,
        includeAudio: recordingMode === "screen-audio",
        audioSource: recordingMode === "screen-audio" ? "system" : undefined
      });
      setRecordingActive(true);
      setRecordingAudioActive(response.audioEnabled);
      return response;
    });
  }

  async function handleStop() {
    await runToolbarAction(async () => {
      if (recordingActive) {
        const response = await stopRecordingCapture(activeBaseUrl);
        setRecordingActive(false);
        setRecordingAudioActive(false);
        await loadRecordings(response.fileName);
        return response;
      }

      return stopCapture(activeBaseUrl);
    }, "Stopped active session control.");
  }

  async function loadRecordings(preferredFileName?: string | null) {
    setRecordingsLoading(true);
    setRecordingsError("");

    try {
      const response = await requestRecordings(activeBaseUrl, 100);
      setRecordings(response.items);

      const candidate =
        preferredFileName ??
        selectedRecordingFileName ??
        response.items[0]?.fileName ??
        null;
      if (!candidate) {
        clearRecordingPreview();
        return;
      }

      const nextSelection = response.items.some((item) => item.fileName === candidate)
        ? candidate
        : response.items[0]?.fileName ?? null;
      if (!nextSelection) {
        clearRecordingPreview();
        return;
      }

      await previewRecording(nextSelection);
    } catch (error) {
      setRecordingsError(resolveErrorMessage(error, "Failed to load recordings."));
    } finally {
      setRecordingsLoading(false);
    }
  }

  async function previewRecording(fileName: string) {
    setRecordingsError("");

    try {
      const blob = await downloadRecording(activeBaseUrl, fileName);
      const previewUrl = URL.createObjectURL(blob);
      if (recordingPreviewUrlRef.current) {
        URL.revokeObjectURL(recordingPreviewUrlRef.current);
      }
      recordingPreviewUrlRef.current = previewUrl;
      setSelectedRecordingFileName(fileName);
      setSelectedRecordingUrl(previewUrl);
    } catch (error) {
      setRecordingsError(resolveErrorMessage(error, "Failed to load recording preview."));
    }
  }

  function clearRecordingPreview() {
    if (recordingPreviewUrlRef.current) {
      URL.revokeObjectURL(recordingPreviewUrlRef.current);
      recordingPreviewUrlRef.current = null;
    }
    setSelectedRecordingFileName(null);
    setSelectedRecordingUrl(null);
  }

  async function downloadRecordingFile(fileName: string) {
    try {
      const blob = await downloadRecording(activeBaseUrl, fileName);
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = fileName;
      anchor.rel = "noreferrer";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setFeedback(`Downloaded recording ${fileName}.`);
    } catch (error) {
      setRecordingsError(resolveErrorMessage(error, "Failed to download recording."));
    }
  }

  function appendVoiceDraftToPrompt() {
    if (inputLockActive) {
      setFeedback("Local input is locked while capturing.");
      return;
    }

    const trimmed = voiceDraft.trim();
    if (!trimmed) {
      setFeedback("Voice draft is empty.");
      return;
    }

    setDraft(promptDraft.trim() ? `${promptDraft}\n${trimmed}` : trimmed);
    setVoiceSheetOpen(false);
    setVoiceDraft("");
    setFeedback("Voice input inserted into prompt draft.");
  }

  async function uploadSelectedImage() {
    if (inputLockActive) {
      setFeedback("Local input is locked while capturing.");
      return;
    }

    if (!selectedImage) {
      setFeedback("Select an image file before upload.");
      return;
    }

    if (!canUploadImage) {
      setFeedback("Upload image permission denied for this device.");
      return;
    }

    setUploadingImage(true);
    try {
      const uploaded = await uploadImageAsset(activeBaseUrl, selectedImage);
      const marker = `[image:${uploaded.fileName}]`;
      setDraft(promptDraft.trim() ? `${promptDraft}\n${marker}` : marker);
      setFeedback(`Image uploaded: ${uploaded.fileName}.`);
      setImageSheetOpen(false);
      setSelectedImage(null);
      await refreshConsole();
    } catch (error) {
      setFeedback(resolveErrorMessage(error, "Image upload failed."));
    } finally {
      setUploadingImage(false);
    }
  }

  async function loadDiffFiles(projectId = diffProjectId) {
    setDiffLoading(true);
    setDiffError("");
    try {
      const response = await requestDiffFiles(activeBaseUrl, projectId);
      setDiffProjectId(response.projectId);
      setDiffFiles(response.files);

      if (response.files.length === 0) {
        setSelectedDiffPath(null);
        setSelectedDiff(null);
        return;
      }

      const preferredPath = selectedDiffPath && response.files.some((item) => item.path === selectedDiffPath)
        ? selectedDiffPath
        : response.files[0]?.path ?? null;

      if (!preferredPath) {
        return;
      }

      setSelectedDiffPath(preferredPath);
      await loadDiffFile(response.projectId, preferredPath);
    } catch (error) {
      setDiffError(resolveErrorMessage(error, "Failed to load changed files."));
    } finally {
      setDiffLoading(false);
    }
  }

  async function loadDiffFile(projectId: string, path: string) {
    setDiffFileLoading(true);
    setDiffError("");
    try {
      const response = await requestDiffFile(activeBaseUrl, projectId, path);
      setSelectedDiffPath(response.path);
      setSelectedDiff(response);
      if (response.truncated) {
        setFeedback(`Diff too large. Showing first ${response.lineLimit} lines for ${response.path}.`);
      }
    } catch (error) {
      setDiffError(resolveErrorMessage(error, "Failed to load file diff."));
    } finally {
      setDiffFileLoading(false);
    }
  }

  async function openDiffWorkspace() {
    setDiffWorkspaceOpen(true);
    await loadDiffFiles();
  }

  function toLogsQuery(pageValue: number, pageSizeValue: number): LogsQuery {
    return {
      page: pageValue,
      pageSize: pageSizeValue,
      severity: logsSeverity === "all" ? undefined : logsSeverity,
      action: logsActionFilter.trim() || undefined,
      sessionId: logsSessionFilter.trim() || undefined
    };
  }

  async function loadLogs(pageValue = logsPage, pageSizeValue = logsPageSize) {
    setLogsLoading(true);
    setLogsError("");
    try {
      const response = await requestLogs(activeBaseUrl, toLogsQuery(pageValue, pageSizeValue));
      setLogs(response.items);
      setLogsPage(response.page);
      setLogsPageSize(response.pageSize);
      setLogsTotal(response.total);
      setLogsHasMore(response.hasMore);
    } catch (error) {
      setLogsError(resolveErrorMessage(error, "Failed to load logs."));
    } finally {
      setLogsLoading(false);
    }
  }

  async function openLogsWorkspace() {
    setLogsWorkspaceOpen(true);
    await loadLogs(1, logsPageSize);
  }

  async function loadSettingsState() {
    setSettingsLoading(true);
    setSettingsError("");
    try {
      const response = await requestSettings(activeBaseUrl);
      const persistedClient = readClientSettingsSnapshot(ipadClientSettingsStorageKey, response.clientSettings);
      setAgentSettingsSource(response.agentSettings);
      setAgentSettingsDraft(response.agentSettings);
      setClientSettingsSource(persistedClient);
      setClientSettingsDraft(persistedClient);
      setSettingsUpdatedAt(response.updatedAt);
      setSettingsNeedsConfirm(false);
      setSettingsHighRiskKeys([]);
      setSettingsNotice("");
    } catch (error) {
      setSettingsError(resolveErrorMessage(error, "Failed to load settings."));
    } finally {
      setSettingsLoading(false);
    }
  }

  async function openSettingsSheet() {
    setSettingsSheetOpen(true);
    await loadSettingsState();
  }

  async function loadProjectFiles(query = filesQuery) {
    setFilesLoading(true);
    setFilesError("");
    setFilesPermissionDenied(false);
    try {
      const response = await requestProjectFiles(activeBaseUrl, diffProjectId, {
        query,
        limit: 300
      });
      setProjectFiles(response.files);
    } catch (error) {
      if (error instanceof CeryxApiError && error.code === "E_PERMISSION_DENIED") {
        setFilesPermissionDenied(true);
      }

      setFilesError(resolveErrorMessage(error, "Failed to load project files."));
      setProjectFiles([]);
    } finally {
      setFilesLoading(false);
    }
  }

  async function openFilesWorkspace() {
    setFilesWorkspaceOpen(true);
    await Promise.all([loadProjectFiles(), loadAgentFiles()]);
  }

  async function loadAgentFiles(path = "uploads") {
    setAgentFilesLoading(true);
    setAgentFilesError("");
    setAgentFilesPermissionDenied(false);
    try {
      const files = await requestAgentFiles(activeBaseUrl, path, 100);
      setAgentFiles(files);
    } catch (error) {
      if (error instanceof CeryxApiError && error.code === "E_PERMISSION_DENIED") {
        setAgentFilesPermissionDenied(true);
      }

      setAgentFilesError(resolveErrorMessage(error, "Failed to load agent files."));
      setAgentFiles([]);
    } finally {
      setAgentFilesLoading(false);
    }
  }

  async function uploadSelectedAgentFile() {
    if (!transferFile) {
      setAgentFilesError("Select a file before uploading.");
      return;
    }

    setTransferUploading(true);
    setAgentFilesError("");
    try {
      await uploadAgentFile(
        activeBaseUrl,
        transferFile,
        transferTargetPath.trim() ? transferTargetPath.trim() : undefined
      );
      setTransferFile(null);
      await loadAgentFiles();
    } catch (error) {
      if (error instanceof CeryxApiError && error.code === "E_PERMISSION_DENIED") {
        setAgentFilesPermissionDenied(true);
      }

      setAgentFilesError(resolveErrorMessage(error, "Failed to upload file."));
    } finally {
      setTransferUploading(false);
    }
  }

  async function downloadSelectedAgentFile(file: FileTransferEntry) {
    try {
      const blob = await downloadAgentFile(activeBaseUrl, file.fileId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setAgentFilesError(resolveErrorMessage(error, "Failed to download file."));
    }
  }

  async function deleteSelectedAgentFile(file: FileTransferEntry) {
    try {
      await deleteAgentFile(activeBaseUrl, file.fileId);
      await loadAgentFiles();
    } catch (error) {
      if (error instanceof CeryxApiError && error.code === "E_PERMISSION_DENIED") {
        setAgentFilesPermissionDenied(true);
      }

      setAgentFilesError(resolveErrorMessage(error, "Failed to delete file."));
    }
  }

  async function loadProjectTasks() {
    setTasksLoading(true);
    setTasksError("");
    setTasksPermissionDenied(false);
    try {
      const response = await requestProjectTasks(activeBaseUrl, 8);
      setTaskState(response.taskState);
      setTaskPromptActions(response.recentPromptActions);
      setTaskTestRequest(response.testRequest);
    } catch (error) {
      if (error instanceof CeryxApiError && error.code === "E_PERMISSION_DENIED") {
        setTasksPermissionDenied(true);
      }

      setTasksError(resolveErrorMessage(error, "Failed to load task status."));
      setTaskState(null);
      setTaskPromptActions([]);
      setTaskTestRequest(null);
    } finally {
      setTasksLoading(false);
    }
  }

  async function openTasksWorkspace() {
    setTasksWorkspaceOpen(true);
    await loadProjectTasks();
  }

  async function loadNotifications() {
    setNotificationsLoading(true);
    setNotificationsError("");
    setNotificationsPermissionDenied(false);
    try {
      const response = await requestNotifications(activeBaseUrl, 100);
      setNotifications(response.items);
      setNotificationsUnread(response.unread);
    } catch (error) {
      if (error instanceof CeryxApiError && error.code === "E_PERMISSION_DENIED") {
        setNotificationsPermissionDenied(true);
      }

      setNotificationsError(resolveErrorMessage(error, "Failed to load notifications."));
      setNotifications([]);
      setNotificationsUnread(0);
    } finally {
      setNotificationsLoading(false);
    }
  }

  async function openNotificationsWorkspace() {
    setNotificationsWorkspaceOpen(true);
    await loadNotifications();
  }

  async function markNotificationAsRead(notificationId: string) {
    try {
      await markNotificationRead(activeBaseUrl, notificationId);
      await loadNotifications();
    } catch (error) {
      setNotificationsError(resolveErrorMessage(error, "Failed to mark notification."));
    }
  }

  async function clearAllNotifications() {
    try {
      await clearNotifications(activeBaseUrl);
      await loadNotifications();
    } catch (error) {
      setNotificationsError(resolveErrorMessage(error, "Failed to clear notifications."));
    }
  }

  async function saveSettings(confirmHighRisk = false) {
    if (!agentSettingsDraft || !clientSettingsDraft) {
      return;
    }

    const sourceAgent = agentSettingsSource ?? agentSettingsDraft;
    const sourceClient = clientSettingsSource ?? clientSettingsDraft;
    const agentPatch = buildAgentSettingsPatch(sourceAgent, agentSettingsDraft);
    const hasClientChanges = !equalClientSettings(sourceClient, clientSettingsDraft);

    if (!agentPatch && !hasClientChanges) {
      setSettingsNotice("No changes to save.");
      setSettingsError("");
      return;
    }

    setSettingsSaving(true);
    setSettingsError("");
    setSettingsNotice("");
    try {
      if (hasClientChanges) {
        writeClientSettingsSnapshot(ipadClientSettingsStorageKey, clientSettingsDraft);
      }

      if (agentPatch) {
        const response = await patchAgentSettings(activeBaseUrl, agentPatch, confirmHighRisk);
        setAgentSettingsSource(response.agentSettings);
        setAgentSettingsDraft(response.agentSettings);
        setSettingsUpdatedAt(response.updatedAt);
      } else {
        setAgentSettingsSource(sourceAgent);
      }

      setClientSettingsSource(clientSettingsDraft);
      setSettingsNeedsConfirm(false);
      setSettingsHighRiskKeys([]);
      setSettingsNotice(agentPatch ? "Settings saved." : "Client settings saved locally.");
      await refreshConsole();
    } catch (error) {
      if (error instanceof CeryxApiError && error.code === "E_SETTINGS_CONFIRM_REQUIRED") {
        setSettingsNeedsConfirm(true);
        setSettingsHighRiskKeys(resolveHighRiskPatchKeys(sourceAgent, agentSettingsDraft));
      }

      setSettingsError(resolveErrorMessage(error, "Failed to save settings."));
    } finally {
      setSettingsSaving(false);
    }
  }

  async function copyVisibleLogs() {
    try {
      const payload = logs
        .map(
          (entry) =>
            `[${entry.createdAt}] [${entry.severity}] [${entry.sessionId || "local"}] ${entry.action} ${entry.details}`
        )
        .join("\n");
      await navigator.clipboard.writeText(payload);
      setFeedback(`Copied ${logs.length} visible log row(s).`);
    } catch (error) {
      setFeedback(resolveErrorMessage(error, "Failed to copy logs."));
    }
  }

  async function exportLogsSnapshot() {
    setLogsExporting(true);
    setLogsError("");
    try {
      const exportPageSize = 200;
      let exportPage = 1;
      let hasMore = true;
      const allRows: AgentLogEntry[] = [];

      while (hasMore) {
        const response = await requestLogs(activeBaseUrl, toLogsQuery(exportPage, exportPageSize));
        allRows.push(...response.items);
        hasMore = response.hasMore;
        exportPage += 1;
      }

      const blob = new Blob([JSON.stringify(allRows, null, 2)], {
        type: "application/json"
      });
      const timestamp = new Date().toISOString().replaceAll(":", "-");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `ceryx-audit-logs-${timestamp}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setFeedback(`Exported ${allRows.length} log row(s).`);
    } catch (error) {
      setLogsError(resolveErrorMessage(error, "Failed to export logs."));
    } finally {
      setLogsExporting(false);
    }
  }

  async function copyCurrentDiff() {
    if (!selectedDiff) {
      return;
    }

    try {
      await navigator.clipboard.writeText(selectedDiff.diffText);
      setFeedback(`Copied diff for ${selectedDiff.path}.`);
    } catch (error) {
      setFeedback(resolveErrorMessage(error, "Failed to copy diff."));
    }
  }

  function askCodexToExplainDiff() {
    if (!selectedDiff) {
      return;
    }

    if (inputLockActive) {
      setFeedback("Local input is locked while capturing.");
      return;
    }

    setDraft(
      [
        `Explain this diff and highlight risks for ${selectedDiff.path}:`,
        "",
        selectedDiff.diffText
      ].join("\n")
    );
    setFeedback("Explain prompt prepared from selected diff.");
  }

  function openSelectedDiffInCodex() {
    if (!selectedDiff) {
      return;
    }

    if (inputLockActive) {
      setFeedback("Local input is locked while capturing.");
      return;
    }

    setDraft(
      [
        `Use this diff as context and continue implementing for ${selectedDiff.path}:`,
        "",
        selectedDiff.diffText
      ].join("\n")
    );
    setFeedback("Diff inserted into prompt draft.");
  }

  async function handlePasteToWindowsClipboard() {
    if (!navigator.clipboard?.readText && !navigator.clipboard?.read) {
      return { message: "iPad clipboard read is unavailable in this browser context." };
    }

    const payload = await readLocalClipboardPayload();
    if (!payload) {
      return { message: "iPad clipboard is empty." };
    }

    const response = await sendLocalClipboardPayloadToWindows(activeBaseUrl, payload);
    clipboardAutoSyncSignatureRef.current = clipboardPayloadSignature(payload);
    clipboardAutoSyncErrorRef.current = "";
    return { message: `Clipboard sent to Windows (${response.sizeBytes} bytes).` };
  }

  async function handleCopyFromWindowsClipboard() {
    if (inputLockActive) {
      return { message: "Local input is locked while capturing." };
    }

    if (!navigator.clipboard) {
      return { message: "iPad clipboard access is unavailable in this browser context." };
    }

    const payload = await copyWindowsClipboardToLocal(activeBaseUrl);
    if (payload.type === "text") {
      setDraft(payload.content);
      clipboardAutoSyncSignatureRef.current = clipboardPayloadSignature(payload);
      clipboardAutoSyncErrorRef.current = "";
      return { message: "Windows clipboard copied to iPad and inserted into prompt draft." };
    }

    if (payload.type === "image") {
      clipboardAutoSyncSignatureRef.current = clipboardPayloadSignature(payload);
      clipboardAutoSyncErrorRef.current = "";
      return { message: "Windows image clipboard copied to iPad." };
    }

    return { message: "Clipboard payload type is not supported on this client." };
  }

  const sidePanelContent = (
    <div data-testid="ipad-side-panel" style={{ display: "grid", gap: 16, alignContent: "start" }}>
      <CodexWindowSwitcher
        size="ipad"
        title="Codex Windows"
        variant="cards"
        windows={codexWindows}
        activeWindowId={activeWindowId}
        previewUrls={windowPreviewUrls}
        loading={codexWindowsLoading}
        error={codexWindowsError}
        disabled={!connected}
        onSelectWindow={(windowId) => void selectWindow(windowId)}
        onRefresh={() => void refreshConsole()}
      />

      <Panel size="ipad" style={{ display: "grid", gap: 12 }}>
        <strong style={{ fontSize: 20 }}>Inspector</strong>
        <div style={{ color: ceryxColors.onSurfaceVariant, display: "grid", gap: 8 }}>
          <div>Device: {deviceName}</div>
          <div>Connection: {connected ? "connected" : "offline"}</div>
          <div>Session: {remoteSession.sessionId || "ipad-live-console"}</div>
          <div>
            Latency:{" "}
            {typeof remoteSession.latencyMs === "number" ? `${remoteSession.latencyMs} ms` : "-"}
          </div>
          <div>
            Frame rate:{" "}
            {typeof remoteSession.captureState.frameRate === "number"
              ? `${remoteSession.captureState.frameRate} fps`
              : "-"}
          </div>
          <div>Token verified: {tokenState === "valid" ? "yes" : "no"}</div>
          <div>Recording: {recordingActive ? "active" : "idle"}</div>
          <div>Codex: {codexStatus}</div>
          <div>Capture: {remoteSession.captureState.active ? "active" : "idle"}</div>
          <div>Input lock: {inputLockPreference ? "on" : "off"}</div>
        </div>

        <RecordingPanel
          size="ipad"
          connected={connected}
          loading={recordingsLoading}
          error={recordingsError}
          recordingActive={recordingActive}
          recordingAudioActive={recordingAudioActive}
          recordingMode={recordingMode}
          recordings={recordings}
          selectedRecordingFileName={selectedRecordingFileName}
          selectedRecordingUrl={selectedRecordingUrl}
          onRecordingModeChange={setRecordingMode}
          onToggleRecording={() => void handleRecord()}
          onRefreshRecordings={() => void loadRecordings()}
          onSelectRecording={(fileName) => void previewRecording(fileName)}
          onDownloadRecording={(fileName) => void downloadRecordingFile(fileName)}
        />

        {feedback ? (
          <Panel
            size="ipad"
            style={{
              backgroundColor: ceryxColors.surfaceContainerLow,
              borderColor: ceryxColors.outlineVariant
            }}
          >
            <p style={{ margin: 0 }}>{feedback}</p>
          </Panel>
        ) : null}
      </Panel>

      <Panel size="ipad" style={{ display: "grid", gap: 10 }}>
        <strong style={{ fontSize: 18 }}>Input Sheets</strong>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <Button
            size="ipad"
            variant="secondary"
            disabled={!connected || inputLockActive}
            onClick={() => setVoiceSheetOpen(true)}
          >
            Voice Input
          </Button>
          <Button
            size="ipad"
            variant="secondary"
            disabled={!connected || !canUploadImage || inputLockActive}
            onClick={() => setImageSheetOpen(true)}
          >
            Image Upload
          </Button>
          <Button
            size="ipad"
            variant="secondary"
            disabled={!canReadDiff || diffLoading}
            onClick={() => void openDiffWorkspace()}
          >
            Diff Workspace
          </Button>
          <Button
            size="ipad"
            variant="secondary"
            disabled={!connected || logsLoading}
            onClick={() => void openLogsWorkspace()}
          >
            Logs Workspace
          </Button>
          <Button
            size="ipad"
            variant="secondary"
            disabled={!connected || settingsLoading}
            onClick={() => void openSettingsSheet()}
          >
            Settings Sheet
          </Button>
          <Button
            size="ipad"
            variant="secondary"
            disabled={!connected || filesLoading}
            onClick={() => void openFilesWorkspace()}
          >
            Files Sheet
          </Button>
          <Button
            size="ipad"
            variant="secondary"
            disabled={!connected || tasksLoading}
            onClick={() => void openTasksWorkspace()}
          >
            Tasks Sheet
          </Button>
          <Button
            size="ipad"
            variant="secondary"
            disabled={!connected || notificationsLoading}
            onClick={() => void openNotificationsWorkspace()}
          >
            Notifications Sheet
          </Button>
        </div>
      </Panel>

      <PromptComposer
        size="ipad"
        draft={promptDraft}
        templates={templates}
        history={history}
        isSending={isSending}
        lastError={promptError}
        disabled={!connected || inputLockActive}
        onDraftChange={setDraft}
        onTemplateSelect={applyTemplate}
        onSend={(submit) => void handleSendPrompt(submit)}
        onClearHistory={clearHistory}
      />
    </div>
  );

  return (
    <section
      style={{
        display: "grid",
        gridTemplateRows: "64px 1fr",
        minHeight: "100vh",
        paddingBottom: toolbarVisible ? 108 : 24
      }}
    >
      <header
        style={{
          alignItems: "center",
          backgroundColor: ceryxColors.surfaceContainerLow,
          borderBottom: `1px solid ${ceryxColors.outlineVariant}`,
          display: "flex",
          justifyContent: "space-between",
          padding: "0 20px"
        }}
      >
        <div style={{ alignItems: "center", display: "flex", gap: 12 }}>
          <Button size="ipad" variant="ghost" onClick={() => navigate("/connections")}>
            Back
          </Button>
          <div style={{ display: "grid", gap: 4 }}>
            <h1 style={{ fontSize: 26, margin: 0 }}>Live Console</h1>
            <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 13 }}>
              {deviceName} | {activeBaseUrl}
            </div>
          </div>
        </div>
        <div style={{ alignItems: "center", display: "flex", gap: 10 }}>
          {isPortrait ? (
            <Button
              size="ipad"
              variant="secondary"
              onClick={() => setSideDrawerOpen(true)}
            >
              Open Side Panel
            </Button>
          ) : null}
          <StatusChip tone={connected ? "success" : "warning"}>
            {connected ? "connected" : "pairing required"}
          </StatusChip>
        </div>
      </header>

      <div
        style={{
          alignItems: "center",
          backgroundColor: ceryxColors.surfaceContainerLow,
          borderBottom: `1px solid ${ceryxColors.outlineVariant}`,
          color: ceryxColors.onSurfaceVariant,
          display: "flex",
          flexWrap: "wrap",
          fontSize: 12,
          gap: 12,
          padding: "8px 20px"
        }}
      >
        <span>connection: {connected ? "connected" : "offline"}</span>
        <span>
          latency: {typeof remoteSession.latencyMs === "number" ? `${remoteSession.latencyMs} ms` : "-"}
        </span>
        <span>
          fps: {typeof remoteSession.captureState.frameRate === "number" ? remoteSession.captureState.frameRate : "-"}
        </span>
        <span>token: {tokenState === "valid" ? "verified" : tokenState}</span>
        <span>recording: {recordingActive ? "active" : "idle"}</span>
      </div>

      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: isPortrait ? "minmax(0, 1fr)" : "minmax(0, 1fr) 360px",
          minHeight: 0,
          padding: 20
        }}
      >
        <RemoteViewport
          size="ipad"
          title="Remote Viewport"
          deviceName={deviceName}
          sessionStatus={remoteSession.status}
          codexStatus={codexStatus}
          captureState={remoteSession.captureState}
          latencyMs={remoteSession.latencyMs}
          frameRate={remoteSession.captureState.frameRate ?? null}
          tokenState={toViewportTokenState(tokenState)}
          recordingActive={recordingActive}
          lastError={remoteSession.lastError}
          disabled={!connected}
          onRefreshWindow={() =>
            void runToolbarAction(async () => {
              const snapshot = await refreshCodexWindow(activeBaseUrl);
              setCodexTitle(snapshot.title ?? "Codex");
              setCodexStatus(snapshot.status);
              return { message: "Codex window refreshed." };
            })
          }
          onToggleCapture={() =>
            void runToolbarAction(async () => {
              const response = remoteSession.captureState.active
                ? await stopCapture(activeBaseUrl)
                : await startCapture(activeBaseUrl, previewCaptureMode, activeWindowId ?? undefined);
              remoteSession.setCaptureState(response);
              if (response.active) {
                setViewportMessage("Waiting for real frame...");
                await viewportPreview.refresh();
              } else {
                setViewportMessage("Capture stopped. Last successful frame is frozen.");
              }
              return {
                message: response.active
                  ? `Capture session started (${previewRefreshProfile}).`
                  : "Capture session stopped."
              };
            })
          }
        >
          <div
            ref={gestureSurfaceRef}
            data-testid="ipad-gesture-surface"
            style={{
              minHeight: 210,
              overflow: "hidden",
              position: "relative",
              touchAction: "none"
            }}
            onTouchStart={gestureEngine.onTouchStart}
            onTouchMove={gestureEngine.onTouchMove}
            onTouchEnd={gestureEngine.onTouchEnd}
          >
            {viewportPreview.frameUrl ? (
              <img
                alt="Codex viewport frame"
                data-testid="ipad-viewport-frame"
                src={viewportPreview.frameUrl}
                style={{
                  display: "block",
                  height: "100%",
                  inset: 0,
                  objectFit: "contain",
                  position: "absolute",
                  width: "100%"
                }}
              />
            ) : null}
            {webRtcViewport.stream ? (
              <video
                ref={webRtcVideoRef}
                autoPlay
                muted
                playsInline
                data-testid="ipad-viewport-video"
                style={{
                  display: "block",
                  height: "100%",
                  inset: 0,
                  objectFit: "contain",
                  position: "absolute",
                  width: "100%"
                }}
              />
            ) : null}
            <div
              style={{
                background: (webRtcViewport.stream || viewportPreview.frameUrl)
                  ? "linear-gradient(180deg, rgba(20,18,16,0.34), rgba(20,18,16,0.52))"
                  : "linear-gradient(180deg, rgba(20,18,16,0.96), rgba(46,39,34,0.98))",
                display: "grid",
                gap: 12,
                inset: 0,
                padding: 18,
                pointerEvents: "none",
                position: "absolute"
              }}
            >
              <strong style={{ fontSize: 20 }}>{codexTitle}</strong>
              <div style={{ color: "#d0c7bf", maxWidth: 560 }}>{viewportOverlayMessage}</div>
              <div style={{ color: "#d0c7bf", fontSize: 13 }}>
                session={remoteSession.sessionId || "n/a"} | capture=
                {remoteSession.captureState.active ? remoteSession.captureState.mode : "idle"} | frame=
                {webRtcViewport.stream ? "webrtc" : (viewportPreview.capturedAt || "none")}
              </div>
            </div>

            {pipWindow ? (
              <CodexWindowPipPreview
                size="ipad"
                window={pipWindow}
                activeWindowId={activeWindowId}
                previewUrl={pipPreviewUrl ?? undefined}
                onSelectWindow={(windowId) => void selectWindow(windowId)}
                onClose={() =>
                  setPipDismissedWindowIds((current) =>
                    current.includes(pipWindow.windowId ?? "")
                      ? current
                      : [...current, pipWindow.windowId ?? ""]
                  )
                }
                style={{
                  bottom: 16,
                  position: "absolute",
                  right: 16,
                  zIndex: 2
                }}
              />
            ) : null}
          </div>
        </RemoteViewport>

        {!isPortrait ? sidePanelContent : null}
      </div>

      {isPortrait && sideDrawerOpen ? (
        <div
          data-testid="ipad-side-drawer"
          style={{
            inset: 0,
            position: "fixed",
            zIndex: 18
          }}
        >
          <div
            style={{
              backgroundColor: "rgba(16, 14, 12, 0.4)",
              inset: 0,
              position: "absolute"
            }}
            onClick={() => setSideDrawerOpen(false)}
          />
          <aside
            style={{
              backgroundColor: ceryxColors.surface,
              borderLeft: `1px solid ${ceryxColors.outlineVariant}`,
              bottom: 0,
              overflowY: "auto",
              padding: 16,
              position: "absolute",
              right: 0,
              top: 64,
              width: "min(440px, 92vw)"
            }}
          >
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
              <Button size="ipad" variant="ghost" onClick={() => setSideDrawerOpen(false)}>
                Close Panel
              </Button>
            </div>
            {sidePanelContent}
          </aside>
        </div>
      ) : null}

      {voiceSheetOpen ? (
        <div
          data-testid="ipad-voice-sheet"
          style={{
            inset: 0,
            position: "fixed",
            zIndex: 20
          }}
        >
          <div
            style={{
              backgroundColor: "rgba(16, 14, 12, 0.45)",
              inset: 0,
              position: "absolute"
            }}
            onClick={() => setVoiceSheetOpen(false)}
          />
          <Panel
            size="ipad"
            style={{
              bottom: 16,
              left: "50%",
              maxWidth: 760,
              position: "absolute",
              transform: "translateX(-50%)",
              width: "calc(100vw - 24px)"
            }}
          >
            <div style={{ display: "grid", gap: 12 }}>
              <strong style={{ fontSize: 20 }}>Voice Input Sheet</strong>
              <TextArea
                label="Transcript Placeholder"
                value={voiceDraft}
                hint="This placeholder simulates voice recognition text."
                disabled={inputLockActive}
                onChange={(event) => setVoiceDraft(event.target.value)}
                style={{ minHeight: 120 }}
              />
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <Button size="ipad" variant="ghost" onClick={() => setVoiceSheetOpen(false)}>
                  Cancel
                </Button>
                <Button
                  size="ipad"
                  disabled={inputLockActive || !voiceDraft.trim()}
                  onClick={appendVoiceDraftToPrompt}
                >
                  Insert Draft
                </Button>
              </div>
            </div>
          </Panel>
        </div>
      ) : null}

      {imageSheetOpen ? (
        <div
          data-testid="ipad-image-sheet"
          style={{
            inset: 0,
            position: "fixed",
            zIndex: 20
          }}
        >
          <div
            style={{
              backgroundColor: "rgba(16, 14, 12, 0.45)",
              inset: 0,
              position: "absolute"
            }}
            onClick={() => setImageSheetOpen(false)}
          />
          <Panel
            size="ipad"
            style={{
              bottom: 16,
              left: "50%",
              maxWidth: 760,
              position: "absolute",
              transform: "translateX(-50%)",
              width: "calc(100vw - 24px)"
            }}
          >
            <div style={{ display: "grid", gap: 12 }}>
              <strong style={{ fontSize: 20 }}>Image Upload Sheet</strong>
              <input
                aria-label="Image file input"
                type="file"
                accept="image/*"
                disabled={inputLockActive}
                onChange={(event) => setSelectedImage(event.target.files?.[0] ?? null)}
              />
              <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 13 }}>
                {selectedImage ? `Selected: ${selectedImage.name}` : "Select an image to upload."}
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <Button size="ipad" variant="ghost" onClick={() => setImageSheetOpen(false)}>
                  Cancel
                </Button>
                <Button
                  size="ipad"
                  disabled={inputLockActive || !selectedImage || uploadingImage || !canUploadImage}
                  onClick={() => void uploadSelectedImage()}
                >
                  {uploadingImage ? "Uploading..." : "Upload Image"}
                </Button>
              </div>
            </div>
          </Panel>
        </div>
      ) : null}

      {settingsSheetOpen ? (
        <div
          data-testid="ipad-settings-sheet"
          style={{
            inset: 0,
            position: "fixed",
            zIndex: 20
          }}
        >
          <div
            style={{
              backgroundColor: "rgba(16, 14, 12, 0.45)",
              inset: 0,
              position: "absolute"
            }}
            onClick={() => setSettingsSheetOpen(false)}
          />
          <Panel
            size="ipad"
            style={{
              bottom: 10,
              left: "50%",
              maxWidth: 980,
              position: "absolute",
              top: 80,
              transform: "translateX(-50%)",
              width: "calc(100vw - 16px)"
            }}
          >
            <div style={{ display: "grid", gap: 12, gridTemplateRows: "auto auto 1fr auto", height: "100%" }}>
              <header style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
                <div style={{ display: "grid", gap: 4 }}>
                  <strong style={{ fontSize: 20 }}>Settings</strong>
                  <span style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                    {settingsSaving
                      ? "saving"
                      : settingsDirty
                        ? "unsaved"
                        : settingsUpdatedAt
                          ? `synced ${formatTimestamp(settingsUpdatedAt)}`
                          : "synced"}
                  </span>
                  <StatusChip tone={inputLockPreference ? "warning" : "neutral"}>
                    input lock: {inputLockPreference ? "on" : "off"}
                  </StatusChip>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button
                    size="ipad"
                    variant="secondary"
                    disabled={settingsLoading || settingsSaving}
                    onClick={() => void loadSettingsState()}
                  >
                    Refresh
                  </Button>
                  <Button
                    size="ipad"
                    variant="secondary"
                    disabled={settingsLoading || settingsSaving || !clientSettingsDraft}
                    onClick={() => updateInputLockPreference(!inputLockPreference)}
                  >
                    {inputLockPreference ? "Unlock Input" : "Lock Input"}
                  </Button>
                  <Button size="ipad" variant="ghost" onClick={() => setSettingsSheetOpen(false)}>
                    Close
                  </Button>
                </div>
              </header>

              <div style={{ display: "grid", gap: 8 }}>
                {ipadSettingsGroups.map((group) => (
                  <div key={group.group} style={{ display: "grid", gap: 6 }}>
                    <span
                      style={{
                        color: ceryxColors.onSurfaceVariant,
                        fontSize: 12,
                        letterSpacing: 0.3,
                        textTransform: "uppercase"
                      }}
                    >
                      {group.group}
                    </span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {group.sections.map((section) => (
                        <Button
                          key={section.id}
                          size="ipad"
                          variant={settingsSection === section.id ? "primary" : "ghost"}
                          onClick={() => setSettingsSection(section.id)}
                        >
                          {section.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ minHeight: 0, overflow: "auto" }}>
                {!settingsReady ? (
                  <div style={{ color: ceryxColors.onSurfaceVariant }}>
                    {settingsLoading ? "Loading settings..." : "Settings unavailable."}
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 12 }}>
                    {settingsSection === "general" ? (
                      <div style={{ display: "grid", gap: 12 }}>
                        <strong>General</strong>
                        <label style={{ display: "grid", gap: 4 }}>
                          <span style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>Theme</span>
                          <select
                            value={clientSettingsDraft.theme}
                            disabled={inputLockActive}
                            onChange={(event) =>
                              setClientSettingsDraft((current) =>
                                current ? { ...current, theme: event.target.value } : current
                              )
                            }
                            style={ipadFieldStyle}
                          >
                            <option value="system">system</option>
                            <option value="light">light</option>
                            <option value="dark">dark</option>
                          </select>
                        </label>
                        <IpadCheckboxRow
                          label="Compact mode"
                          checked={clientSettingsDraft.compactMode}
                          disabled={inputLockActive}
                          onChange={(checked) =>
                            setClientSettingsDraft((current) =>
                              current ? { ...current, compactMode: checked } : current
                            )
                          }
                        />
                        <IpadCheckboxRow
                          label="Show latency in inspector"
                          checked={clientSettingsDraft.showLatency}
                          disabled={inputLockActive}
                          onChange={(checked) =>
                            setClientSettingsDraft((current) =>
                              current ? { ...current, showLatency: checked } : current
                            )
                          }
                        />
                        <IpadCheckboxRow
                          label="Auto-sync clipboard to Windows"
                          checked={Boolean(clientSettingsDraft.clipboardAutoSync ?? false)}
                          disabled={inputLockActive}
                          onChange={(checked) =>
                            setClientSettingsDraft((current) =>
                              current ? { ...current, clipboardAutoSync: checked } : current
                            )
                          }
                        />
                        <IpadCheckboxRow
                          label="Lock local input while capturing"
                          checked={inputLockPreference}
                          disabled={inputLockActive}
                          onChange={(checked) => updateInputLockPreference(checked)}
                        />
                      </div>
                    ) : null}

                    {settingsSection === "gestures" ? (
                      <GestureSettingsEditor
                        activeProfileId={activeGestureProfileId}
                        bindings={gestureBindings}
                        captureState={remoteSession.captureState}
                        onBindingChange={updateGestureBinding}
                        onProfileChange={updateGestureProfile}
                        onReset={resetGestureProfile}
                        profile={gestureProfile}
                      />
                    ) : null}

                    {settingsSection === "agent" ? (
                      <div style={{ display: "grid", gap: 12 }}>
                        <strong>Agent</strong>
                        <label style={{ display: "grid", gap: 4 }}>
                          <span style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>HTTP Port</span>
                          <input
                            value={agentSettingsDraft.httpPort}
                            type="number"
                            min={1}
                            max={65535}
                            disabled={!canManageAgent || inputLockActive}
                            onChange={(event) => {
                              const parsed = Number.parseInt(event.target.value, 10);
                              if (!Number.isFinite(parsed)) {
                                return;
                              }

                              setAgentSettingsDraft((current) =>
                                current ? { ...current, httpPort: parsed } : current
                              );
                            }}
                            style={ipadFieldStyle}
                          />
                        </label>
                        <label style={{ display: "grid", gap: 4 }}>
                          <span style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                            Direct Test Command
                          </span>
                          <textarea
                            rows={4}
                            value={agentSettingsDraft.directTestCommand}
                            disabled={!canManageAgent || inputLockActive}
                            onChange={(event) =>
                              setAgentSettingsDraft((current) =>
                                current ? { ...current, directTestCommand: event.target.value } : current
                              )
                            }
                            style={{
                              ...ipadFieldStyle,
                              fontFamily: "Consolas, Monaco, 'Courier New', monospace",
                              height: "auto",
                              minHeight: 104,
                              padding: 10
                            }}
                          />
                        </label>
                      </div>
                    ) : null}

                    {settingsSection === "connection" ? (
                      <div style={{ display: "grid", gap: 8 }}>
                        <strong>Connection</strong>
                        <div>Device: {deviceName}</div>
                        <div>Base URL: {activeBaseUrl}</div>
                        <div>Session: {remoteSession.sessionId || "ipad-live-console"}</div>
                        <div>Status: {remoteSession.status}</div>
                      </div>
                    ) : null}

                    {settingsSection === "permissions" ? (
                      <div style={{ display: "grid", gap: 12 }}>
                        <strong>Permissions</strong>
                        <IpadCheckboxRow
                          label="Keyboard shortcuts enabled"
                          checked={clientSettingsDraft.keyboardShortcuts}
                          disabled={inputLockActive}
                          onChange={(checked) =>
                            setClientSettingsDraft((current) =>
                              current ? { ...current, keyboardShortcuts: checked } : current
                            )
                          }
                        />
                        <IpadCheckboxRow
                          label="Notifications enabled"
                          checked={clientSettingsDraft.notificationsEnabled}
                          disabled={inputLockActive}
                          onChange={(checked) =>
                            setClientSettingsDraft((current) =>
                              current ? { ...current, notificationsEnabled: checked } : current
                            )
                          }
                        />
                      </div>
                    ) : null}

                    {settingsSection === "capture" ? (
                      <div style={{ display: "grid", gap: 12 }}>
                        <strong>Capture</strong>
                        <label style={{ display: "grid", gap: 4 }}>
                          <span style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                            Preview refresh profile
                          </span>
                          <select
                            value={normalizePreviewRefreshProfile(clientSettingsDraft.previewRefreshProfile)}
                            disabled={inputLockActive}
                            onChange={(event) =>
                              setClientSettingsDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      previewRefreshProfile: normalizePreviewRefreshProfile(event.target.value)
                                    }
                                  : current
                              )
                            }
                            style={ipadFieldStyle}
                          >
                            <option value="balanced">balanced (1000 ms)</option>
                            <option value="high_frequency">high_frequency (400 ms)</option>
                          </select>
                        </label>
                        <label style={{ display: "grid", gap: 4 }}>
                          <span style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                            Viewport transport
                          </span>
                          <select
                            value={clientSettingsDraft.viewportTransport ?? defaultViewportTransport}
                            disabled={inputLockActive}
                            onChange={(event) =>
                              setClientSettingsDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      viewportTransport: event.target.value === "polling" ? "polling" : "webrtc"
                                    }
                                  : current
                              )
                            }
                            style={ipadFieldStyle}
                          >
                            <option value="webrtc">webrtc (default)</option>
                            <option value="polling">polling fallback only</option>
                          </select>
                        </label>
                        <label style={{ display: "grid", gap: 4 }}>
                          <span style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                            Default capture mode
                          </span>
                          <select
                            value={agentSettingsDraft.defaultCaptureMode}
                            disabled={!canManageAgent || inputLockActive}
                            onChange={(event) =>
                              setAgentSettingsDraft((current) =>
                                current ? { ...current, defaultCaptureMode: event.target.value } : current
                              )
                            }
                            style={ipadFieldStyle}
                          >
                            <option value="balanced">balanced</option>
                            <option value="performance">performance</option>
                            <option value="high_quality">high_quality</option>
                          </select>
                        </label>
                        <IpadCheckboxRow
                          label="Allow full-screen capture"
                          checked={agentSettingsDraft.allowFullscreenCapture}
                          disabled={!canManageAgent || inputLockActive}
                          onChange={(checked) =>
                            setAgentSettingsDraft((current) =>
                              current ? { ...current, allowFullscreenCapture: checked } : current
                            )
                          }
                        />
                      </div>
                    ) : null}

                    {settingsSection === "shortcuts" ? (
                      <div style={{ display: "grid", gap: 10 }}>
                        <strong>Shortcuts</strong>
                        <IpadCheckboxRow
                          label="Enable keyboard shortcuts"
                          checked={clientSettingsDraft.keyboardShortcuts}
                          onChange={(checked) =>
                            setClientSettingsDraft((current) =>
                              current ? { ...current, keyboardShortcuts: checked } : current
                            )
                          }
                        />
                        <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                          Multi-touch gestures remain available regardless of keyboard shortcuts.
                        </div>
                      </div>
                    ) : null}

                    {settingsSection === "logs" ? (
                      <div style={{ display: "grid", gap: 12 }}>
                        <strong>Logs</strong>
                        <IpadCheckboxRow
                          label="Auto refresh logs workspace"
                          checked={clientSettingsDraft.logsAutoRefresh}
                          onChange={(checked) =>
                            setClientSettingsDraft((current) =>
                              current ? { ...current, logsAutoRefresh: checked } : current
                            )
                          }
                        />
                        <IpadCheckboxRow
                          label="Allow clear logs action"
                          checked={agentSettingsDraft.allowClearLogs}
                          disabled={!canManageAgent}
                          onChange={(checked) =>
                            setAgentSettingsDraft((current) =>
                              current ? { ...current, allowClearLogs: checked } : current
                            )
                          }
                        />
                      </div>
                    ) : null}

                    {settingsSection === "about" ? (
                      <div style={{ display: "grid", gap: 8 }}>
                        <strong>About</strong>
                        <div>Ceryx iPad Console v0.3</div>
                        <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                          Last sync: {settingsUpdatedAt ? formatTimestamp(settingsUpdatedAt) : "-"}
                        </div>
                        <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                          Client settings are stored locally on this iPad browser context.
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                {settingsNeedsConfirm ? (
                  <Panel
                    size="ipad"
                    style={{
                      backgroundColor: ceryxColors.surfaceContainerLow,
                      borderColor: ceryxColors.outlineVariant,
                      display: "grid",
                      gap: 8
                    }}
                  >
                    <strong style={{ fontSize: 14 }}>High-risk confirmation required</strong>
                    <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                      {settingsHighRiskKeys.length > 0
                        ? `Keys: ${settingsHighRiskKeys.join(", ")}`
                        : "Agent requires confirmHighRisk=true."}
                    </div>
                    <Button
                      size="ipad"
                      disabled={settingsSaving || !canManageAgent}
                      onClick={() => void saveSettings(true)}
                    >
                      Confirm and Save
                    </Button>
                  </Panel>
                ) : null}
                {settingsError ? (
                  <span style={{ color: "#ffb4a8", fontSize: 12 }}>{settingsError}</span>
                ) : null}
                {settingsNotice ? (
                  <span style={{ color: "#8fe3b5", fontSize: 12 }}>{settingsNotice}</span>
                ) : null}
                <Button
                  size="ipad"
                  disabled={
                    settingsSaving ||
                    settingsLoading ||
                    !settingsDirty ||
                    (settingsAgentDirty && !canManageAgent)
                  }
                  onClick={() => void saveSettings()}
                >
                  Save Settings
                </Button>
              </div>
            </div>
          </Panel>
        </div>
      ) : null}

      {diffWorkspaceOpen ? (
        <div
          data-testid="ipad-diff-workspace"
          style={{
            inset: 0,
            position: "fixed",
            zIndex: 21
          }}
        >
          <div
            style={{
              backgroundColor: "rgba(16, 14, 12, 0.45)",
              inset: 0,
              position: "absolute"
            }}
          />
          <section
            style={{
              backgroundColor: ceryxColors.surface,
              display: "grid",
              gridTemplateRows: "56px auto 1fr auto",
              inset: "8px",
              position: "absolute"
            }}
          >
            <header
              style={{
                alignItems: "center",
                borderBottom: `1px solid ${ceryxColors.outlineVariant}`,
                display: "flex",
                justifyContent: "space-between",
                padding: "0 12px"
              }}
            >
              <strong>Diff Workspace</strong>
              <div style={{ display: "flex", gap: 8 }}>
                <Button
                  size="ipad"
                  variant="secondary"
                  disabled={diffLoading}
                  onClick={() => void loadDiffFiles()}
                >
                  Refresh
                </Button>
                <Button size="ipad" variant="ghost" onClick={() => setDiffWorkspaceOpen(false)}>
                  Close
                </Button>
              </div>
            </header>

            <div
              style={{
                borderBottom: `1px solid ${ceryxColors.outlineVariant}`,
                display: "flex",
                gap: 8,
                overflowX: "auto",
                padding: "10px 12px"
              }}
            >
              {diffLoading ? <span>Loading files...</span> : null}
              {!diffLoading && diffFiles.length === 0 ? <span>No changed files.</span> : null}
              {!diffLoading
                ? diffFiles.map((file) => (
                    <Button
                      key={file.path}
                      size="ipad"
                      variant={file.path === selectedDiffPath ? "primary" : "ghost"}
                      onClick={() => void loadDiffFile(diffProjectId, file.path)}
                    >
                      {file.path} (+{file.additions}/-{file.deletions})
                    </Button>
                  ))
                : null}
            </div>

            <div style={{ minHeight: 0, overflow: "auto", padding: 12 }}>
              <Panel
                size="ipad"
                style={{
                  backgroundColor: "#111014",
                  borderColor: ceryxColors.outlineVariant,
                  color: "#e9e4dd",
                  minHeight: "100%"
                }}
              >
                <div style={{ display: "grid", gap: 8 }}>
                  <strong style={{ color: "#f5efe8", fontSize: 16 }}>
                    {selectedDiff?.path ?? "Select a file to view diff"}
                  </strong>
                  <pre
                    style={{
                      backgroundColor: "#0b0a0f",
                      border: "1px solid #2f2a36",
                      borderRadius: 10,
                      fontFamily: "Consolas, Monaco, 'Courier New', monospace",
                      fontSize: 12,
                      margin: 0,
                      maxHeight: "55vh",
                      overflow: "auto",
                      padding: 12,
                      whiteSpace: "pre-wrap"
                    }}
                  >
                    {diffFileLoading
                      ? "Loading file diff..."
                      : selectedDiff?.diffText || "No diff selected."}
                  </pre>
                  {selectedDiff?.truncated ? (
                    <span style={{ color: "#d0c7bf", fontSize: 12 }}>
                      Diff truncated at {selectedDiff.lineLimit} lines.
                    </span>
                  ) : null}
                  {diffError ? (
                    <span style={{ color: "#ffb4a8", fontSize: 12 }}>{diffError}</span>
                  ) : null}
                </div>
              </Panel>
            </div>

            <div
              style={{
                borderTop: `1px solid ${ceryxColors.outlineVariant}`,
                display: "grid",
                gap: 8,
                gridTemplateColumns: "1fr 1fr",
                padding: 12
              }}
            >
              <Button
                size="ipad"
                disabled={!selectedDiff || inputLockActive}
                onClick={() => askCodexToExplainDiff()}
              >
                Ask Codex to Explain
              </Button>
              <Button
                size="ipad"
                disabled={!selectedDiff || inputLockActive}
                onClick={() => {
                  if (!selectedDiff) {
                    return;
                  }

                  if (inputLockActive) {
                    setFeedback("Local input is locked while capturing.");
                    return;
                  }

                  setDraft(`Continue implementation based on ${selectedDiff.path} diff review.`);
                  setFeedback("Continue prompt prepared from selected diff.");
                }}
              >
                Continue
              </Button>
              <Button size="ipad" disabled={!selectedDiff} onClick={() => void copyCurrentDiff()}>
                Copy Diff
              </Button>
              <Button
                size="ipad"
                disabled={!selectedDiff || inputLockActive}
                onClick={() => openSelectedDiffInCodex()}
              >
                Open in Codex
              </Button>
            </div>
          </section>
        </div>
      ) : null}

      {logsWorkspaceOpen ? (
        <div
          data-testid="ipad-logs-workspace"
          style={{
            inset: 0,
            position: "fixed",
            zIndex: 22
          }}
        >
          <div
            style={{
              backgroundColor: "rgba(16, 14, 12, 0.45)",
              inset: 0,
              position: "absolute"
            }}
          />
          <section
            style={{
              backgroundColor: ceryxColors.surface,
              display: "grid",
              gridTemplateRows: "56px auto 1fr auto",
              inset: "8px",
              position: "absolute"
            }}
          >
            <header
              style={{
                alignItems: "center",
                borderBottom: `1px solid ${ceryxColors.outlineVariant}`,
                display: "flex",
                justifyContent: "space-between",
                padding: "0 12px"
              }}
            >
              <strong>Logs Workspace</strong>
              <div style={{ display: "flex", gap: 8 }}>
                <Button
                  size="ipad"
                  variant="secondary"
                  disabled={logsLoading}
                  onClick={() => void loadLogs()}
                >
                  Refresh
                </Button>
                <Button size="ipad" variant="ghost" onClick={() => setLogsWorkspaceOpen(false)}>
                  Close
                </Button>
              </div>
            </header>

            <div style={{ borderBottom: `1px solid ${ceryxColors.outlineVariant}`, padding: 12 }}>
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>Severity</span>
                  <select
                    value={logsSeverity}
                    onChange={(event) => setLogsSeverity(event.target.value)}
                    style={{
                      backgroundColor: ceryxColors.surface,
                      border: `1px solid ${ceryxColors.outlineVariant}`,
                      borderRadius: 8,
                      color: ceryxColors.onSurface,
                      height: 36,
                      padding: "0 8px"
                    }}
                  >
                    <option value="all">all</option>
                    <option value="info">info</option>
                    <option value="warning">warning</option>
                    <option value="error">error</option>
                  </select>
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>Action</span>
                  <input
                    value={logsActionFilter}
                    onChange={(event) => setLogsActionFilter(event.target.value)}
                    placeholder="input.rejected"
                    style={{
                      backgroundColor: ceryxColors.surface,
                      border: `1px solid ${ceryxColors.outlineVariant}`,
                      borderRadius: 8,
                      color: ceryxColors.onSurface,
                      height: 36,
                      padding: "0 10px"
                    }}
                  />
                </label>
                <label style={{ display: "grid", gap: 4, gridColumn: "1 / span 2" }}>
                  <span style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>Session</span>
                  <input
                    value={logsSessionFilter}
                    onChange={(event) => setLogsSessionFilter(event.target.value)}
                    placeholder="device id"
                    style={{
                      backgroundColor: ceryxColors.surface,
                      border: `1px solid ${ceryxColors.outlineVariant}`,
                      borderRadius: 8,
                      color: ceryxColors.onSurface,
                      height: 36,
                      padding: "0 10px"
                    }}
                  />
                </label>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <Button
                  size="ipad"
                  variant="secondary"
                  disabled={logsLoading}
                  onClick={() => void loadLogs(1, logsPageSize)}
                >
                  Apply Filters
                </Button>
                <Button
                  size="ipad"
                  variant="secondary"
                  disabled={logsLoading || logs.length === 0}
                  onClick={() => void copyVisibleLogs()}
                >
                  Copy Visible
                </Button>
                <Button
                  size="ipad"
                  variant="secondary"
                  disabled={logsLoading || logsExporting}
                  onClick={() => void exportLogsSnapshot()}
                >
                  {logsExporting ? "Exporting..." : "Export Logs"}
                </Button>
              </div>
            </div>

            <div style={{ minHeight: 0, overflow: "hidden", padding: 12 }}>
              <Panel size="ipad" style={{ display: "grid", gap: 8, minHeight: "100%" }}>
                <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                  total={logsTotal} page={logsPage} pageSize={logsPageSize}
                </div>
                {logsLoading ? <div>Loading logs...</div> : null}
                {!logsLoading && logs.length === 0 ? <div>No logs for current filters.</div> : null}
                <IpadVirtualizedLogsList entries={logs} />
                {logsError ? (
                  <span style={{ color: "#ffb4a8", fontSize: 12 }}>{logsError}</span>
                ) : null}
              </Panel>
            </div>

            <div
              style={{
                borderTop: `1px solid ${ceryxColors.outlineVariant}`,
                display: "grid",
                gap: 8,
                gridTemplateColumns: "1fr 1fr",
                padding: 12
              }}
            >
              <Button
                size="ipad"
                variant="secondary"
                disabled={logsLoading || logsPage <= 1}
                onClick={() => void loadLogs(logsPage - 1, logsPageSize)}
              >
                Previous
              </Button>
              <Button
                size="ipad"
                variant="secondary"
                disabled={logsLoading || !logsHasMore}
                onClick={() => void loadLogs(logsPage + 1, logsPageSize)}
              >
                Next
              </Button>
            </div>
          </section>
        </div>
      ) : null}

      {filesWorkspaceOpen ? (
        <div
          data-testid="ipad-files-workspace"
          style={{
            inset: 0,
            position: "fixed",
            zIndex: 23
          }}
        >
          <div
            style={{
              backgroundColor: "rgba(16, 14, 12, 0.45)",
              inset: 0,
              position: "absolute"
            }}
          />
          <section
            style={{
              backgroundColor: ceryxColors.surface,
              display: "grid",
              gridTemplateRows: "56px auto 1fr",
              inset: "8px",
              position: "absolute"
            }}
          >
            <header
              style={{
                alignItems: "center",
                borderBottom: `1px solid ${ceryxColors.outlineVariant}`,
                display: "flex",
                justifyContent: "space-between",
                padding: "0 12px"
              }}
            >
              <strong>Files Sheet</strong>
              <div style={{ display: "flex", gap: 8 }}>
                <Button size="ipad" variant="secondary" disabled={filesLoading} onClick={() => void loadProjectFiles()}>
                  Refresh
                </Button>
                <Button size="ipad" variant="ghost" onClick={() => setFilesWorkspaceOpen(false)}>
                  Close
                </Button>
              </div>
            </header>
            <div
              style={{
                borderBottom: `1px solid ${ceryxColors.outlineVariant}`,
                display: "grid",
                gap: 8,
                gridTemplateColumns: "minmax(0, 1fr) auto",
                padding: 12
              }}
            >
              <input
                value={filesQuery}
                onChange={(event) => setFilesQuery(event.target.value)}
                placeholder="Filter files..."
                style={ipadFieldStyle}
              />
              <Button size="ipad" onClick={() => void loadProjectFiles(filesQuery)}>
                Search
              </Button>
            </div>
            <div style={{ minHeight: 0, overflow: "auto", padding: 12 }}>
              <div style={{ display: "grid", gap: 12 }}>
                <Panel size="ipad" style={{ display: "grid", gap: 8 }}>
                  {filesPermissionDenied ? (
                    <span style={{ color: "#ffb4a8", fontSize: 12 }}>
                      Permission denied. Requires `read_diff`.
                    </span>
                  ) : null}
                  {filesLoading ? <span>Loading files...</span> : null}
                  {!filesLoading && !filesPermissionDenied && projectFiles.length === 0 ? (
                    <span>No files found.</span>
                  ) : null}
                  {!filesLoading && !filesPermissionDenied
                    ? projectFiles.map((file) => (
                        <div
                          key={file.path}
                          style={{
                            border: `1px solid ${ceryxColors.outlineVariant}`,
                            borderRadius: 8,
                            display: "grid",
                            gap: 6,
                            gridTemplateColumns: "minmax(0, 1fr) auto auto",
                            padding: "8px 10px"
                          }}
                        >
                          <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                            {file.path}
                          </div>
                          <StatusChip tone={file.changed ? "warning" : "neutral"}>
                            {file.changed ? "changed" : "clean"}
                          </StatusChip>
                          <StatusChip tone={file.tracked ? "success" : "neutral"}>
                            {file.tracked ? "tracked" : "untracked"}
                          </StatusChip>
                        </div>
                      ))
                    : null}
                  {filesError ? <span style={{ color: "#ffb4a8", fontSize: 12 }}>{filesError}</span> : null}
                </Panel>

                <Panel data-testid="ipad-agent-file-transfer" size="ipad" style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <strong>Agent File Transfers</strong>
                    <div style={{ display: "flex", gap: 8 }}>
                      <Button
                        size="ipad"
                        variant="secondary"
                        disabled={agentFilesLoading}
                        onClick={() => void loadAgentFiles()}
                      >
                        Refresh Uploads
                      </Button>
                      <Button
                        size="ipad"
                        disabled={transferUploading || !transferFile}
                        onClick={() => void uploadSelectedAgentFile()}
                      >
                        {transferUploading ? "Uploading..." : "Upload File"}
                      </Button>
                    </div>
                  </div>
                  <div
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      setTransferFile(event.dataTransfer.files?.[0] ?? null);
                    }}
                    style={{
                      alignItems: "center",
                      border: `1px dashed ${ceryxColors.outlineVariant}`,
                      borderRadius: 10,
                      display: "grid",
                      gap: 8,
                      padding: 12
                    }}
                  >
                    <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                      Drop a file here or choose one below. Files up to 100 MB are supported.
                    </div>
                    <input
                      aria-label="Transfer file input"
                      onChange={(event) => setTransferFile(event.target.files?.[0] ?? null)}
                      type="file"
                    />
                    <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                      {transferFile ? `Selected: ${transferFile.name}` : "No file selected."}
                    </div>
                    <input
                      aria-label="Transfer target path"
                      value={transferTargetPath}
                      onChange={(event) => setTransferTargetPath(event.target.value)}
                      placeholder="Target path (optional)"
                      style={ipadFieldStyle}
                    />
                  </div>
                  {agentFilesPermissionDenied ? (
                    <span style={{ color: "#ffb4a8", fontSize: 12 }}>
                      Permission denied. Requires `manage_agent`.
                    </span>
                  ) : null}
                  {agentFilesLoading ? <span>Loading agent files...</span> : null}
                  {!agentFilesLoading && !agentFilesPermissionDenied && agentFiles.length === 0 ? (
                    <span>No uploaded files yet.</span>
                  ) : null}
                  {!agentFilesLoading && !agentFilesPermissionDenied
                    ? agentFiles.map((file) => (
                        <div
                          key={file.fileId}
                          data-testid={`ipad-agent-file-${file.fileId}`}
                          style={{
                            border: `1px solid ${ceryxColors.outlineVariant}`,
                            borderRadius: 8,
                            display: "grid",
                            gap: 6,
                            gridTemplateColumns: "minmax(0, 1fr) auto auto",
                            padding: "8px 10px"
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{file.fileName}</div>
                            <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 11 }}>
                              {file.mimeType} · {file.sizeBytes} bytes
                            </div>
                            <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 11 }}>
                              Uploaded {new Date(file.uploadedAt).toLocaleString()}
                            </div>
                          </div>
                          <Button size="ipad" variant="secondary" onClick={() => void downloadSelectedAgentFile(file)}>
                            Download
                          </Button>
                          <Button size="ipad" variant="ghost" onClick={() => void deleteSelectedAgentFile(file)}>
                            Delete
                          </Button>
                        </div>
                      ))
                    : null}
                  {agentFilesError ? <span style={{ color: "#ffb4a8", fontSize: 12 }}>{agentFilesError}</span> : null}
                </Panel>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {tasksWorkspaceOpen ? (
        <div
          data-testid="ipad-tasks-workspace"
          style={{
            inset: 0,
            position: "fixed",
            zIndex: 24
          }}
        >
          <div
            style={{
              backgroundColor: "rgba(16, 14, 12, 0.45)",
              inset: 0,
              position: "absolute"
            }}
          />
          <section
            style={{
              backgroundColor: ceryxColors.surface,
              display: "grid",
              gridTemplateRows: "56px 1fr",
              inset: "8px",
              position: "absolute"
            }}
          >
            <header
              style={{
                alignItems: "center",
                borderBottom: `1px solid ${ceryxColors.outlineVariant}`,
                display: "flex",
                justifyContent: "space-between",
                padding: "0 12px"
              }}
            >
              <strong>Tasks Sheet</strong>
              <div style={{ display: "flex", gap: 8 }}>
                <Button size="ipad" variant="secondary" disabled={tasksLoading} onClick={() => void loadProjectTasks()}>
                  Refresh
                </Button>
                <Button size="ipad" variant="ghost" onClick={() => setTasksWorkspaceOpen(false)}>
                  Close
                </Button>
              </div>
            </header>
            <div style={{ minHeight: 0, overflow: "auto", padding: 12 }}>
              <Panel size="ipad" style={{ display: "grid", gap: 12 }}>
                {tasksPermissionDenied ? (
                  <span style={{ color: "#ffb4a8", fontSize: 12 }}>
                    Permission denied for task status.
                  </span>
                ) : null}
                {tasksLoading ? <span>Loading tasks...</span> : null}
                {!tasksLoading && !tasksPermissionDenied ? (
                  <>
                    <div style={{ display: "grid", gap: 4 }}>
                      <strong>Current Task</strong>
                      <div>Status: {taskState?.status ?? "idle"}</div>
                      <div>Action: {taskState?.currentAction ?? "-"}</div>
                      <div>Updated: {taskState?.updatedAt ? formatTimestamp(taskState.updatedAt) : "-"}</div>
                    </div>
                    <div style={{ display: "grid", gap: 4 }}>
                      <strong>Latest Test Request</strong>
                      <div>Status: {taskTestRequest?.status ?? "idle"}</div>
                      <div>Request ID: {taskTestRequest?.requestId ?? "-"}</div>
                      <div>Scope: {taskTestRequest?.scope ?? "-"}</div>
                    </div>
                    <div style={{ display: "grid", gap: 8 }}>
                      <strong>Recent Prompt Actions</strong>
                      {taskPromptActions.length === 0 ? <span>No prompt actions recorded.</span> : null}
                      {taskPromptActions.map((action) => (
                        <div
                          key={action.id}
                          style={{
                            border: `1px solid ${ceryxColors.outlineVariant}`,
                            borderRadius: 8,
                            display: "grid",
                            gap: 4,
                            padding: "8px 10px"
                          }}
                        >
                          <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
                            <StatusChip tone={action.severity === "error" ? "error" : action.severity === "warning" ? "warning" : "success"}>
                              {action.severity}
                            </StatusChip>
                            <strong>{action.action}</strong>
                          </div>
                          <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                            {formatTimestamp(action.createdAt)} | {action.sessionId || "local"}
                          </div>
                          <div>{action.details || "-"}</div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
                {tasksError ? <span style={{ color: "#ffb4a8", fontSize: 12 }}>{tasksError}</span> : null}
              </Panel>
            </div>
          </section>
        </div>
      ) : null}

      {notificationsWorkspaceOpen ? (
        <div
          data-testid="ipad-notifications-workspace"
          style={{
            inset: 0,
            position: "fixed",
            zIndex: 25
          }}
        >
          <div
            style={{
              backgroundColor: "rgba(16, 14, 12, 0.45)",
              inset: 0,
              position: "absolute"
            }}
          />
          <section
            style={{
              backgroundColor: ceryxColors.surface,
              display: "grid",
              gridTemplateRows: "56px 1fr",
              inset: "8px",
              position: "absolute"
            }}
          >
            <header
              style={{
                alignItems: "center",
                borderBottom: `1px solid ${ceryxColors.outlineVariant}`,
                display: "flex",
                justifyContent: "space-between",
                padding: "0 12px"
              }}
            >
              <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
                <strong>Notifications Sheet</strong>
                <StatusChip tone={notificationsUnread > 0 ? "warning" : "success"}>
                  unread {notificationsUnread}
                </StatusChip>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Button size="ipad" variant="secondary" disabled={notificationsLoading} onClick={() => void loadNotifications()}>
                  Refresh
                </Button>
                <Button
                  size="ipad"
                  variant="secondary"
                  disabled={notificationsLoading || notifications.length === 0}
                  onClick={() => void clearAllNotifications()}
                >
                  Clear All
                </Button>
                <Button size="ipad" variant="ghost" onClick={() => setNotificationsWorkspaceOpen(false)}>
                  Close
                </Button>
              </div>
            </header>
            <div style={{ minHeight: 0, overflow: "auto", padding: 12 }}>
              <Panel size="ipad" style={{ display: "grid", gap: 8 }}>
                {notificationsPermissionDenied ? (
                  <span style={{ color: "#ffb4a8", fontSize: 12 }}>
                    Permission denied for notifications.
                  </span>
                ) : null}
                {notificationsLoading ? <span>Loading notifications...</span> : null}
                {!notificationsLoading && !notificationsPermissionDenied && notifications.length === 0 ? (
                  <span>No notifications.</span>
                ) : null}
                {!notificationsLoading && !notificationsPermissionDenied
                  ? notifications.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          border: `1px solid ${ceryxColors.outlineVariant}`,
                          borderRadius: 8,
                          display: "grid",
                          gap: 6,
                          padding: "8px 10px"
                        }}
                      >
                        <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
                          <StatusChip
                            tone={item.read ? "neutral" : item.severity === "error" ? "error" : item.severity === "warning" ? "warning" : "success"}
                          >
                            {item.read ? "read" : "unread"}
                          </StatusChip>
                          <strong>{item.title}</strong>
                        </div>
                        <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                          {formatTimestamp(item.createdAt)} | {item.severity}
                        </div>
                        <div>{item.message}</div>
                        {!item.read ? (
                          <Button
                            size="ipad"
                            variant="secondary"
                            style={{ justifySelf: "start" }}
                            onClick={() => void markNotificationAsRead(item.id)}
                          >
                            Mark Read
                          </Button>
                        ) : null}
                      </div>
                    ))
                  : null}
                {notificationsError ? (
                  <span style={{ color: "#ffb4a8", fontSize: 12 }}>{notificationsError}</span>
                ) : null}
              </Panel>
            </div>
          </section>
        </div>
      ) : null}

      {toolbarVisible ? (
        <div
          data-testid="ipad-bottom-toolbar"
          style={{
            bottom: 16,
            left: "50%",
            position: "fixed",
            transform: "translateX(-50%)",
            width: "min(1040px, calc(100vw - 32px))",
            zIndex: 10
          }}
        >
          <CodexToolbar
            size="ipad"
            connected={connected}
            permissions={remoteSession.permissions}
            recordingActive={recordingActive}
            captureActive={remoteSession.captureState.active}
            busy={toolbarBusy}
            onDiff={() =>
              void openDiffWorkspace()
            }
            onScreenshot={() =>
              void runToolbarAction(async () => {
                const response = await takeScreenshot(activeBaseUrl);
                return { message: `Screenshot saved as ${response.fileName}.` };
              })
            }
            onStop={() => void handleStop()}
            onRecord={() => void handleRecord()}
            onCopyOutput={() =>
              void runToolbarAction(async () => {
                await navigator.clipboard.writeText(
                  `${codexTitle}\nstatus=${remoteSession.status}\nmessage=${viewportMessage}`
                );
                return { message: "Output copied to clipboard." };
              })
            }
            onPasteToWindows={() =>
              void runToolbarAction(() => handlePasteToWindowsClipboard())
            }
            onCopyFromWindows={
              inputLockActive
                ? undefined
                : () => void runToolbarAction(() => handleCopyFromWindowsClipboard())
            }
          />
        </div>
      ) : (
        <div
          style={{
            bottom: 16,
            position: "fixed",
            right: 16,
            zIndex: 10
          }}
        >
          <Button size="ipad" variant="secondary" onClick={() => setToolbarVisible(true)}>
            Show Toolbar
          </Button>
        </div>
      )}

    </section>
  );
}

function IpadVirtualizedLogsList({ entries }: { entries: AgentLogEntry[] }) {
  const viewportHeight = 330;
  const overscan = 5;
  const [scrollTop, setScrollTop] = useState(0);

  const totalHeight = entries.length * ipadLogRowHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / ipadLogRowHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / ipadLogRowHeight) + overscan * 2;
  const endIndex = Math.min(entries.length, startIndex + visibleCount);

  const visibleEntries = useMemo(
    () => entries.slice(startIndex, endIndex),
    [endIndex, entries, startIndex]
  );

  return (
    <div
      data-testid="ipad-logs-virtualized-list"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      style={{
        border: `1px solid ${ceryxColors.outlineVariant}`,
        borderRadius: 10,
        height: viewportHeight,
        overflow: "auto",
        position: "relative"
      }}
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        {visibleEntries.map((entry, index) => {
          const rowIndex = startIndex + index;
          return (
            <div
              key={entry.id}
              style={{
                borderBottom: `1px solid ${ceryxColors.outlineVariant}`,
                display: "grid",
                gap: 4,
                height: ipadLogRowHeight,
                left: 0,
                padding: "8px 10px",
                position: "absolute",
                right: 0,
                top: rowIndex * ipadLogRowHeight
              }}
              title={entry.details}
            >
              <div style={{ display: "flex", fontSize: 12, gap: 8 }}>
                <span style={{ color: logSeverityColor(entry.severity) }}>{entry.severity}</span>
                <span style={{ color: ceryxColors.onSurfaceVariant }}>
                  {formatTimestamp(entry.createdAt)}
                </span>
              </div>
              <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                {entry.sessionId || "local"}
              </div>
              <div
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}
              >
                {entry.action} {entry.details}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function logSeverityColor(severity: string): string {
  switch (severity.toLowerCase()) {
    case "error":
      return "#ffb4a8";
    case "warning":
      return "#ffd37a";
    default:
      return "#8fe3b5";
  }
}

function formatTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  return new Date(parsed).toLocaleString();
}

const ipadFieldStyle: CSSProperties = {
  backgroundColor: ceryxColors.surface,
  border: `1px solid ${ceryxColors.outlineVariant}`,
  borderRadius: 8,
  color: ceryxColors.onSurface,
  height: 36,
  padding: "0 10px"
};

function GestureSettingsEditor({
  activeProfileId,
  bindings,
  captureState,
  onBindingChange,
  onProfileChange,
  onReset,
  profile
}: {
  activeProfileId: string;
  bindings: ReturnType<typeof gestureBindingsForProfile>;
  captureState: Pick<CaptureStateResponse, "width" | "height"> | null | undefined;
  onBindingChange: (bindingId: GestureBindingId, mapping: GestureMapping) => void;
  onProfileChange: (profileId: string) => void;
  onReset: () => void;
  profile: GestureProfile;
}) {
  const previewSurfaceRef = useRef<HTMLDivElement | null>(null);
  const [previewMessage, setPreviewMessage] = useState("Try a gesture on the preview surface.");

  const previewEngine = useGestureEngine({
    enabled: true,
    profile,
    captureState,
    surfaceRef: previewSurfaceRef,
    callbacks: {
      mouseMove: async () => {
        setPreviewMessage("Single-finger drag preview: pointer movement.");
      },
      leftClick: async () => {
        setPreviewMessage("Single-finger tap preview: left click.");
      },
      rightClick: async () => {
        setPreviewMessage("Two-finger tap preview: right click.");
      },
      pressHold: async () => {
        setPreviewMessage("Long press preview: press and hold.");
      },
      scroll: async (request) => {
        setPreviewMessage(`Scroll preview: ${request.deltaY >= 0 ? "down" : "up"} ${Math.abs(request.deltaY)}.`);
      },
      hotkey: async (request) => {
        setPreviewMessage(`Hotkey preview: ${request.keys.join("+")}.`);
      },
      toggleToolbar: async () => {
        setPreviewMessage("Three-finger tap preview: toggle toolbar.");
      }
    },
    onError: (message) => setPreviewMessage(message)
  });

  const profileOptions = [
    defaultGestureProfiles.default,
    defaultGestureProfiles.precision,
    createDefaultCustomGestureProfile()
  ];

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "grid", gap: 10 }}>
        <strong>Gesture Profile</strong>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>Active profile</span>
          <select
            aria-label="Gesture profile"
            value={activeProfileId}
            onChange={(event) => onProfileChange(event.target.value)}
            style={ipadFieldStyle}
          >
            {profileOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <StatusChip tone={activeProfileId === "custom" ? "warning" : "success"}>
            {profile.name}
          </StatusChip>
          <Button size="ipad" variant="secondary" onClick={onReset}>
            Reset to Default
          </Button>
        </div>
        <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
          {activeProfileId === "custom"
            ? "Editing any binding will keep the profile in Custom mode."
            : "Switch to Custom to fine-tune individual gesture bindings."}
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <strong>Gesture Preview</strong>
        <div
          ref={previewSurfaceRef}
          aria-label="Gesture preview area"
          data-testid="ipad-gesture-preview"
          onTouchEnd={previewEngine.onTouchEnd}
          onTouchMove={previewEngine.onTouchMove}
          onTouchStart={previewEngine.onTouchStart}
          style={{
            alignItems: "center",
            background:
              "linear-gradient(135deg, rgba(233, 229, 221, 0.88), rgba(250, 247, 243, 0.96))",
            border: `1px solid ${ceryxColors.outlineVariant}`,
            borderRadius: 14,
            color: ceryxColors.onSurface,
            display: "grid",
            minHeight: 168,
            overflow: "hidden",
            padding: 16,
            touchAction: "none"
          }}
        >
          <div style={{ display: "grid", gap: 8, justifyItems: "center", textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Codex Preview Surface</div>
            <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12, maxWidth: 320 }}>
              {previewMessage}
            </div>
            <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
              {captureState?.width && captureState?.height
                ? `${captureState.width} × ${captureState.height}`
                : "Preview adapts to the live capture size."}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <strong>Gesture Bindings</strong>
        {bindings.map(({ definition, mapping }) => {
          const action = (mapping.action as GestureActionId) ?? "none";
          const params = mapping.params ?? {};
          const showSensitivity = action === "mouse_move" || action === "scroll" || action === "zoom";
          const showInvertScroll = action === "scroll";
          const showZoomMode = action === "zoom";
          const showHotkey = action === "hotkey";

          return (
            <div
              key={definition.id}
              style={{
                border: `1px solid ${ceryxColors.outlineVariant}`,
                borderRadius: 12,
                display: "grid",
                gap: 12,
                padding: 12
              }}
            >
              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ alignItems: "center", display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <strong>{definition.label}</strong>
                  <StatusChip tone={action === "none" ? "neutral" : "success"}>
                    {gestureActionLabel(action)}
                  </StatusChip>
                </div>
                <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>{definition.description}</div>
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>Action</span>
                  <select
                    aria-label={`${definition.label} action`}
                    value={action}
                    onChange={(event) =>
                      onBindingChange(
                        definition.id,
                        buildGestureMappingForAction(event.target.value as GestureActionId, mapping)
                      )
                    }
                    style={ipadFieldStyle}
                  >
                    {gestureActionOptions.map((option) => (
                      <option key={option.id} value={option.id} title={option.description}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                {showSensitivity ? (
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>Sensitivity</span>
                    <input
                      aria-label={`${definition.label} sensitivity`}
                      max={3}
                      min={0.1}
                      step={0.1}
                      type="number"
                      value={params.sensitivity ?? 1}
                      onChange={(event) =>
                        onBindingChange(definition.id, {
                          action,
                          params: {
                            ...params,
                            sensitivity: normalizeGestureSensitivity(event.target.value)
                          }
                        })
                      }
                      style={ipadFieldStyle}
                    />
                  </label>
                ) : null}

                {showInvertScroll ? (
                  <IpadCheckboxRow
                    label="Invert scroll direction"
                    checked={Boolean(params.invertScroll)}
                    onChange={(checked) =>
                      onBindingChange(definition.id, {
                        action,
                        params: {
                          ...params,
                          invertScroll: checked
                        }
                      })
                    }
                  />
                ) : null}

                {showZoomMode ? (
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>Zoom mode</span>
                    <select
                      aria-label={`${definition.label} zoom mode`}
                      value={params.zoomMode ?? "pinch"}
                      onChange={(event) =>
                        onBindingChange(definition.id, {
                          action,
                          params: {
                            ...params,
                            zoomMode: event.target.value === "drag" ? "drag" : "pinch"
                          }
                        })
                      }
                      style={ipadFieldStyle}
                    >
                      <option value="pinch">Pinch</option>
                      <option value="drag">Drag</option>
                    </select>
                  </label>
                ) : null}

                {showHotkey ? (
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>Hotkey</span>
                    <input
                      aria-label={`${definition.label} hotkey`}
                      placeholder="Ctrl+Shift+Z"
                      value={params.hotkey ?? ""}
                      onChange={(event) =>
                        onBindingChange(definition.id, {
                          action,
                          params: {
                            ...params,
                            hotkey: event.target.value
                          }
                        })
                      }
                      style={ipadFieldStyle}
                    />
                  </label>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function buildGestureMappingForAction(
  action: GestureActionId,
  current?: GestureMapping
): GestureMapping {
  const params = current?.params ?? {};

  switch (action) {
    case "mouse_move":
      return {
        action,
        params: {
          sensitivity: normalizeGestureSensitivity(params.sensitivity ?? 1)
        }
      };
    case "scroll":
      return {
        action,
        params: {
          sensitivity: normalizeGestureSensitivity(params.sensitivity ?? 1),
          invertScroll: params.invertScroll ?? false
        }
      };
    case "zoom":
      return {
        action,
        params: {
          sensitivity: normalizeGestureSensitivity(params.sensitivity ?? 1),
          zoomMode: params.zoomMode === "drag" ? "drag" : "pinch"
        }
      };
    case "hotkey":
      return {
        action,
        params: {
          hotkey: params.hotkey ?? ""
        }
      };
    default:
      return { action };
  }
}

function normalizeGestureSensitivity(value: string | number | undefined): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }

  return Math.min(3, Math.max(0.1, parsed));
}

function IpadCheckboxRow({
  label,
  checked,
  onChange,
  disabled = false
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label style={{ alignItems: "center", display: "flex", gap: 8 }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function equalAgentSettings(a: AgentSettingsState, b: AgentSettingsState): boolean {
  return (
    a.httpPort === b.httpPort &&
    a.directTestCommand === b.directTestCommand &&
    a.allowFullscreenCapture === b.allowFullscreenCapture &&
    a.allowClearLogs === b.allowClearLogs &&
    a.defaultCaptureMode === b.defaultCaptureMode
  );
}

function resolveClientShortcutProfileState(settings: ClientSettingsState): ShortcutProfile {
  return resolveShortcutProfile(
    settings.activeShortcutProfile ?? "vscode-style",
    settings.customShortcuts
  );
}

function equalShortcutProfiles(a: ShortcutProfile, b: ShortcutProfile): boolean {
  if (a.id !== b.id) {
    return false;
  }

  return defaultShortcutDefinitions.every(
    (definition) => (a.bindings[definition.id] ?? "") === (b.bindings[definition.id] ?? "")
  );
}

function normalizeGestureProfileId(profileId: string | undefined): string {
  if (profileId === "custom") {
    return "custom";
  }

  if (profileId && profileId in defaultGestureProfiles) {
    return profileId;
  }

  return "default";
}

function resolveClientGestureProfileState(settings: ClientSettingsState): {
  activeProfile: GestureProfile;
  activeProfileId: string;
  customProfile: GestureProfile;
} {
  const activeProfileId = normalizeGestureProfileId(settings.activeGestureProfile);
  const resolvedCustomProfile = settings.customGestures
    ? normalizeGestureProfile(settings.customGestures)
    : createDefaultCustomGestureProfile(
        resolveGestureProfile(
          activeProfileId,
          settings.customGestures ?? createDefaultCustomGestureProfile(defaultGestureProfiles.default)
        )
      );

  return {
    activeProfileId,
    activeProfile: resolveGestureProfile(activeProfileId, resolvedCustomProfile),
    customProfile: resolvedCustomProfile
  };
}

function equalGestureMappings(a: GestureMapping, b: GestureMapping): boolean {
  if (a.action !== b.action) {
    return false;
  }

  const aParams = a.params ?? {};
  const bParams = b.params ?? {};
  return (
    (aParams.sensitivity ?? 1) === (bParams.sensitivity ?? 1) &&
    Boolean(aParams.invertScroll ?? false) === Boolean(bParams.invertScroll ?? false) &&
    (aParams.zoomMode ?? "pinch") === (bParams.zoomMode ?? "pinch") &&
    (aParams.hotkey ?? "") === (bParams.hotkey ?? "")
  );
}

function equalGestureProfiles(a: GestureProfile, b: GestureProfile): boolean {
  const normalizedA = normalizeGestureProfile(a);
  const normalizedB = normalizeGestureProfile(b);

  if (normalizedA.id !== normalizedB.id || normalizedA.name !== normalizedB.name) {
    return false;
  }

  return defaultGestureDefinitions.every((definition) =>
    equalGestureMappings(normalizedA.bindings[definition.id], normalizedB.bindings[definition.id])
  );
}

function equalClientSettings(a: ClientSettingsState, b: ClientSettingsState): boolean {
  const aShortcutProfile = resolveClientShortcutProfileState(a);
  const bShortcutProfile = resolveClientShortcutProfileState(b);
  const aGestureState = resolveClientGestureProfileState(a);
  const bGestureState = resolveClientGestureProfileState(b);
  return (
    a.theme === b.theme &&
    a.compactMode === b.compactMode &&
    a.showLatency === b.showLatency &&
    (a.clipboardAutoSync ?? false) === (b.clipboardAutoSync ?? false) &&
    (a.lockLocalInputWhenCapturing ?? true) === (b.lockLocalInputWhenCapturing ?? true) &&
    a.keyboardShortcuts === b.keyboardShortcuts &&
    a.notificationsEnabled === b.notificationsEnabled &&
    a.logsAutoRefresh === b.logsAutoRefresh &&
    aGestureState.activeProfileId === bGestureState.activeProfileId &&
    equalGestureProfiles(aGestureState.activeProfile, bGestureState.activeProfile) &&
    equalGestureProfiles(aGestureState.customProfile, bGestureState.customProfile) &&
    normalizePreviewRefreshProfile(a.previewRefreshProfile) ===
      normalizePreviewRefreshProfile(b.previewRefreshProfile) &&
    (a.viewportTransport ?? defaultViewportTransport) ===
      (b.viewportTransport ?? defaultViewportTransport) &&
    equalShortcutProfiles(aShortcutProfile, bShortcutProfile)
  );
}

function buildAgentSettingsPatch(
  source: AgentSettingsState,
  next: AgentSettingsState
): AgentSettingsPatch | null {
  const patch: AgentSettingsPatch = {};

  if (source.httpPort !== next.httpPort) {
    patch.httpPort = next.httpPort;
  }

  if (source.directTestCommand !== next.directTestCommand) {
    patch.directTestCommand = next.directTestCommand.trim();
  }

  if (source.allowFullscreenCapture !== next.allowFullscreenCapture) {
    patch.allowFullscreenCapture = next.allowFullscreenCapture;
  }

  if (source.allowClearLogs !== next.allowClearLogs) {
    patch.allowClearLogs = next.allowClearLogs;
  }

  if (source.defaultCaptureMode !== next.defaultCaptureMode) {
    patch.defaultCaptureMode = next.defaultCaptureMode;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

function resolveHighRiskPatchKeys(source: AgentSettingsState, next: AgentSettingsState): string[] {
  const keys: string[] = [];
  if (source.httpPort !== next.httpPort) {
    keys.push("httpPort");
  }
  if (source.directTestCommand !== next.directTestCommand) {
    keys.push("directTestCommand");
  }
  if (source.allowFullscreenCapture !== next.allowFullscreenCapture) {
    keys.push("allowFullscreenCapture");
  }
  if (source.allowClearLogs !== next.allowClearLogs) {
    keys.push("allowClearLogs");
  }
  return keys;
}

function toViewportTokenState(tokenState: "missing" | "valid" | "invalid" | "expired"): "verified" | "missing" | "invalid" | "expired" {
  return tokenState === "valid" ? "verified" : tokenState;
}

function resolveViewportOverlayMessage({
  captureActive,
  hasFrame,
  previewError,
  statusMessage
}: {
  captureActive: boolean;
  hasFrame: boolean;
  previewError: string;
  statusMessage: string;
}): string {
  if (previewError) {
    return hasFrame
      ? `Preview refresh failed. Showing last frame. ${previewError}`
      : previewError;
  }

  if (captureActive) {
    return hasFrame ? "Live viewport preview active." : "Waiting for real frame...";
  }

  if (hasFrame) {
    return "Capture stopped. Last successful frame is frozen.";
  }

  return statusMessage;
}

function decodeBase64ToBlob(content: string, mimeType: string): Blob {
  const markerIndex = content.indexOf("base64,");
  const payload = markerIndex >= 0 ? content.slice(markerIndex + "base64,".length) : content;
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], {
    type: mimeType || "image/png"
  });
}

function readClientSettingsSnapshot(
  storageKey: string,
  fallback: ClientSettingsState
): ClientSettingsState {
  if (typeof window === "undefined") {
    return fallback;
  }

  const raw = window.localStorage.getItem(storageKey);
  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ClientSettingsState>;
    const activeShortcutProfile =
      typeof parsed.activeShortcutProfile === "string"
        ? parsed.activeShortcutProfile
        : (fallback.activeShortcutProfile ?? "vscode-style");
    const customShortcutsSource = parsed.customShortcuts ?? fallback.customShortcuts;
    const activeGestureProfile = normalizeGestureProfileId(
      typeof parsed.activeGestureProfile === "string" ? parsed.activeGestureProfile : fallback.activeGestureProfile
    );
    const customGesturesSource = parsed.customGestures ?? fallback.customGestures;
    return {
      theme: parsed.theme ?? fallback.theme,
      compactMode: parsed.compactMode ?? fallback.compactMode,
      showLatency: parsed.showLatency ?? fallback.showLatency,
      clipboardAutoSync: parsed.clipboardAutoSync ?? fallback.clipboardAutoSync ?? false,
      lockLocalInputWhenCapturing:
        parsed.lockLocalInputWhenCapturing ?? fallback.lockLocalInputWhenCapturing ?? true,
      keyboardShortcuts: parsed.keyboardShortcuts ?? fallback.keyboardShortcuts,
      notificationsEnabled: parsed.notificationsEnabled ?? fallback.notificationsEnabled,
      logsAutoRefresh: parsed.logsAutoRefresh ?? fallback.logsAutoRefresh,
      activeGestureProfile,
      customGestures: customGesturesSource
        ? normalizeGestureProfile(customGesturesSource)
        : createDefaultCustomGestureProfile(
            resolveGestureProfile(
              activeGestureProfile,
              fallback.customGestures ?? createDefaultCustomGestureProfile(defaultGestureProfiles.default)
            )
          ),
      activeShortcutProfile,
      customShortcuts: customShortcutsSource
        ? {
            id: customShortcutsSource.id ?? "custom",
            name: customShortcutsSource.name ?? "Custom",
            bindings: normalizeShortcutBindings(customShortcutsSource.bindings ?? {})
          }
        : undefined,
      previewRefreshProfile: normalizePreviewRefreshProfile(
        parsed.previewRefreshProfile ?? fallback.previewRefreshProfile ?? defaultPreviewRefreshProfile
      ),
      viewportTransport:
        parsed.viewportTransport === "polling" ? "polling" : (fallback.viewportTransport ?? defaultViewportTransport)
    };
  } catch {
    return fallback;
  }
}

function writeClientSettingsSnapshot(storageKey: string, settings: ClientSettingsState): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(settings));
}

function waitMs(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
