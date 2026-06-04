import { ceryxColors } from "@ceryx/design-tokens";
import {
  CeryxApiError,
  normalizePreviewRefreshProfile,
  type CaptureFrameResult,
  type CaptureMode,
  type CodexWindowSnapshot,
  type PreviewRefreshProfile
} from "@ceryx/client-sdk";
import type {
  AgentNotificationEntry,
  AgentLogEntry,
  AgentSettingsPatch,
  AgentSettingsState,
  ClientSettingsState,
  LogsQuery,
  FileTransferEntry,
  RecordingEntryResponse,
  ProjectFileEntry,
  ProjectDiffFileEntry,
  ProjectDiffFileResponse,
  ProjectTaskPromptAction,
  ProjectTaskState,
  ProjectTestRequestState
} from "@ceryx/client-sdk";
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
  useConnectionStore,
  usePromptStore,
  useRemoteSessionStore,
  createDefaultCustomShortcutProfile,
  defaultShortcutDefinitions,
  defaultShortcutProfiles,
  normalizeShortcutBindings,
  resolveShortcutProfile,
  type RecordingMode,
  useViewportPreview,
  useWebRtcViewport
} from "@ceryx/feature-remote-control";
import {
  detectShortcutConflicts,
  normalizeShortcutCombo,
  shortcutBindingsForProfile,
  shortcutEventToCombo,
  useKeyboardShortcuts,
  type ShortcutActionId,
  type ShortcutProfile
} from "@ceryx/feature-remote-control";
import { Button, Panel, StatusChip, Tooltip } from "@ceryx/ui";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  approveFromToolbar,
  defaultLocalAgentBaseUrl,
  focusCodexWindow,
  getCaptureFrame,
  getCaptureState,
  getCodexWindow,
  listCodexWindows,
  probeLocalAgent,
  refreshCodexWindow,
  selectCodexWindow,
  rejectFromToolbar,
  patchAgentSettings,
  sendCaptureSignal,
  clearNotifications,
  deleteAgentFile,
  downloadRecording,
  requestDiffFile,
  requestDiffFiles,
  downloadAgentFile,
  requestLogs,
  requestAgentFiles,
  requestNotifications,
  requestRecordings,
  requestProjectFiles,
  requestProjectTasks,
  requestProjectTest,
  requestSettings,
  markNotificationRead,
  receiveClipboard,
  sendClipboard,
  sendPrompt,
  uploadAgentFile,
  startCapture,
  startRecordingCapture,
  stopCapture,
  stopRecordingCapture,
  takeScreenshot
} from "../platform/desktop/agentGateway";

const sidebarWidthKey = "ceryx.desktop.console.sidebar-width";
const inspectorWidthKey = "ceryx.desktop.console.inspector-width";
const defaultSidebarWidth = 220;
const defaultInspectorWidth = 320;
const panelWidthStep = 24;
const defaultProjectId = "workspace-default";
const defaultLogsPageSize = 100;
const logRowHeight = 56;
const desktopClientSettingsStorageKey = "ceryx.desktop.client-settings.v1";
const defaultPreviewRefreshProfile: PreviewRefreshProfile = "balanced";
const defaultViewportTransport = "webrtc";
const balancedPreviewPollMs = 1000;
const highFrequencyPreviewPollMs = 400;

const desktopSettingsGroups = [
  {
    group: "Workspace",
    sections: [
      { id: "general", label: "General" },
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

type DesktopSettingsSectionId =
  (typeof desktopSettingsGroups)[number]["sections"][number]["id"];

type ViewportMenuState = {
  x: number;
  y: number;
};

const idleCaptureState = {
  ok: true as const,
  active: false,
  paused: false,
  mode: "balanced" as const,
  windowId: null,
  width: 0,
  height: 0
};

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
  const viewportShellRef = useRef<HTMLDivElement | null>(null);
  const viewportMenuRef = useRef<HTMLDivElement | null>(null);
  const recordingPreviewUrlRef = useRef<string | null>(null);
  const [codexTitle, setCodexTitle] = useState("Codex window not loaded");
  const [codexStatus, setCodexStatus] = useState("not_found");
  const [viewportMessage, setViewportMessage] = useState("Refreshing local Agent state...");
  const [recordingActive, setRecordingActive] = useState(false);
  const [recordingAudioActive, setRecordingAudioActive] = useState(false);
  const [recordingMode, setRecordingMode] = useState<RecordingMode>("screen");
  const [recordings, setRecordings] = useState<RecordingEntryResponse[]>([]);
  const [recordingsLoading, setRecordingsLoading] = useState(false);
  const [recordingsError, setRecordingsError] = useState("");
  const [selectedRecordingFileName, setSelectedRecordingFileName] = useState<string | null>(null);
  const [selectedRecordingUrl, setSelectedRecordingUrl] = useState<string | null>(null);
  const [toolbarBusy, setToolbarBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [tokenState, setTokenState] = useState<"missing" | "valid" | "invalid" | "expired">("missing");
  const [viewportMenu, setViewportMenu] = useState<ViewportMenuState | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    readPersistedWidth(sidebarWidthKey, defaultSidebarWidth, 180, 320)
  );
  const [inspectorWidth, setInspectorWidth] = useState(() =>
    readPersistedWidth(inspectorWidthKey, defaultInspectorWidth, 260, 420)
  );
  const [workspaceMode, setWorkspaceMode] = useState<"console" | "diff" | "logs" | "settings" | "files" | "tasks" | "notifications">(
    "console"
  );
  const [diffProjectId, setDiffProjectId] = useState(defaultProjectId);
  const [diffFiles, setDiffFiles] = useState<ProjectDiffFileEntry[]>([]);
  const [diffSearchQuery, setDiffSearchQuery] = useState("");
  const [selectedDiffPath, setSelectedDiffPath] = useState<string | null>(null);
  const [selectedDiff, setSelectedDiff] = useState<ProjectDiffFileResponse | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffFileLoading, setDiffFileLoading] = useState(false);
  const [diffError, setDiffError] = useState("");
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
  const [settingsSection, setSettingsSection] = useState<DesktopSettingsSectionId>("general");
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [settingsNotice, setSettingsNotice] = useState("");
  const [settingsNeedsConfirm, setSettingsNeedsConfirm] = useState(false);
  const [settingsHighRiskKeys, setSettingsHighRiskKeys] = useState<string[]>([]);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [shortcutRecordingAction, setShortcutRecordingAction] = useState<ShortcutActionId | null>(null);
  const [shortcutEditorError, setShortcutEditorError] = useState("");
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
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState("");
  const [tasksPermissionDenied, setTasksPermissionDenied] = useState(false);
  const [taskState, setTaskState] = useState<ProjectTaskState | null>(null);
  const [taskPromptActions, setTaskPromptActions] = useState<ProjectTaskPromptAction[]>([]);
  const [taskTestRequest, setTaskTestRequest] = useState<ProjectTestRequestState | null>(null);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState("");
  const [notificationsPermissionDenied, setNotificationsPermissionDenied] = useState(false);
  const [notifications, setNotifications] = useState<AgentNotificationEntry[]>([]);
  const [notificationsUnread, setNotificationsUnread] = useState(0);
  const [forcePollingFallback, setForcePollingFallback] = useState(false);
  const webRtcVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    setCurrentDevice({
      deviceId: "local-agent",
      deviceName: "Local Windows PC",
      platform: "windows",
      baseUrl: defaultLocalAgentBaseUrl
    });
  }, [setCurrentDevice]);

  useEffect(() => {
    writePersistedWidth(sidebarWidthKey, sidebarWidth);
  }, [sidebarWidth]);

  useEffect(() => {
    writePersistedWidth(inspectorWidthKey, inspectorWidth);
  }, [inspectorWidth]);

  function resolveErrorMessage(error: unknown, fallback: string): string {
    return resolveProtocolError(error, fallback).message;
  }

  function applyConsoleError(error: unknown, fallback: string): string {
    const resolved = resolveProtocolError(error, fallback);

    switch (resolved.state) {
      case "agent_offline":
        setCodexStatus("not_found");
        setCodexTitle("Local Agent offline");
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
          const frame = await getCaptureFrame(defaultLocalAgentBaseUrl, windowId);
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

    const probe = await probeLocalAgent(defaultLocalAgentBaseUrl);
    const canControl = probe.reachable && !!probe.agentStatus;
    const permissions = canControl ? defaultPermissionsForClient("desktop") : [];
    setTokenState(probe.tokenState);

    remoteSession.connectSession({
      sessionId: "desktop-live-console",
      deviceId: "local-agent",
      status: canControl ? "connected" : "error",
      permissions
    });
    remoteSession.setLatency(probe.latencyMs);

    if (!canControl) {
      remoteSession.setCaptureState(idleCaptureState);
      remoteSession.setError(probe.message);
      setCodexStatus(probe.reachable ? "unpaired" : "not_found");
      setCodexTitle(probe.reachable ? "Pairing required" : "Local Agent offline");
      setViewportMessage(probe.message);
      setCodexWindows([]);
      setWindowPreviewUrls({});
      setPipDismissedWindowIds([]);
      setCodexWindowsLoading(false);
      return;
    }

    try {
      const [windowSnapshot, captureState, windowList] = await Promise.all([
        getCodexWindow(defaultLocalAgentBaseUrl),
        getCaptureState(defaultLocalAgentBaseUrl),
        listCodexWindows(defaultLocalAgentBaseUrl)
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
  }, []);

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
  }, [connected]);

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
  const webRtcViewport = useWebRtcViewport({
    enabled: connected && remoteSession.captureState.active && viewportTransport === "webrtc" && !forcePollingFallback,
    sessionKey: `desktop-webrtc:${defaultLocalAgentBaseUrl}`,
    transport: viewportTransport,
    sendSignal: (request) => sendCaptureSignal(request, defaultLocalAgentBaseUrl),
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
    sessionKey: `desktop:${defaultLocalAgentBaseUrl}`,
    fetchFrame: () => getCaptureFrame(defaultLocalAgentBaseUrl),
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
  const canReadDiff = connected && hasPermission(remoteSession.permissions, "read_diff");
  const canRunTest = connected && hasPermission(remoteSession.permissions, "run_test");
  const canScreenshot = connected && hasPermission(remoteSession.permissions, "screenshot");
  const canRecord = connected && hasPermission(remoteSession.permissions, "recording");
  const canCopyOutput = connected && hasPermission(remoteSession.permissions, "copy_output");
  const canViewWindow = connected && hasPermission(remoteSession.permissions, "view_window");
  const canManageAgent = connected && hasPermission(remoteSession.permissions, "manage_agent");
  const settingsReady = agentSettingsDraft !== null && clientSettingsDraft !== null;
  const settingsAgentDirty = agentSettingsDraft !== null
    ? !equalAgentSettings(agentSettingsSource ?? agentSettingsDraft, agentSettingsDraft)
    : false;
  const settingsClientDirty = clientSettingsDraft !== null
    ? !equalClientSettings(clientSettingsSource ?? clientSettingsDraft, clientSettingsDraft)
    : false;
  const settingsDirty = settingsAgentDirty || settingsClientDirty;
  const activeShortcutProfileId =
    clientSettingsDraft?.activeShortcutProfile ??
    clientSettingsSource?.activeShortcutProfile ??
    "vscode-style";
  const activeShortcutProfile = useMemo(
    () =>
      resolveShortcutProfile(
        activeShortcutProfileId,
        clientSettingsDraft?.customShortcuts ?? clientSettingsSource?.customShortcuts
      ),
    [
      activeShortcutProfileId,
      clientSettingsDraft?.customShortcuts,
      clientSettingsSource?.customShortcuts
    ]
  );
  const activeShortcutBindings = useMemo(
    () => shortcutBindingsForProfile(activeShortcutProfile, defaultShortcutDefinitions),
    [activeShortcutProfile]
  );
  const activeShortcutConflicts = useMemo(
    () => detectShortcutConflicts(activeShortcutProfile.bindings),
    [activeShortcutProfile.bindings]
  );
  const keyboardShortcutsEnabled =
    connected && Boolean(clientSettingsDraft?.keyboardShortcuts ?? clientSettingsSource?.keyboardShortcuts);
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

  function isInputLockAllowedTarget(target: EventTarget | null): boolean {
    return target instanceof Element && Boolean(target.closest("[data-input-lock-allow='true']"));
  }

  const filteredDiffFiles = useMemo(() => {
    const query = diffSearchQuery.trim().toLowerCase();
    if (!query) {
      return diffFiles;
    }

    return diffFiles.filter((file) =>
      file.path.toLowerCase().includes(query) ||
      file.status.toLowerCase().includes(query)
    );
  }, [diffFiles, diffSearchQuery]);

  useEffect(() => {
    if (!viewportMenu) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        setViewportMenu(null);
        return;
      }

      if (viewportMenuRef.current?.contains(target)) {
        return;
      }

      setViewportMenu(null);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [viewportMenu]);

  useEffect(() => {
    return () => {
      if (recordingPreviewUrlRef.current) {
        URL.revokeObjectURL(recordingPreviewUrlRef.current);
        recordingPreviewUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!inputLockActive) {
      return;
    }

    const blockLocalInput = (event: Event) => {
      if (isInputLockAllowedTarget(event.target)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
    };

    window.addEventListener("keydown", blockLocalInput, true);
    window.addEventListener("pointerdown", blockLocalInput, true);
    window.addEventListener("wheel", blockLocalInput, true);
    window.addEventListener("paste", blockLocalInput, true);
    window.addEventListener("dragstart", blockLocalInput, true);
    window.addEventListener("drop", blockLocalInput, true);

    return () => {
      window.removeEventListener("keydown", blockLocalInput, true);
      window.removeEventListener("pointerdown", blockLocalInput, true);
      window.removeEventListener("wheel", blockLocalInput, true);
      window.removeEventListener("paste", blockLocalInput, true);
      window.removeEventListener("dragstart", blockLocalInput, true);
      window.removeEventListener("drop", blockLocalInput, true);
    };
  }, [inputLockActive]);

  useEffect(() => {
    return () => {
      Object.values(windowPreviewUrls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [windowPreviewUrls]);

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
      const snapshot = await selectCodexWindow(defaultLocalAgentBaseUrl, windowId);
      setCodexTitle(snapshot.title ?? "Codex");
      setCodexStatus(snapshot.status);

      if (remoteSession.captureState.active) {
        const captureState = await startCapture(defaultLocalAgentBaseUrl, previewCaptureMode, windowId);
        remoteSession.setCaptureState(captureState);
        setViewportMessage("Waiting for real frame...");
      } else {
        setViewportMessage("Window selected. Start capture to load a live frame.");
      }

      return {
        message: `Switched to ${snapshot.title ?? windowId}.`
      };
    });
  }

  function openViewportMenu(position?: ViewportMenuState) {
    if (position) {
      setViewportMenu(position);
      return;
    }

    const bounds = viewportShellRef.current?.getBoundingClientRect();
    setViewportMenu({
      x: bounds ? bounds.left + 24 : 280,
      y: bounds ? bounds.top + 24 : 120
    });
  }

  async function handleSendPrompt(submit: boolean) {
    if (inputLockActive) {
      setFeedback("Local input is locked while capturing.");
      return;
    }

    let historyId = "";

    try {
      historyId = beginSend(submit);
      const response = await sendPrompt(promptDraft.trim(), submit, defaultLocalAgentBaseUrl);
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
        const response = await stopRecordingCapture(defaultLocalAgentBaseUrl);
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

      const response = await startRecordingCapture(defaultLocalAgentBaseUrl, {
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
        const response = await stopRecordingCapture(defaultLocalAgentBaseUrl);
        setRecordingActive(false);
        setRecordingAudioActive(false);
        await loadRecordings(response.fileName);
        return response;
      }

      return stopCapture(defaultLocalAgentBaseUrl);
    }, "Stopped active session control.");
  }

  async function loadRecordings(preferredFileName?: string | null) {
    setRecordingsLoading(true);
    setRecordingsError("");

    try {
      const response = await requestRecordings(defaultLocalAgentBaseUrl, 100);
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
      const blob = await downloadRecording(defaultLocalAgentBaseUrl, fileName);
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
      const blob = await downloadRecording(defaultLocalAgentBaseUrl, fileName);
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

  async function loadDiffFiles(projectId = diffProjectId) {
    setDiffLoading(true);
    setDiffError("");
    try {
      const response = await requestDiffFiles(projectId, defaultLocalAgentBaseUrl);
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
      const response = await requestDiffFile(projectId, path, defaultLocalAgentBaseUrl);
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
    setWorkspaceMode("diff");
    await loadDiffFiles();
  }

  function isTypingContext(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    const tagName = target.tagName;
    return tagName === "INPUT" || tagName === "TEXTAREA" || target.isContentEditable;
  }

  async function moveDiffSelection(offset: number) {
    if (diffFileLoading || filteredDiffFiles.length === 0) {
      return;
    }

    const currentIndex = selectedDiffPath
      ? filteredDiffFiles.findIndex((file) => file.path === selectedDiffPath)
      : -1;
    const normalizedCurrent = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex =
      (normalizedCurrent + offset + filteredDiffFiles.length) % filteredDiffFiles.length;
    const nextFile = filteredDiffFiles[nextIndex];
    if (!nextFile) {
      return;
    }

    await loadDiffFile(diffProjectId, nextFile.path);
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
      const response = await requestLogs(toLogsQuery(pageValue, pageSizeValue), defaultLocalAgentBaseUrl);
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
    setWorkspaceMode("logs");
    await loadLogs(1, logsPageSize);
  }

  async function loadSettingsState() {
    setSettingsLoading(true);
    setSettingsError("");
    try {
      const response = await requestSettings(defaultLocalAgentBaseUrl);
      const persistedClient = readClientSettingsSnapshot(
        desktopClientSettingsStorageKey,
        response.clientSettings
      );
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

  async function openSettingsWorkspace(section: DesktopSettingsSectionId = "general") {
    setWorkspaceMode("settings");
    setSettingsSection(section);
    await loadSettingsState();
  }

  function resolveEditableShortcutProfile(): ShortcutProfile {
    if (!clientSettingsDraft) {
      return createDefaultCustomShortcutProfile(defaultShortcutProfiles["vscode-style"]);
    }

    return resolveShortcutProfile(
      clientSettingsDraft.activeShortcutProfile ?? "vscode-style",
      clientSettingsDraft.customShortcuts
    );
  }

  function updateClientShortcutDraft(nextProfile: ShortcutProfile, activeProfileId = "custom") {
    setClientSettingsDraft((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        activeShortcutProfile: activeProfileId,
        customShortcuts: nextProfile
      };
    });
  }

  function switchShortcutProfile(profileId: string) {
    setShortcutEditorError("");

    if (!clientSettingsDraft) {
      return;
    }

    if (profileId === "custom") {
      const currentProfile = resolveEditableShortcutProfile();
      updateClientShortcutDraft(
        {
          id: "custom",
          name: "Custom",
          bindings: { ...currentProfile.bindings }
        },
        "custom"
      );
      return;
    }

    const preset = defaultShortcutProfiles[profileId as keyof typeof defaultShortcutProfiles];
    if (!preset) {
      return;
    }

    setClientSettingsDraft((current) =>
      current
        ? {
            ...current,
            activeShortcutProfile: preset.id,
            customShortcuts: {
              id: "custom",
              name: "Custom",
              bindings: { ...preset.bindings }
            }
          }
        : current
    );
  }

  function resetShortcutProfile() {
    const preset = defaultShortcutProfiles["vscode-style"];
    setShortcutEditorError("");
    setClientSettingsDraft((current) =>
      current
        ? {
            ...current,
            activeShortcutProfile: preset.id,
            customShortcuts: {
              id: "custom",
              name: "Custom",
              bindings: { ...preset.bindings }
            }
          }
        : current
    );
  }

  function applyShortcutBinding(actionId: ShortcutActionId, combo: string) {
    if (!clientSettingsDraft) {
      return;
    }

    const normalizedCombo = normalizeShortcutCombo(combo);
    if (!normalizedCombo) {
      setShortcutEditorError("Shortcut cannot be empty.");
      return;
    }

    const currentProfile = resolveEditableShortcutProfile();
    const nextProfile: ShortcutProfile = {
      id: "custom",
      name: "Custom",
      bindings: {
        ...currentProfile.bindings,
        [actionId]: normalizedCombo
      }
    };

    const conflicts = detectShortcutConflicts(nextProfile.bindings);
    const conflict = conflicts.find((entry) => entry.actionIds.includes(actionId));
    if (conflict) {
      setShortcutEditorError(`Conflict: ${conflict.combo} is already assigned to ${conflict.actionIds.join(", ")}.`);
      return;
    }

    setShortcutEditorError("");
    updateClientShortcutDraft(nextProfile, "custom");
  }

  function beginShortcutRecording(actionId: ShortcutActionId) {
    if (!clientSettingsDraft) {
      return;
    }

    setShortcutEditorError("");
    if (clientSettingsDraft.activeShortcutProfile !== "custom") {
      const currentProfile = resolveEditableShortcutProfile();
      updateClientShortcutDraft(
        {
          id: "custom",
          name: "Custom",
          bindings: { ...currentProfile.bindings }
        },
        "custom"
      );
    }

    setShortcutRecordingAction(actionId);
  }

  async function loadProjectFiles(query = filesQuery) {
    setFilesLoading(true);
    setFilesError("");
    setFilesPermissionDenied(false);
    try {
      const response = await requestProjectFiles(
        diffProjectId,
        {
          query,
          limit: 600
        },
        defaultLocalAgentBaseUrl
      );
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

  async function loadAgentFiles(path = "uploads") {
    setAgentFilesLoading(true);
    setAgentFilesError("");
    setAgentFilesPermissionDenied(false);
    try {
      const files = await requestAgentFiles(defaultLocalAgentBaseUrl, path, 100);
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

  async function openFilesWorkspace() {
    setWorkspaceMode("files");
    await Promise.all([loadProjectFiles(), loadAgentFiles()]);
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
        defaultLocalAgentBaseUrl,
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
      const blob = await downloadAgentFile(defaultLocalAgentBaseUrl, file.fileId);
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
      await deleteAgentFile(defaultLocalAgentBaseUrl, file.fileId);
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
      const response = await requestProjectTasks(8, defaultLocalAgentBaseUrl);
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
    setWorkspaceMode("tasks");
    await loadProjectTasks();
  }

  async function loadNotifications() {
    setNotificationsLoading(true);
    setNotificationsError("");
    setNotificationsPermissionDenied(false);
    try {
      const response = await requestNotifications(100, defaultLocalAgentBaseUrl);
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
    setWorkspaceMode("notifications");
    await loadNotifications();
  }

  async function markNotificationAsRead(notificationId: string) {
    try {
      await markNotificationRead(notificationId, defaultLocalAgentBaseUrl);
      await loadNotifications();
    } catch (error) {
      setNotificationsError(resolveErrorMessage(error, "Failed to mark notification as read."));
    }
  }

  async function clearAllNotifications() {
    try {
      await clearNotifications(defaultLocalAgentBaseUrl);
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
        writeClientSettingsSnapshot(desktopClientSettingsStorageKey, clientSettingsDraft);
      }

      if (agentPatch) {
        const response = await patchAgentSettings(
          agentPatch,
          confirmHighRisk,
          defaultLocalAgentBaseUrl
        );
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
        const response = await requestLogs(
          toLogsQuery(exportPage, exportPageSize),
          defaultLocalAgentBaseUrl);
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

  function openSelectedDiffInCodex() {
    if (!selectedDiff) {
      return;
    }

    setDraft(
      [
        `Please review this diff and suggest the next change for ${selectedDiff.path}:`,
        "",
        selectedDiff.diffText
      ].join("\n")
    );
    setFeedback("Diff content injected into prompt draft.");
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
        `Explain the intent, risks, and validation plan for ${selectedDiff.path}.`,
        "",
        selectedDiff.diffText
      ].join("\n")
    );
    setFeedback("Explain prompt prepared from selected diff.");
  }

  async function handleCopyOutput() {
    try {
      await navigator.clipboard.writeText(
        `${codexTitle}\nstatus=${remoteSession.status}\nmessage=${viewportMessage}`
      );
      setFeedback("Output copied to clipboard.");
    } catch (error) {
      setFeedback(resolveErrorMessage(error, "Failed to copy output."));
    }
  }

  async function handlePastePrompt() {
    if (inputLockActive) {
      setFeedback("Local input is locked while capturing.");
      return;
    }

    try {
      const text = await navigator.clipboard.readText();
      setDraft(text);
      setFeedback("Prompt pasted from clipboard.");
      setViewportMenu(null);
    } catch (error) {
      setFeedback(resolveErrorMessage(error, "Failed to paste prompt."));
    }
  }

  async function handlePasteToWindowsClipboard() {
    if (!navigator.clipboard?.readText) {
      return { message: "Local clipboard read is unavailable in this browser context." };
    }

    const text = await navigator.clipboard.readText();
    if (!text.trim()) {
      return { message: "Local clipboard is empty." };
    }

    const response = await sendClipboard(
      {
        type: "text",
        content: text,
        mimeType: "text/plain"
      },
      defaultLocalAgentBaseUrl
    );
    return {
      message: `Clipboard sent to Windows (${response.sizeBytes} bytes).`
    };
  }

  async function handleCopyFromWindowsClipboard() {
    if (inputLockActive) {
      return { message: "Local input is locked while capturing." };
    }

    if (!navigator.clipboard) {
      return { message: "Local clipboard access is unavailable in this browser context." };
    }

    const payload = await receiveClipboard(defaultLocalAgentBaseUrl);
    if (payload.type === "text") {
      if (!navigator.clipboard.writeText) {
        return { message: "Local clipboard write is unavailable in this browser context." };
      }

      await navigator.clipboard.writeText(payload.content);
      setDraft(payload.content);
      return { message: "Windows clipboard copied locally and inserted into prompt draft." };
    }

    if (payload.type === "image") {
      if (typeof ClipboardItem === "undefined" || !navigator.clipboard.write) {
        return { message: "Image clipboard is unavailable in this browser." };
      }

      const imageBlob = decodeBase64ToBlob(payload.content, payload.mimeType);
      await navigator.clipboard.write([
        new ClipboardItem({ [payload.mimeType || "image/png"]: imageBlob })
      ]);
      return { message: "Windows image clipboard copied locally." };
    }

    return { message: "Clipboard payload type is not supported on this client." };
  }

  function handleAskCodexToExplain() {
    if (inputLockActive) {
      setFeedback("Local input is locked while capturing.");
      return;
    }

    setDraft(
      [
        "Please explain the current Codex state, summarize the blocker, and propose the next minimal action.",
        "",
        `Window: ${codexTitle}`,
        `Status: ${codexStatus}`,
        `Session: ${remoteSession.status}`,
        `Capture: ${remoteSession.captureState.active ? remoteSession.captureState.mode : "idle"}`,
        `Message: ${viewportMessage}`
      ].join("\n")
    );
    setFeedback("Explain prompt inserted.");
    setViewportMenu(null);
  }

  async function handleReconnectStream() {
    setToolbarBusy(true);
    try {
      await refreshConsole();
      setFeedback("Stream reconnected.");
      setViewportMenu(null);
    } catch (error) {
      setFeedback(resolveErrorMessage(error, "Failed to reconnect stream."));
    } finally {
      setToolbarBusy(false);
    }
  }

  useKeyboardShortcuts({
    enabled: keyboardShortcutsEnabled && !toolbarBusy && !inputLockActive,
    profileId: activeShortcutProfileId,
    customProfile: clientSettingsDraft?.customShortcuts,
    definitions: defaultShortcutDefinitions,
    onAction(actionId) {
      if (actionId === "input.prompt.send") {
        if (!canControlInput) {
          return;
        }

        void runToolbarAction(() => approveFromToolbar(defaultLocalAgentBaseUrl));
        return;
      }

      if (actionId === "navigation.diff") {
        if (!canReadDiff) {
          return;
        }

        void openDiffWorkspace();
        return;
      }

      if (actionId === "navigation.logs") {
        if (!connected) {
          return;
        }

        void openLogsWorkspace();
        return;
      }

      if (actionId === "media.screenshot") {
        if (!canScreenshot) {
          return;
        }

        void runToolbarAction(async () => {
          const response = await takeScreenshot(defaultLocalAgentBaseUrl);
          return { message: `Screenshot saved as ${response.fileName}.` };
        });
        return;
      }

      if (actionId === "clipboard.sendToWindows") {
        if (!canManageAgent) {
          return;
        }

        void runToolbarAction(() => handlePasteToWindowsClipboard());
        return;
      }

      if (actionId === "window.focus") {
        if (!canViewWindow) {
          return;
        }

        void runToolbarAction(async () => {
          const snapshot = await focusCodexWindow(defaultLocalAgentBaseUrl);
          setCodexTitle(snapshot.title ?? "Codex");
          setCodexStatus(snapshot.status);
          return { message: "Codex window focused." };
        });
        return;
      }

      if (actionId === "capture.toggle") {
        if (!canRecord) {
          return;
        }

        void handleRecord();
        return;
      }

      if (actionId === "navigation.settings") {
        void openSettingsWorkspace("shortcuts");
      }
    },
    onHelp: () => setShortcutHelpOpen((current) => !current),
    shouldIgnoreEvent: (event) => shortcutRecordingAction !== null || isTypingContext(event.target)
  });

  useEffect(() => {
    const recordingAction = shortcutRecordingAction;
    if (!recordingAction) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      const lowerKey = event.key.toLowerCase();
      if (["control", "shift", "alt", "meta"].includes(lowerKey)) {
        return;
      }

      event.preventDefault();
      if (event.key === "Escape") {
        setShortcutEditorError("");
        setShortcutRecordingAction(null);
        return;
      }

      const combo = shortcutEventToCombo(event);
      if (!combo) {
        return;
      }

      applyShortcutBinding(recordingAction!, combo);
      setShortcutRecordingAction(null);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [applyShortcutBinding, shortcutRecordingAction]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (toolbarBusy || shortcutRecordingAction !== null) {
        return;
      }

      if (
        workspaceMode === "diff" &&
        canReadDiff &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !isTypingContext(event.target)
      ) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          void moveDiffSelection(1);
          return;
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          void moveDiffSelection(-1);
          return;
        }
      }

      if (!event.ctrlKey && !event.metaKey && event.key === "Escape" && canControlInput) {
        event.preventDefault();
        setViewportMenu(null);
        void runToolbarAction(() => rejectFromToolbar(defaultLocalAgentBaseUrl));
        return;
      }

      if (!event.ctrlKey && !event.metaKey && event.key === "F5") {
        event.preventDefault();
        void handleReconnectStream();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    canControlInput,
    canReadDiff,
    shortcutRecordingAction,
    toolbarBusy,
    workspaceMode,
    isTypingContext,
    moveDiffSelection
  ]);

  return (
    <section
      style={{
        display: "grid",
        gridTemplateRows: "56px auto 1fr auto 36px",
        minHeight: "100vh"
      }}
    >
      <header
        data-input-lock-allow="true"
        style={{
          alignItems: "center",
          backgroundColor: ceryxColors.surfaceContainerLow,
          borderBottom: `1px solid ${ceryxColors.outlineVariant}`,
          display: "flex",
          justifyContent: "space-between",
          padding: "0 18px"
        }}
      >
        <div style={{ alignItems: "center", display: "flex", gap: 14 }}>
          <strong>Ceryx Desktop</strong>
          <StatusChip tone={connected ? "success" : "error"}>
            {connected ? "connected" : "offline"}
          </StatusChip>
          <StatusChip tone={inputLockPreference ? "warning" : "neutral"}>
            input lock: {inputLockPreference ? "on" : "off"}
          </StatusChip>
        </div>
        <div style={{ alignItems: "center", display: "flex", gap: 10 }}>
          <TooltipIconButton label="Open viewport menu" onClick={() => openViewportMenu()}>
            ...
          </TooltipIconButton>
          <Button size="desktop" variant="secondary" onClick={() => navigate("/")}>
            Back to Home
          </Button>
        </div>
      </header>

      <div data-input-lock-allow="true" style={{ padding: "14px 18px 0" }}>
        <CodexToolbar
          connected={connected}
          permissions={remoteSession.permissions}
          recordingActive={recordingActive}
          captureActive={remoteSession.captureState.active}
          busy={toolbarBusy}
          onApprove={() =>
            void runToolbarAction(() => approveFromToolbar(defaultLocalAgentBaseUrl))
          }
          onReject={() =>
            void runToolbarAction(() => rejectFromToolbar(defaultLocalAgentBaseUrl))
          }
          onDiff={() =>
            void openDiffWorkspace()
          }
          onTest={() =>
            void runToolbarAction(async () => {
              const response = await requestProjectTest(defaultLocalAgentBaseUrl);
              return { message: response.message || "Test request submitted." };
            })
          }
          onScreenshot={() =>
            void runToolbarAction(async () => {
              const response = await takeScreenshot(defaultLocalAgentBaseUrl);
              return { message: `Screenshot saved as ${response.fileName}.` };
            })
          }
          onStop={() => void handleStop()}
          onRecord={() => void handleRecord()}
          onCopyOutput={() => void handleCopyOutput()}
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

      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr) ${inspectorWidth}px`,
          minHeight: 0,
          padding: 18
        }}
      >
        <aside
          data-testid="desktop-sidebar-shell"
          data-input-lock-allow="true"
          style={{
            backgroundColor: ceryxColors.surfaceContainerLow,
            border: `1px solid ${ceryxColors.outlineVariant}`,
            borderRadius: 12,
            display: "grid",
            gap: 8,
            padding: 16,
            alignContent: "start",
            width: `${sidebarWidth}px`
          }}
        >
          <div
            style={{
              alignItems: "center",
              display: "flex",
              justifyContent: "space-between"
            }}
          >
            <strong style={{ fontSize: 14 }}>Navigation</strong>
            <div style={{ display: "flex", gap: 6 }}>
              <TooltipIconButton
                label="Shrink sidebar"
                onClick={() =>
                  setSidebarWidth((current) => clampWidth(current - panelWidthStep, 180, 320))
                }
              >
                -
              </TooltipIconButton>
              <TooltipIconButton
                label="Grow sidebar"
                onClick={() =>
                  setSidebarWidth((current) => clampWidth(current + panelWidthStep, 180, 320))
                }
              >
                +
              </TooltipIconButton>
            </div>
          </div>

          <Button size="desktop" variant="ghost" onClick={() => navigate("/")}>
            Home
          </Button>
          <Button size="desktop">Console</Button>
          <Button
            size="desktop"
            variant="ghost"
            disabled={!canReadDiff || diffLoading}
            onClick={() => void openDiffWorkspace()}
          >
            Diff Workspace
          </Button>
          <Button
            size="desktop"
            variant="ghost"
            disabled={!connected || logsLoading}
            onClick={() => void openLogsWorkspace()}
          >
            Logs Workspace
          </Button>
          <Button
            size="desktop"
            variant="ghost"
            disabled={!connected || settingsLoading}
            onClick={() => void openSettingsWorkspace()}
          >
            Settings Workspace
          </Button>
          <Button
            size="desktop"
            variant="ghost"
            disabled={!connected || filesLoading}
            onClick={() => void openFilesWorkspace()}
          >
            Files Workspace
          </Button>
          <Button
            size="desktop"
            variant="ghost"
            disabled={!connected || tasksLoading}
            onClick={() => void openTasksWorkspace()}
          >
            Tasks Workspace
          </Button>
          <Button
            size="desktop"
            variant="ghost"
            disabled={!connected || notificationsLoading}
            onClick={() => void openNotificationsWorkspace()}
          >
            Notifications Workspace
          </Button>
          <Button size="desktop" variant="ghost" disabled>
            Inspector
          </Button>
          <Button size="desktop" variant="ghost" disabled>
            Activity
          </Button>
        </aside>

        <div
          ref={viewportShellRef}
          data-testid="desktop-viewport-shell"
          data-input-lock-allow="true"
          style={{ display: "grid", gap: 12, minWidth: 0 }}
          onContextMenu={(event) => {
            event.preventDefault();
            openViewportMenu({
              x: event.clientX,
              y: event.clientY
            });
          }}
        >
          <CodexWindowSwitcher
            size="desktop"
            title="Codex Window Tabs"
            variant="tabs"
            windows={codexWindows}
            activeWindowId={activeWindowId}
            previewUrls={windowPreviewUrls}
            loading={codexWindowsLoading}
            error={codexWindowsError}
            disabled={!connected}
            onSelectWindow={(windowId) => void selectWindow(windowId)}
            onRefresh={() => void refreshConsole()}
          />

          <RemoteViewport
            deviceName={currentDevice?.deviceName ?? "Local Windows PC"}
            sessionStatus={remoteSession.status}
            codexStatus={codexStatus}
            captureState={remoteSession.captureState}
            latencyMs={remoteSession.latencyMs}
            frameRate={remoteSession.captureState.frameRate ?? null}
            tokenState={toViewportTokenState(tokenState)}
            recordingActive={recordingActive}
            lastError={remoteSession.lastError}
            disabled={!connected}
            onFocusWindow={() =>
              void runToolbarAction(async () => {
                const snapshot = await focusCodexWindow(defaultLocalAgentBaseUrl);
                setCodexTitle(snapshot.title ?? "Codex");
                setCodexStatus(snapshot.status);
                return { message: "Codex window focused." };
              })
            }
            onRefreshWindow={() =>
              void runToolbarAction(async () => {
                const snapshot = await refreshCodexWindow(defaultLocalAgentBaseUrl);
                setCodexTitle(snapshot.title ?? "Codex");
                setCodexStatus(snapshot.status);
                return { message: "Codex window refreshed." };
              })
            }
            onToggleCapture={() =>
              void runToolbarAction(async () => {
                const response = remoteSession.captureState.active
                  ? await stopCapture(defaultLocalAgentBaseUrl)
                  : await startCapture(defaultLocalAgentBaseUrl, previewCaptureMode, activeWindowId ?? undefined);
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
              data-testid="desktop-viewport-surface"
              style={{
                minHeight: 260,
                overflow: "hidden",
                position: "relative"
              }}
            >
              {webRtcViewport.stream ? (
                <video
                  ref={webRtcVideoRef}
                  autoPlay
                  muted
                  playsInline
                  data-testid="desktop-viewport-video"
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
              {!webRtcViewport.stream && viewportPreview.frameUrl ? (
                <img
                  alt="Codex viewport frame"
                  data-testid="desktop-viewport-frame"
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
              <div
                style={{
                  background: webRtcViewport.stream || viewportPreview.frameUrl
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
                <strong style={{ fontSize: 18 }}>{codexTitle}</strong>
                <div style={{ color: "#d0c7bf", maxWidth: 520 }}>{viewportOverlayMessage}</div>
                <div style={{ color: "#d0c7bf", fontSize: 13 }}>
                  session={remoteSession.sessionId || "n/a"} | capture=
                  {remoteSession.captureState.active ? remoteSession.captureState.mode : "idle"} | frame=
                  {webRtcViewport.stream ? "webrtc-live" : viewportPreview.capturedAt || "none"}
                </div>
              </div>

              {pipWindow ? (
                <CodexWindowPipPreview
                  size="desktop"
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
        </div>

        <Panel
          data-testid="desktop-inspector-shell"
          style={{
            display: "grid",
            gap: 14,
            alignContent: "start",
            width: `${inspectorWidth}px`
          }}
        >
          <div
            style={{
              alignItems: "center",
              display: "flex",
              justifyContent: "space-between"
            }}
          >
            <strong style={{ fontSize: 18 }}>Inspector</strong>
            <div style={{ display: "flex", gap: 6 }}>
              <TooltipIconButton
                label="Shrink inspector"
                onClick={() =>
                  setInspectorWidth((current) => clampWidth(current - panelWidthStep, 260, 420))
                }
              >
                -
              </TooltipIconButton>
              <TooltipIconButton
                label="Grow inspector"
                onClick={() =>
                  setInspectorWidth((current) => clampWidth(current + panelWidthStep, 260, 420))
                }
              >
                +
              </TooltipIconButton>
            </div>
          </div>

          <div style={{ color: ceryxColors.onSurfaceVariant, display: "grid", gap: 8 }}>
            <div>Device: {currentDevice?.deviceName ?? "Local Windows PC"}</div>
            <div>Base URL: {currentDevice?.baseUrl ?? defaultLocalAgentBaseUrl}</div>
            <div>Session: {remoteSession.sessionId || "desktop-live-console"}</div>
            <div>
              Latency:{" "}
              {typeof remoteSession.latencyMs === "number"
                ? `${remoteSession.latencyMs} ms`
                : "-"}
            </div>
            <div>
              Frame rate:{" "}
              {typeof remoteSession.captureState.frameRate === "number"
                ? `${remoteSession.captureState.frameRate} fps`
                : "-"}
            </div>
            <div>Token verified: {tokenState === "valid" ? "yes" : "no"}</div>
            <div>Recording: {recordingActive ? "active" : "idle"}</div>
            <div>Capture: {remoteSession.captureState.active ? "active" : "idle"}</div>
          </div>

          <RecordingPanel
            size="desktop"
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
              style={{
                backgroundColor: ceryxColors.surfaceContainerLow,
                borderColor: ceryxColors.outlineVariant
              }}
            >
              <p style={{ margin: 0 }}>{feedback}</p>
            </Panel>
          ) : null}
        </Panel>
      </div>

      <div style={{ padding: "0 18px 14px" }}>
        <PromptComposer
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

      <footer
        style={{
          alignItems: "center",
          backgroundColor: ceryxColors.surfaceContainerLow,
          borderTop: `1px solid ${ceryxColors.outlineVariant}`,
          color: ceryxColors.onSurfaceVariant,
          display: "flex",
          fontSize: 12,
          gap: 18,
          padding: "0 16px"
        }}
      >
        <span>connection: {connected ? "connected" : "offline"}</span>
        <span>console: {remoteSession.status}</span>
        <span>codex: {codexStatus}</span>
        <span>
          latency:{" "}
          {typeof remoteSession.latencyMs === "number"
            ? `${remoteSession.latencyMs} ms`
            : "-"}
        </span>
        <span>
          fps:{" "}
          {typeof remoteSession.captureState.frameRate === "number"
            ? remoteSession.captureState.frameRate
            : "-"}
        </span>
        <span>token: {tokenState === "valid" ? "verified" : tokenState}</span>
        <span>recording: {recordingActive ? "active" : "idle"}</span>
        <span>
          capture: {remoteSession.captureState.active ? remoteSession.captureState.mode : "idle"}
        </span>
        <span>prompt history: {history.length}</span>
      </footer>

      {workspaceMode === "diff" ? (
        <div
          data-testid="desktop-diff-workspace"
          style={{
            inset: 0,
            position: "fixed",
            zIndex: 30
          }}
        >
          <div
            style={{
              backgroundColor: "rgba(16, 14, 12, 0.45)",
              inset: 0,
              position: "absolute"
            }}
            onClick={() => setWorkspaceMode("console")}
          />
          <section
            style={{
              backgroundColor: ceryxColors.surface,
              borderLeft: `1px solid ${ceryxColors.outlineVariant}`,
              display: "grid",
              gridTemplateRows: "56px 1fr",
              inset: "12px 12px 12px 12px",
              position: "absolute"
            }}
          >
            <header
              data-input-lock-allow="true"
              style={{
                alignItems: "center",
                borderBottom: `1px solid ${ceryxColors.outlineVariant}`,
                display: "flex",
                justifyContent: "space-between",
                padding: "0 16px"
              }}
            >
              <strong>Diff Workspace</strong>
              <div style={{ display: "flex", gap: 8 }}>
                <Button
                  size="desktop"
                  variant="secondary"
                  disabled={diffLoading}
                  onClick={() => void loadDiffFiles()}
                >
                  Refresh Files
                </Button>
                <Button size="desktop" variant="ghost" onClick={() => setWorkspaceMode("console")}>
                  Close
                </Button>
              </div>
            </header>

            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "300px minmax(0, 1fr) 300px",
                minHeight: 0,
                padding: 12
              }}
            >
              <Panel
                style={{
                  display: "grid",
                  gap: 10,
                  minHeight: 0,
                  overflowY: "auto"
                }}
              >
                <strong>Changed Files</strong>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                    Search
                  </span>
                  <input
                    data-testid="desktop-diff-search-input"
                    value={diffSearchQuery}
                    onChange={(event) => setDiffSearchQuery(event.target.value)}
                    placeholder="Filter by path or status..."
                    style={fieldStyle}
                  />
                </label>
                <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                  showing {filteredDiffFiles.length} / {diffFiles.length}
                </div>
                {diffLoading ? <div>Loading changed files...</div> : null}
                {!diffLoading && diffFiles.length === 0 ? <div>No changed files.</div> : null}
                {!diffLoading && diffFiles.length > 0 && filteredDiffFiles.length === 0 ? (
                  <div>No files match the current filter.</div>
                ) : null}
                {!diffLoading
                  ? filteredDiffFiles.map((file) => (
                      <button
                        key={file.path}
                        style={{
                          alignItems: "center",
                          backgroundColor:
                            file.path === selectedDiffPath
                              ? ceryxColors.surfaceContainerLow
                              : ceryxColors.surface,
                          border: `1px solid ${ceryxColors.outlineVariant}`,
                          borderRadius: 8,
                          color: ceryxColors.onSurface,
                          cursor: "pointer",
                          display: "grid",
                          gap: 4,
                          justifyItems: "start",
                          padding: "8px 10px"
                        }}
                        onClick={() => void loadDiffFile(diffProjectId, file.path)}
                      >
                        <strong style={{ fontSize: 12 }}>{file.path}</strong>
                        <span style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                          {file.status} | +{file.additions} / -{file.deletions}
                        </span>
                      </button>
                    ))
                  : null}
              </Panel>

              <Panel
                style={{
                  backgroundColor: "#111014",
                  borderColor: ceryxColors.outlineVariant,
                  color: "#e9e4dd",
                  display: "grid",
                  gridTemplateRows: "auto 1fr",
                  minHeight: 0
                }}
              >
                <div
                  style={{
                    alignItems: "center",
                    display: "flex",
                    justifyContent: "space-between",
                    paddingBottom: 10
                  }}
                >
                  <strong style={{ color: "#f5efe8" }}>
                    {selectedDiff?.path ?? "Select a file to view diff"}
                  </strong>
                  <Button
                    size="desktop"
                    variant="ghost"
                    disabled={!selectedDiff || diffFileLoading}
                    onClick={() => void copyCurrentDiff()}
                  >
                    Copy Diff
                  </Button>
                </div>
                <pre
                  style={{
                    backgroundColor: "#0b0a0f",
                    border: "1px solid #2f2a36",
                    borderRadius: 10,
                    fontFamily: "Consolas, Monaco, 'Courier New', monospace",
                    fontSize: 12,
                    margin: 0,
                    minHeight: 0,
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
                  <div style={{ color: "#d0c7bf", fontSize: 12, marginTop: 8 }}>
                    Diff truncated at {selectedDiff.lineLimit} lines.
                  </div>
                ) : null}
                {diffError ? (
                  <div style={{ color: "#ffb4a8", fontSize: 12, marginTop: 8 }}>{diffError}</div>
                ) : null}
              </Panel>

              <Panel style={{ display: "grid", gap: 10, alignContent: "start" }}>
                <strong>Review Tools</strong>
                <div style={{ display: "grid", gap: 6, gridTemplateColumns: "1fr 1fr" }}>
                  <Button
                    size="desktop"
                    variant="secondary"
                    disabled={filteredDiffFiles.length === 0 || diffFileLoading}
                    onClick={() => void moveDiffSelection(-1)}
                  >
                    Previous File
                  </Button>
                  <Button
                    size="desktop"
                    variant="secondary"
                    disabled={filteredDiffFiles.length === 0 || diffFileLoading}
                    onClick={() => void moveDiffSelection(1)}
                  >
                    Next File
                  </Button>
                </div>
                <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                  Keyboard: `ArrowUp` / `ArrowDown` to switch files.
                </div>
                <Button
                  size="desktop"
                  variant="secondary"
                  disabled={!selectedDiff || inputLockActive}
                  onClick={() => askCodexToExplainDiff()}
                >
                  Ask Codex to Explain
                </Button>
                <Button
                  size="desktop"
                  variant="secondary"
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
                <Button
                  size="desktop"
                  variant="secondary"
                  disabled={!selectedDiff}
                  onClick={() => void copyCurrentDiff()}
                >
                  Copy Diff
                </Button>
                <Button
                  size="desktop"
                  variant="secondary"
                  disabled={!selectedDiff || inputLockActive}
                  onClick={() => openSelectedDiffInCodex()}
                >
                  Open in Codex
                </Button>
              </Panel>
            </div>
          </section>
        </div>
      ) : null}

      {workspaceMode === "logs" ? (
        <div
          data-testid="desktop-logs-workspace"
          style={{
            inset: 0,
            position: "fixed",
            zIndex: 31
          }}
        >
          <div
            style={{
              backgroundColor: "rgba(16, 14, 12, 0.45)",
              inset: 0,
              position: "absolute"
            }}
            onClick={() => setWorkspaceMode("console")}
          />
          <section
            style={{
              backgroundColor: ceryxColors.surface,
              borderLeft: `1px solid ${ceryxColors.outlineVariant}`,
              display: "grid",
              gridTemplateRows: "56px auto 1fr auto",
              inset: "12px",
              position: "absolute"
            }}
          >
            <header
              style={{
                alignItems: "center",
                borderBottom: `1px solid ${ceryxColors.outlineVariant}`,
                display: "flex",
                justifyContent: "space-between",
                padding: "0 16px"
              }}
            >
              <strong>Logs Workspace</strong>
              <div style={{ display: "flex", gap: 8 }}>
                <Button size="desktop" variant="secondary" disabled={logsLoading} onClick={() => void loadLogs()}>
                  Refresh
                </Button>
                <Button size="desktop" variant="ghost" onClick={() => setWorkspaceMode("console")}>
                  Close
                </Button>
              </div>
            </header>

            <div
              style={{
                alignItems: "end",
                borderBottom: `1px solid ${ceryxColors.outlineVariant}`,
                display: "grid",
                gap: 10,
                gridTemplateColumns: "160px 1fr 1fr auto auto auto",
                padding: 12
              }}
            >
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
                    height: 34,
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
                    height: 34,
                    padding: "0 10px"
                  }}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
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
                    height: 34,
                    padding: "0 10px"
                  }}
                />
              </label>
              <Button
                size="desktop"
                variant="secondary"
                disabled={logsLoading}
                onClick={() => void loadLogs(1, logsPageSize)}
              >
                Apply Filters
              </Button>
              <Button
                size="desktop"
                variant="secondary"
                disabled={logsLoading || logs.length === 0}
                onClick={() => void copyVisibleLogs()}
              >
                Copy Visible
              </Button>
              <Button
                size="desktop"
                variant="secondary"
                disabled={logsExporting || logsLoading}
                onClick={() => void exportLogsSnapshot()}
              >
                {logsExporting ? "Exporting..." : "Export Logs"}
              </Button>
            </div>

            <div style={{ minHeight: 0, overflow: "hidden", padding: 12 }}>
              <Panel style={{ display: "grid", gap: 10, minHeight: "100%" }}>
                <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                  total={logsTotal} page={logsPage} pageSize={logsPageSize}
                </div>
                {logsLoading ? <div>Loading logs...</div> : null}
                {!logsLoading && logs.length === 0 ? <div>No logs for current filters.</div> : null}
                <VirtualizedLogsList entries={logs} />
                {logsError ? (
                  <div style={{ color: "#ffb4a8", fontSize: 12 }}>{logsError}</div>
                ) : null}
              </Panel>
            </div>

            <div
              style={{
                alignItems: "center",
                borderTop: `1px solid ${ceryxColors.outlineVariant}`,
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
                padding: 12
              }}
            >
              <Button
                size="desktop"
                variant="ghost"
                disabled={logsLoading || logsPage <= 1}
                onClick={() => void loadLogs(logsPage - 1, logsPageSize)}
              >
                Previous
              </Button>
              <Button
                size="desktop"
                variant="ghost"
                disabled={logsLoading || !logsHasMore}
                onClick={() => void loadLogs(logsPage + 1, logsPageSize)}
              >
                Next
              </Button>
            </div>
          </section>
        </div>
      ) : null}

      {workspaceMode === "settings" ? (
        <div
          data-testid="desktop-settings-workspace"
          style={{
            inset: 0,
            position: "fixed",
            zIndex: 32
          }}
        >
          <div
            style={{
              backgroundColor: "rgba(16, 14, 12, 0.45)",
              inset: 0,
              position: "absolute"
            }}
            onClick={() => setWorkspaceMode("console")}
          />
          <section
            style={{
              backgroundColor: ceryxColors.surface,
              borderLeft: `1px solid ${ceryxColors.outlineVariant}`,
              display: "grid",
              gridTemplateRows: "56px 1fr",
              inset: "12px",
              position: "absolute"
            }}
          >
            <header
              style={{
                alignItems: "center",
                borderBottom: `1px solid ${ceryxColors.outlineVariant}`,
                display: "flex",
                justifyContent: "space-between",
                padding: "0 16px"
              }}
            >
              <div style={{ alignItems: "center", display: "flex", gap: 10 }}>
                <strong>Settings Workspace</strong>
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
                  size="desktop"
                  variant="secondary"
                  disabled={settingsLoading || settingsSaving}
                  onClick={() => void loadSettingsState()}
                >
                  Refresh
                </Button>
                <Button
                  size="desktop"
                  variant="secondary"
                  disabled={settingsLoading || settingsSaving || !clientSettingsDraft}
                  onClick={() => updateInputLockPreference(!inputLockPreference)}
                >
                  {inputLockPreference ? "Unlock Input" : "Lock Input"}
                </Button>
                <Button
                  size="desktop"
                  variant="secondary"
                  disabled={
                    settingsSaving ||
                    settingsLoading ||
                    !settingsDirty ||
                    (settingsAgentDirty && !canManageAgent)
                  }
                  onClick={() => void saveSettings()}
                >
                  Save
                </Button>
                <Button size="desktop" variant="ghost" onClick={() => setWorkspaceMode("console")}>
                  Close
                </Button>
              </div>
            </header>

            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "260px minmax(0, 1fr)",
                minHeight: 0,
                padding: 12
              }}
            >
              <Panel style={{ display: "grid", gap: 12, minHeight: 0, overflowY: "auto" }}>
                {desktopSettingsGroups.map((group) => (
                  <div key={group.group} style={{ display: "grid", gap: 8 }}>
                    <div
                      style={{
                        color: ceryxColors.onSurfaceVariant,
                        fontSize: 12,
                        letterSpacing: 0.3,
                        textTransform: "uppercase"
                      }}
                    >
                      {group.group}
                    </div>
                    {group.sections.map((section) => (
                      <Button
                        key={section.id}
                        size="desktop"
                        variant={settingsSection === section.id ? "primary" : "ghost"}
                        style={{ justifyContent: "flex-start" }}
                        onClick={() => setSettingsSection(section.id)}
                      >
                        {section.label}
                      </Button>
                    ))}
                  </div>
                ))}
              </Panel>

              <Panel style={{ display: "grid", gap: 12, minHeight: 0, overflowY: "auto" }}>
                {!settingsReady ? (
                  <div style={{ color: ceryxColors.onSurfaceVariant }}>
                    {settingsLoading ? "Loading settings..." : "Settings unavailable."}
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 14 }}>
                    {settingsSection === "general" ? (
                      <div style={{ display: "grid", gap: 12 }}>
                        <strong>General</strong>
                        <label style={{ display: "grid", gap: 4, maxWidth: 320 }}>
                          <span style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>Theme</span>
                          <select
                            value={clientSettingsDraft.theme}
                            disabled={inputLockActive}
                            onChange={(event) =>
                              setClientSettingsDraft((current) =>
                                current ? { ...current, theme: event.target.value } : current
                              )
                            }
                            style={fieldStyle}
                          >
                            <option value="system">system</option>
                            <option value="light">light</option>
                            <option value="dark">dark</option>
                          </select>
                        </label>
                        <CheckboxRow
                          label="Compact mode"
                          checked={clientSettingsDraft.compactMode}
                          disabled={inputLockActive}
                          onChange={(checked) =>
                            setClientSettingsDraft((current) =>
                              current ? { ...current, compactMode: checked } : current
                            )
                          }
                        />
                        <CheckboxRow
                          label="Show latency in inspector"
                          checked={clientSettingsDraft.showLatency}
                          disabled={inputLockActive}
                          onChange={(checked) =>
                            setClientSettingsDraft((current) =>
                              current ? { ...current, showLatency: checked } : current
                            )
                          }
                        />
                        <CheckboxRow
                          label="Lock local input while capturing"
                          checked={inputLockPreference}
                          disabled={inputLockActive}
                          onChange={(checked) => updateInputLockPreference(checked)}
                        />
                      </div>
                    ) : null}

                    {settingsSection === "agent" ? (
                      <div style={{ display: "grid", gap: 12 }}>
                        <strong>Agent</strong>
                        <label style={{ display: "grid", gap: 4, maxWidth: 220 }}>
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
                            style={fieldStyle}
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
                              ...fieldStyle,
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
                      <div style={{ display: "grid", gap: 10 }}>
                        <strong>Connection</strong>
                        <div>Device: {currentDevice?.deviceName ?? "Local Windows PC"}</div>
                        <div>Base URL: {currentDevice?.baseUrl ?? defaultLocalAgentBaseUrl}</div>
                        <div>Session: {remoteSession.sessionId || "desktop-live-console"}</div>
                        <div>Status: {remoteSession.status}</div>
                      </div>
                    ) : null}

                    {settingsSection === "permissions" ? (
                      <div style={{ display: "grid", gap: 12 }}>
                        <strong>Permissions</strong>
                        <CheckboxRow
                          label="Keyboard shortcuts enabled"
                          checked={clientSettingsDraft.keyboardShortcuts}
                          disabled={inputLockActive}
                          onChange={(checked) =>
                            setClientSettingsDraft((current) =>
                              current ? { ...current, keyboardShortcuts: checked } : current
                            )
                          }
                        />
                        <CheckboxRow
                          label="Desktop notifications enabled"
                          checked={clientSettingsDraft.notificationsEnabled}
                          disabled={inputLockActive}
                          onChange={(checked) =>
                            setClientSettingsDraft((current) =>
                              current ? { ...current, notificationsEnabled: checked } : current
                            )
                          }
                        />
                        <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                          Agent write permissions require `manage_agent`.
                        </div>
                      </div>
                    ) : null}

                    {settingsSection === "capture" ? (
                      <div style={{ display: "grid", gap: 12 }}>
                        <strong>Capture</strong>
                        <label style={{ display: "grid", gap: 4, maxWidth: 320 }}>
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
                            style={fieldStyle}
                          >
                            <option value="balanced">balanced (1000 ms)</option>
                            <option value="high_frequency">high_frequency (400 ms)</option>
                          </select>
                        </label>
                        <label style={{ display: "grid", gap: 4, maxWidth: 320 }}>
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
                            style={fieldStyle}
                          >
                            <option value="webrtc">webrtc (default)</option>
                            <option value="polling">polling fallback only</option>
                          </select>
                        </label>
                        <label style={{ display: "grid", gap: 4, maxWidth: 320 }}>
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
                            style={fieldStyle}
                          >
                            <option value="balanced">balanced</option>
                            <option value="performance">performance</option>
                            <option value="high_quality">high_quality</option>
                          </select>
                        </label>
                        <CheckboxRow
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
                      <div style={{ display: "grid", gap: 14 }}>
                        <div style={{ display: "grid", gap: 12 }}>
                          <strong>Shortcuts</strong>
                          <CheckboxRow
                            label="Enable keyboard shortcuts"
                            checked={clientSettingsDraft.keyboardShortcuts}
                            onChange={(checked) =>
                              setClientSettingsDraft((current) =>
                                current ? { ...current, keyboardShortcuts: checked } : current
                              )
                            }
                          />
                        </div>

                        <ShortcutProfileEditor
                          profileId={activeShortcutProfileId}
                          bindings={activeShortcutBindings}
                          conflicts={activeShortcutConflicts}
                          recordingAction={shortcutRecordingAction}
                          error={shortcutEditorError}
                          onProfileChange={switchShortcutProfile}
                          onReset={resetShortcutProfile}
                          onBeginRecording={beginShortcutRecording}
                        />
                      </div>
                    ) : null}

                    {settingsSection === "logs" ? (
                      <div style={{ display: "grid", gap: 12 }}>
                        <strong>Logs</strong>
                        <CheckboxRow
                          label="Auto refresh logs workspace"
                          checked={clientSettingsDraft.logsAutoRefresh}
                          onChange={(checked) =>
                            setClientSettingsDraft((current) =>
                              current ? { ...current, logsAutoRefresh: checked } : current
                            )
                          }
                        />
                        <CheckboxRow
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
                      <div style={{ display: "grid", gap: 10 }}>
                        <strong>About</strong>
                        <div>Ceryx Desktop v0.3</div>
                        <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                          Settings were last synced at {settingsUpdatedAt ? formatTimestamp(settingsUpdatedAt) : "-"}.
                        </div>
                        <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                          Client settings are stored locally on this device.
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}

                {settingsNeedsConfirm ? (
                  <Panel
                    style={{
                      backgroundColor: ceryxColors.surfaceContainerLow,
                      borderColor: ceryxColors.outlineVariant,
                      display: "grid",
                      gap: 8
                    }}
                  >
                    <strong style={{ fontSize: 13 }}>High-risk change confirmation required</strong>
                    <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                      {settingsHighRiskKeys.length > 0
                        ? `Keys: ${settingsHighRiskKeys.join(", ")}`
                        : "Agent returned confirm requirement."}
                    </div>
                    <Button
                      size="desktop"
                      disabled={settingsSaving || !canManageAgent}
                      onClick={() => void saveSettings(true)}
                    >
                      Confirm and Save
                    </Button>
                  </Panel>
                ) : null}

                {settingsError ? (
                  <div style={{ color: "#ffb4a8", fontSize: 12 }}>{settingsError}</div>
                ) : null}
                {settingsNotice ? (
                  <div style={{ color: "#8fe3b5", fontSize: 12 }}>{settingsNotice}</div>
                ) : null}
              </Panel>
            </div>
          </section>
        </div>
      ) : null}

      {workspaceMode === "files" ? (
        <div
          data-testid="desktop-files-workspace"
          style={{
            inset: 0,
            position: "fixed",
            zIndex: 33
          }}
        >
          <div
            style={{
              backgroundColor: "rgba(16, 14, 12, 0.45)",
              inset: 0,
              position: "absolute"
            }}
            onClick={() => setWorkspaceMode("console")}
          />
          <section
            style={{
              backgroundColor: ceryxColors.surface,
              display: "grid",
              gridTemplateRows: "56px auto 1fr",
              inset: "12px",
              position: "absolute"
            }}
          >
            <header
              style={{
                alignItems: "center",
                borderBottom: `1px solid ${ceryxColors.outlineVariant}`,
                display: "flex",
                justifyContent: "space-between",
                padding: "0 16px"
              }}
            >
              <strong>Files Workspace</strong>
              <div style={{ display: "flex", gap: 8 }}>
                <Button
                  size="desktop"
                  variant="secondary"
                  disabled={filesLoading}
                  onClick={() => void loadProjectFiles()}
                >
                  Refresh
                </Button>
                <Button size="desktop" variant="ghost" onClick={() => setWorkspaceMode("console")}>
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
                placeholder="Filter by path..."
                style={fieldStyle}
              />
              <Button size="desktop" onClick={() => void loadProjectFiles(filesQuery)}>
                Search
              </Button>
            </div>
            <div style={{ minHeight: 0, overflow: "auto", padding: 12 }}>
              <div style={{ display: "grid", gap: 12 }}>
                <Panel style={{ display: "grid", gap: 10 }}>
                  {filesPermissionDenied ? (
                    <div style={{ color: "#ffb4a8", fontSize: 13 }}>
                      Permission denied. This workspace requires `read_diff`.
                    </div>
                  ) : null}
                  {filesLoading ? <div>Loading project files...</div> : null}
                  {!filesLoading && !filesPermissionDenied && projectFiles.length === 0 ? (
                    <div>No files found for the current filter.</div>
                  ) : null}
                  {!filesLoading && !filesPermissionDenied
                    ? projectFiles.map((file) => (
                        <div
                          key={file.path}
                          style={{
                            alignItems: "center",
                            border: `1px solid ${ceryxColors.outlineVariant}`,
                            borderRadius: 8,
                            display: "grid",
                            gap: 8,
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
                  {filesError ? <div style={{ color: "#ffb4a8", fontSize: 12 }}>{filesError}</div> : null}
                </Panel>

                <Panel data-testid="desktop-agent-file-transfer" style={{ display: "grid", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <strong>Agent File Transfers</strong>
                    <div style={{ display: "flex", gap: 8 }}>
                      <Button
                        size="desktop"
                        variant="secondary"
                        disabled={agentFilesLoading}
                        onClick={() => void loadAgentFiles()}
                      >
                        Refresh Uploads
                      </Button>
                      <Button
                        size="desktop"
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
                    <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 13 }}>
                      Drop a file here or choose one below. Files up to 100 MB are supported.
                    </div>
                    <input
                      aria-label="Transfer file input"
                      onChange={(event) => setTransferFile(event.target.files?.[0] ?? null)}
                      type="file"
                    />
                    <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 13 }}>
                      {transferFile ? `Selected: ${transferFile.name}` : "No file selected."}
                    </div>
                    <input
                      aria-label="Transfer target path"
                      value={transferTargetPath}
                      onChange={(event) => setTransferTargetPath(event.target.value)}
                      placeholder="Target path (optional)"
                      style={fieldStyle}
                    />
                  </div>
                  {agentFilesPermissionDenied ? (
                    <div style={{ color: "#ffb4a8", fontSize: 13 }}>
                      Permission denied. This workspace requires `manage_agent`.
                    </div>
                  ) : null}
                  {agentFilesLoading ? <div>Loading agent files...</div> : null}
                  {!agentFilesLoading && !agentFilesPermissionDenied && agentFiles.length === 0 ? (
                    <div>No uploaded files yet.</div>
                  ) : null}
                  {!agentFilesLoading && !agentFilesPermissionDenied
                    ? agentFiles.map((file) => (
                        <div
                          key={file.fileId}
                          data-testid={`desktop-agent-file-${file.fileId}`}
                          style={{
                            border: `1px solid ${ceryxColors.outlineVariant}`,
                            borderRadius: 8,
                            display: "grid",
                            gap: 8,
                            gridTemplateColumns: "minmax(0, 1fr) auto auto",
                            padding: "8px 10px"
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{file.fileName}</div>
                            <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                              {file.mimeType} · {file.sizeBytes} bytes
                            </div>
                            <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                              Uploaded {new Date(file.uploadedAt).toLocaleString()}
                            </div>
                          </div>
                          <Button size="desktop" variant="secondary" onClick={() => void downloadSelectedAgentFile(file)}>
                            Download
                          </Button>
                          <Button size="desktop" variant="ghost" onClick={() => void deleteSelectedAgentFile(file)}>
                            Delete
                          </Button>
                        </div>
                      ))
                    : null}
                  {agentFilesError ? <div style={{ color: "#ffb4a8", fontSize: 12 }}>{agentFilesError}</div> : null}
                </Panel>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {workspaceMode === "tasks" ? (
        <div
          data-testid="desktop-tasks-workspace"
          style={{
            inset: 0,
            position: "fixed",
            zIndex: 34
          }}
        >
          <div
            style={{
              backgroundColor: "rgba(16, 14, 12, 0.45)",
              inset: 0,
              position: "absolute"
            }}
            onClick={() => setWorkspaceMode("console")}
          />
          <section
            style={{
              backgroundColor: ceryxColors.surface,
              display: "grid",
              gridTemplateRows: "56px 1fr",
              inset: "12px",
              position: "absolute"
            }}
          >
            <header
              style={{
                alignItems: "center",
                borderBottom: `1px solid ${ceryxColors.outlineVariant}`,
                display: "flex",
                justifyContent: "space-between",
                padding: "0 16px"
              }}
            >
              <strong>Tasks Workspace</strong>
              <div style={{ display: "flex", gap: 8 }}>
                <Button
                  size="desktop"
                  variant="secondary"
                  disabled={tasksLoading}
                  onClick={() => void loadProjectTasks()}
                >
                  Refresh
                </Button>
                <Button size="desktop" variant="ghost" onClick={() => setWorkspaceMode("console")}>
                  Close
                </Button>
              </div>
            </header>
            <div style={{ minHeight: 0, overflow: "auto", padding: 12 }}>
              <Panel style={{ display: "grid", gap: 12 }}>
                {tasksPermissionDenied ? (
                  <div style={{ color: "#ffb4a8", fontSize: 13 }}>
                    Permission denied for task status.
                  </div>
                ) : null}
                {tasksLoading ? <div>Loading task status...</div> : null}
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
                      <div>Message: {taskTestRequest?.message ?? "-"}</div>
                    </div>
                    <div style={{ display: "grid", gap: 8 }}>
                      <strong>Recent Prompt Actions</strong>
                      {taskPromptActions.length === 0 ? <div>No prompt actions recorded.</div> : null}
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
                          <div style={{ whiteSpace: "pre-wrap" }}>{action.details || "-"}</div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
                {tasksError ? <div style={{ color: "#ffb4a8", fontSize: 12 }}>{tasksError}</div> : null}
              </Panel>
            </div>
          </section>
        </div>
      ) : null}

      {workspaceMode === "notifications" ? (
        <div
          data-testid="desktop-notifications-workspace"
          style={{
            inset: 0,
            position: "fixed",
            zIndex: 35
          }}
        >
          <div
            style={{
              backgroundColor: "rgba(16, 14, 12, 0.45)",
              inset: 0,
              position: "absolute"
            }}
            onClick={() => setWorkspaceMode("console")}
          />
          <section
            style={{
              backgroundColor: ceryxColors.surface,
              display: "grid",
              gridTemplateRows: "56px 1fr",
              inset: "12px",
              position: "absolute"
            }}
          >
            <header
              style={{
                alignItems: "center",
                borderBottom: `1px solid ${ceryxColors.outlineVariant}`,
                display: "flex",
                justifyContent: "space-between",
                padding: "0 16px"
              }}
            >
              <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
                <strong>Notifications Workspace</strong>
                <StatusChip tone={notificationsUnread > 0 ? "warning" : "success"}>
                  unread {notificationsUnread}
                </StatusChip>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Button
                  size="desktop"
                  variant="secondary"
                  disabled={notificationsLoading}
                  onClick={() => void loadNotifications()}
                >
                  Refresh
                </Button>
                <Button
                  size="desktop"
                  variant="secondary"
                  disabled={notificationsLoading || notifications.length === 0}
                  onClick={() => void clearAllNotifications()}
                >
                  Clear All
                </Button>
                <Button size="desktop" variant="ghost" onClick={() => setWorkspaceMode("console")}>
                  Close
                </Button>
              </div>
            </header>
            <div style={{ minHeight: 0, overflow: "auto", padding: 12 }}>
              <Panel style={{ display: "grid", gap: 8 }}>
                {notificationsPermissionDenied ? (
                  <div style={{ color: "#ffb4a8", fontSize: 13 }}>
                    Permission denied for notifications.
                  </div>
                ) : null}
                {notificationsLoading ? <div>Loading notifications...</div> : null}
                {!notificationsLoading && !notificationsPermissionDenied && notifications.length === 0 ? (
                  <div>No notifications.</div>
                ) : null}
                {!notificationsLoading && !notificationsPermissionDenied
                  ? notifications.map((notification) => (
                      <div
                        key={notification.id}
                        style={{
                          border: `1px solid ${ceryxColors.outlineVariant}`,
                          borderRadius: 8,
                          display: "grid",
                          gap: 6,
                          padding: "10px 12px"
                        }}
                      >
                        <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
                          <StatusChip
                            tone={notification.read ? "neutral" : notification.severity === "error" ? "error" : notification.severity === "warning" ? "warning" : "success"}
                          >
                            {notification.read ? "read" : "unread"}
                          </StatusChip>
                          <strong>{notification.title}</strong>
                        </div>
                        <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                          {formatTimestamp(notification.createdAt)} | {notification.severity}
                        </div>
                        <div style={{ whiteSpace: "pre-wrap" }}>{notification.message}</div>
                        {!notification.read ? (
                          <Button
                            size="desktop"
                            variant="ghost"
                            style={{ justifySelf: "start" }}
                            onClick={() => void markNotificationAsRead(notification.id)}
                          >
                            Mark Read
                          </Button>
                        ) : null}
                      </div>
                    ))
                  : null}
                {notificationsError ? (
                  <div style={{ color: "#ffb4a8", fontSize: 12 }}>{notificationsError}</div>
                ) : null}
              </Panel>
            </div>
          </section>
        </div>
      ) : null}

      {shortcutHelpOpen ? (
        <ShortcutHelpOverlay
          bindings={activeShortcutBindings}
          profileName={activeShortcutProfile.name}
          onClose={() => setShortcutHelpOpen(false)}
        />
      ) : null}

      {viewportMenu ? (
        <div
          ref={viewportMenuRef}
          data-input-lock-allow="true"
          style={{
            left: `${Math.max(16, viewportMenu.x)}px`,
            position: "fixed",
            top: `${Math.max(72, viewportMenu.y)}px`,
            zIndex: 40
          }}
        >
          <Panel
            style={{
              display: "grid",
              gap: 8,
              minWidth: 220
            }}
          >
            <Button size="desktop" variant="ghost" onClick={() => void handleCopyOutput()}>
              Copy Output
            </Button>
            <Button
              size="desktop"
              variant="ghost"
              disabled={inputLockActive}
              onClick={() => void handlePastePrompt()}
            >
              Paste Prompt
            </Button>
            <Button
              size="desktop"
              variant="ghost"
              disabled={inputLockActive}
              onClick={handleAskCodexToExplain}
            >
              Ask Codex to Explain
            </Button>
            <Button
              size="desktop"
              variant="ghost"
              disabled={!canScreenshot}
              onClick={() =>
                void runToolbarAction(async () => {
                  setViewportMenu(null);
                  const response = await takeScreenshot(defaultLocalAgentBaseUrl);
                  return { message: `Screenshot saved as ${response.fileName}.` };
                })
              }
            >
              Take Screenshot
            </Button>
            <Button
              size="desktop"
              variant="ghost"
              disabled={!canViewWindow}
              onClick={() =>
                void runToolbarAction(async () => {
                  setViewportMenu(null);
                  const snapshot = await focusCodexWindow(defaultLocalAgentBaseUrl);
                  setCodexTitle(snapshot.title ?? "Codex");
                  setCodexStatus(snapshot.status);
                  return { message: "Codex window focused." };
                })
              }
            >
              Focus Codex Window
            </Button>
            <Button size="desktop" variant="ghost" onClick={() => void handleReconnectStream()}>
              Reconnect Stream
            </Button>
          </Panel>
        </div>
      ) : null}
    </section>
  );
}

function VirtualizedLogsList({ entries }: { entries: AgentLogEntry[] }) {
  const viewportHeight = 380;
  const overscan = 6;
  const [scrollTop, setScrollTop] = useState(0);

  const totalHeight = entries.length * logRowHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / logRowHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / logRowHeight) + overscan * 2;
  const endIndex = Math.min(entries.length, startIndex + visibleCount);

  const visibleEntries = useMemo(
    () => entries.slice(startIndex, endIndex),
    [endIndex, entries, startIndex]
  );

  return (
    <div
      data-testid="desktop-logs-virtualized-list"
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
                alignItems: "center",
                borderBottom: `1px solid ${ceryxColors.outlineVariant}`,
                display: "grid",
                gap: 10,
                gridTemplateColumns: "98px 160px 200px minmax(0, 1fr)",
                height: logRowHeight,
                left: 0,
                padding: "0 10px",
                position: "absolute",
                right: 0,
                top: rowIndex * logRowHeight
              }}
              title={`${entry.details}`}
            >
              <span style={{ color: logSeverityColor(entry.severity), fontSize: 12 }}>
                {entry.severity}
              </span>
              <span style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                {formatTimestamp(entry.createdAt)}
              </span>
              <span style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
                {entry.sessionId || "local"}
              </span>
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}
              >
                {entry.action} {entry.details}
              </span>
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

const fieldStyle: CSSProperties = {
  backgroundColor: ceryxColors.surface,
  border: `1px solid ${ceryxColors.outlineVariant}`,
  borderRadius: 8,
  color: ceryxColors.onSurface,
  height: 34,
  padding: "0 10px"
};

function CheckboxRow({
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

function equalClientSettings(a: ClientSettingsState, b: ClientSettingsState): boolean {
  const aShortcutProfile = resolveClientShortcutProfileState(a);
  const bShortcutProfile = resolveClientShortcutProfileState(b);
  return (
    a.theme === b.theme &&
    a.compactMode === b.compactMode &&
    a.showLatency === b.showLatency &&
    (a.clipboardAutoSync ?? false) === (b.clipboardAutoSync ?? false) &&
    (a.lockLocalInputWhenCapturing ?? true) === (b.lockLocalInputWhenCapturing ?? true) &&
    a.keyboardShortcuts === b.keyboardShortcuts &&
    a.notificationsEnabled === b.notificationsEnabled &&
    a.logsAutoRefresh === b.logsAutoRefresh &&
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

function TooltipIconButton({
  label,
  onClick,
  children
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Tooltip content={label} anchorLabel={label} open={open}>
      <Button
        size="desktop"
        variant="ghost"
        aria-label={label}
        title={label}
        style={{
          minWidth: 32,
          padding: "6px 8px"
        }}
        onClick={onClick}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {children}
      </Button>
    </Tooltip>
  );
}

function clampWidth(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function readPersistedWidth(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === "undefined") {
    return fallback;
  }

  const raw = window.localStorage.getItem(key);
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) ? clampWidth(parsed, min, max) : fallback;
}

function writePersistedWidth(key: string, value: number): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(key, String(value));
}

function ShortcutProfileEditor({
  profileId,
  bindings,
  conflicts,
  recordingAction,
  error,
  onProfileChange,
  onReset,
  onBeginRecording
}: {
  profileId: string;
  bindings: Record<ShortcutActionId, string>;
  conflicts: Array<{ combo: string; actionIds: string[] }>;
  recordingAction: ShortcutActionId | null;
  error: string;
  onProfileChange: (profileId: string) => void;
  onReset: () => void;
  onBeginRecording: (actionId: ShortcutActionId) => void;
}) {
  const profileOptions = [
    { id: "vscode-style", label: defaultShortcutProfiles["vscode-style"].name },
    { id: "jetbrains-style", label: defaultShortcutProfiles["jetbrains-style"].name },
    { id: "minimal-style", label: defaultShortcutProfiles["minimal-style"].name },
    { id: "custom", label: "Custom" }
  ];

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <label style={{ display: "grid", gap: 4, maxWidth: 320 }}>
        <span style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>Shortcut profile</span>
        <select
          aria-label="Shortcut profile"
          value={profileId}
          onChange={(event) => onProfileChange(event.target.value)}
          style={fieldStyle}
        >
          {profileOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Button size="desktop" variant="secondary" onClick={onReset}>
          Reset to Default
        </Button>
      </div>

      <div style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
        Press `?` for a quick overview. Recording mode accepts the next shortcut combo.
      </div>

      {error ? <div style={{ color: "#ffb4a8", fontSize: 12 }}>{error}</div> : null}
      {conflicts.length > 0 ? (
        <div style={{ color: "#ffb4a8", fontSize: 12 }}>
          Conflicts detected:{" "}
          {conflicts.map((conflict) => `${conflict.combo} (${conflict.actionIds.join(", ")})`).join("; ")}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 8 }}>
        {defaultShortcutDefinitions.map((definition) => {
          const combo = bindings[definition.id as ShortcutActionId] ?? definition.defaultKeys;
          const isRecording = recordingAction === definition.id;

          return (
            <div
              key={definition.id}
              style={{
                alignItems: "center",
                border: `1px solid ${ceryxColors.outlineVariant}`,
                borderRadius: 10,
                display: "grid",
                gap: 8,
                gridTemplateColumns: "minmax(0, 1fr) auto auto",
                padding: "10px 12px"
              }}
            >
              <div style={{ display: "grid", gap: 2 }}>
                <strong style={{ fontSize: 13 }}>{definition.label}</strong>
                <span style={{ color: ceryxColors.onSurfaceVariant, fontSize: 11 }}>{definition.category}</span>
              </div>
              <code
                style={{
                  backgroundColor: ceryxColors.surfaceContainerLow,
                  borderRadius: 6,
                  color: ceryxColors.onSurface,
                  fontSize: 12,
                  padding: "6px 8px"
                }}
              >
                {combo}
              </code>
              <Button
                size="desktop"
                variant={isRecording ? "primary" : "secondary"}
                aria-label={`Record ${definition.label}`}
                onClick={() => onBeginRecording(definition.id as ShortcutActionId)}
              >
                {isRecording ? "Recording..." : "Record"}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ShortcutHelpOverlay({
  bindings,
  profileName,
  onClose
}: {
  bindings: Record<ShortcutActionId, string>;
  profileName: string;
  onClose: () => void;
}) {
  return (
    <div
      data-testid="desktop-shortcut-help"
      style={{
        alignItems: "center",
        backgroundColor: "rgba(16, 14, 12, 0.55)",
        display: "grid",
        inset: 0,
        justifyItems: "center",
        position: "fixed",
        zIndex: 48
      }}
    >
      <Panel
        style={{
          display: "grid",
          gap: 12,
          maxHeight: "min(84vh, 760px)",
          maxWidth: 820,
          overflow: "auto",
          width: "min(92vw, 820px)"
        }}
      >
        <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "grid", gap: 4 }}>
            <strong style={{ fontSize: 16 }}>Keyboard Shortcut Help</strong>
            <span style={{ color: ceryxColors.onSurfaceVariant, fontSize: 12 }}>
              Profile: {profileName}
            </span>
          </div>
          <Button size="desktop" variant="ghost" onClick={onClose}>
            Close help
          </Button>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {defaultShortcutDefinitions.map((definition) => (
            <div
              key={definition.id}
              style={{
                alignItems: "center",
                border: `1px solid ${ceryxColors.outlineVariant}`,
                borderRadius: 10,
                display: "grid",
                gap: 10,
                gridTemplateColumns: "minmax(0, 1fr) auto",
                padding: "10px 12px"
              }}
            >
              <div style={{ display: "grid", gap: 2 }}>
                <strong style={{ fontSize: 13 }}>{definition.label}</strong>
                <span style={{ color: ceryxColors.onSurfaceVariant, fontSize: 11 }}>
                  {definition.category}
                </span>
              </div>
              <code
                style={{
                  backgroundColor: ceryxColors.surfaceContainerLow,
                  borderRadius: 6,
                  color: ceryxColors.onSurface,
                  fontSize: 12,
                  padding: "6px 8px"
                }}
              >
                {bindings[definition.id as ShortcutActionId] ?? definition.defaultKeys}
              </code>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
