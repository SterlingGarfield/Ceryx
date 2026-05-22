import { ceryxColors } from "@ceryx/design-tokens";
import { CeryxApiError } from "@ceryx/client-sdk";
import type {
  AgentNotificationEntry,
  AgentLogEntry,
  AgentSettingsPatch,
  AgentSettingsState,
  ClientSettingsState,
  LogsQuery,
  ProjectFileEntry,
  ProjectDiffFileEntry,
  ProjectDiffFileResponse,
  ProjectTaskPromptAction,
  ProjectTaskState,
  ProjectTestRequestState
} from "@ceryx/client-sdk";
import {
  CodexToolbar,
  PromptComposer,
  RemoteViewport,
  defaultPermissionsForClient,
  hasPermission,
  useConnectionStore,
  usePromptStore,
  useRemoteSessionStore
} from "@ceryx/feature-remote-control";
import { Button, Panel, StatusChip, TextArea } from "@ceryx/ui";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import {
  clearNotifications,
  getCaptureState,
  getCodexWindow,
  markNotificationRead,
  probeAgent,
  requestNotifications,
  refreshCodexWindow,
  requestDiffFile,
  requestDiffFiles,
  requestLogs,
  requestProjectFiles,
  requestProjectTasks,
  requestSettings,
  sendHotkeyInput,
  sendMouseInput,
  patchAgentSettings,
  sendPrompt,
  sendScrollInput,
  startCapture,
  startRecordingCapture,
  stopCapture,
  stopRecordingCapture,
  takeScreenshot,
  uploadImageAsset
} from "../platform/ipad/agentGateway";

const fallbackBaseUrl = "http://127.0.0.1:41527";
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

const ipadSettingsGroups = [
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

type IpadSettingsSectionId = (typeof ipadSettingsGroups)[number]["sections"][number]["id"];

type TouchPoint = {
  clientX: number;
  clientY: number;
};

type GestureState = {
  startedAt: number;
  startTouches: number;
  startCentroid: TouchPoint;
  latestCentroid: TouchPoint;
  startDistance: number;
  latestDistance: number;
  moved: boolean;
  longPressTriggered: boolean;
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

  const gestureSurfaceRef = useRef<HTMLDivElement | null>(null);
  const gestureStateRef = useRef<GestureState | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [codexTitle, setCodexTitle] = useState("Codex window not loaded");
  const [codexStatus, setCodexStatus] = useState("unknown");
  const [viewportMessage, setViewportMessage] = useState("Refreshing iPad control session...");
  const [recordingActive, setRecordingActive] = useState(false);
  const [toolbarBusy, setToolbarBusy] = useState(false);
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const [feedback, setFeedback] = useState("");
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
  const [filesWorkspaceOpen, setFilesWorkspaceOpen] = useState(false);
  const [filesQuery, setFilesQuery] = useState("");
  const [projectFiles, setProjectFiles] = useState<ProjectFileEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState("");
  const [filesPermissionDenied, setFilesPermissionDenied] = useState(false);
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

  const activeBaseUrl = currentDevice?.baseUrl ?? fallbackBaseUrl;
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
      clearLongPressTimer(longPressTimerRef);
    };
  }, []);

  async function refreshConsole() {
    const probe = await probeAgent(activeBaseUrl);
    const canControl = probe.reachable && probe.runtimeStatus !== "unpaired";
    const permissions = canControl ? defaultPermissionsForClient("ipad") : [];

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
      setCodexStatus(probe.codexStatus);
      setCodexTitle(probe.reachable ? "Pairing required" : "Agent offline");
      setViewportMessage(probe.message);
      return;
    }

    try {
      const [windowSnapshot, captureState] = await Promise.all([
        getCodexWindow(activeBaseUrl),
        getCaptureState(activeBaseUrl)
      ]);
      setCodexTitle(windowSnapshot.title ?? "Codex");
      setCodexStatus(windowSnapshot.status);
      remoteSession.setCaptureState(captureState);
      remoteSession.setPermissions(permissions);
      remoteSession.markActive();
      setViewportMessage("iPad remote console is ready.");
    } catch (error) {
      remoteSession.setPermissions([]);
      remoteSession.setCaptureState(idleCaptureState);
      remoteSession.setError(
        error instanceof Error ? error.message : "Failed to refresh iPad control session."
      );
      setViewportMessage("Unable to fetch Codex window or capture state.");
    }
  }

  useEffect(() => {
    void refreshConsole();
  }, [activeBaseUrl]);

  const connected = useMemo(
    () => remoteSession.status !== "idle" && remoteSession.status !== "error",
    [remoteSession.status]
  );

  const canControlInput = connected && hasPermission(remoteSession.permissions, "control_input");
  const canUploadImage = connected && hasPermission(remoteSession.permissions, "upload_image");
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
      setFeedback(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setToolbarBusy(false);
    }
  }

  async function runGestureAction(action: () => Promise<unknown>, successMessage: string) {
    if (!canControlInput) {
      setFeedback("Input control permission denied for this device.");
      return;
    }

    await runToolbarAction(action, successMessage);
  }

  async function handleSendPrompt(submit: boolean) {
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
          error instanceof Error ? error.message : "Failed to send prompt."
        );
      }
      setFeedback(error instanceof Error ? error.message : "Failed to send prompt.");
    }
  }

  async function handleRecord() {
    await runToolbarAction(async () => {
      if (recordingActive) {
        const response = await stopRecordingCapture(activeBaseUrl);
        setRecordingActive(false);
        return response;
      }

      const response = await startRecordingCapture(activeBaseUrl);
      setRecordingActive(true);
      return response;
    });
  }

  async function handleStop() {
    await runToolbarAction(async () => {
      if (recordingActive) {
        const response = await stopRecordingCapture(activeBaseUrl);
        setRecordingActive(false);
        return response;
      }

      return stopCapture(activeBaseUrl);
    }, "Stopped active session control.");
  }

  function startGestureTracking(points: TouchPoint[]) {
    const centroid = centroidOf(points);
    const distance = points.length >= 2 ? distanceBetween(points[0], points[1]) : 0;
    gestureStateRef.current = {
      startedAt: Date.now(),
      startTouches: points.length,
      startCentroid: centroid,
      latestCentroid: centroid,
      startDistance: distance,
      latestDistance: distance,
      moved: false,
      longPressTriggered: false
    };
  }

  function handleGestureTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    const points = readTouchPoints(event.touches);
    if (points.length === 0) {
      return;
    }

    if (points.length >= 2) {
      event.preventDefault();
    }

    clearLongPressTimer(longPressTimerRef);
    startGestureTracking(points);

    if (points.length === 1) {
      longPressTimerRef.current = setTimeout(() => {
        const state = gestureStateRef.current;
        if (!state || state.startTouches !== 1 || state.moved || state.longPressTriggered) {
          return;
        }

        state.longPressTriggered = true;
        void handleLongPressGesture(state.startCentroid);
      }, 550);
    }
  }

  function handleGestureTouchMove(event: React.TouchEvent<HTMLDivElement>) {
    const state = gestureStateRef.current;
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
      clearLongPressTimer(longPressTimerRef);
    }

    if (points.length >= 2) {
      state.latestDistance = distanceBetween(points[0], points[1]);
    }
  }

  function handleGestureTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
    if (event.changedTouches.length >= 2) {
      event.preventDefault();
    }

    clearLongPressTimer(longPressTimerRef);
    const state = gestureStateRef.current;
    gestureStateRef.current = null;
    if (!state) {
      return;
    }

    const duration = Date.now() - state.startedAt;
    if (state.startTouches === 3 && duration <= 500) {
      setToolbarVisible((current) => {
        const next = !current;
        setFeedback(next ? "Toolbar shown via three-finger tap." : "Toolbar hidden via three-finger tap.");
        return next;
      });
      return;
    }

    if (state.startTouches === 1) {
      if (!state.moved && !state.longPressTriggered && duration <= 350) {
        void handleSingleTapGesture(state.startCentroid);
      }
      return;
    }

    if (state.startTouches !== 2) {
      return;
    }

    const pinchDelta = state.latestDistance - state.startDistance;
    if (Math.abs(pinchDelta) >= 24) {
      void handlePinchGesture(pinchDelta > 0 ? "in" : "out");
      return;
    }

    const deltaX = state.latestCentroid.clientX - state.startCentroid.clientX;
    const deltaY = state.latestCentroid.clientY - state.startCentroid.clientY;
    if (Math.abs(deltaX) >= 14 || Math.abs(deltaY) >= 14) {
      void handleTwoFingerScrollGesture(deltaX, deltaY);
      return;
    }

    if (duration <= 350) {
      void handleTwoFingerTapGesture(state.startCentroid);
    }
  }

  async function handleSingleTapGesture(point: TouchPoint) {
    const remote = mapTouchPointToRemote(point, gestureSurfaceRef.current, remoteSession.captureState);
    if (!remote) {
      return;
    }

    await runGestureAction(
      () =>
        sendMouseInput(activeBaseUrl, {
          x: remote.x,
          y: remote.y,
          button: "left",
          action: "click"
        }),
      "Single tap mapped to left click."
    );
  }

  async function handleTwoFingerTapGesture(point: TouchPoint) {
    const remote = mapTouchPointToRemote(point, gestureSurfaceRef.current, remoteSession.captureState);
    if (!remote) {
      return;
    }

    await runGestureAction(
      () =>
        sendMouseInput(activeBaseUrl, {
          x: remote.x,
          y: remote.y,
          button: "right",
          action: "click"
        }),
      "Two-finger tap mapped to right click."
    );
  }

  async function handleLongPressGesture(point: TouchPoint) {
    const remote = mapTouchPointToRemote(point, gestureSurfaceRef.current, remoteSession.captureState);
    if (!remote) {
      return;
    }

    await runGestureAction(async () => {
      await sendMouseInput(activeBaseUrl, {
        x: remote.x,
        y: remote.y,
        button: "left",
        action: "down"
      });
      await waitMs(320);
      return sendMouseInput(activeBaseUrl, {
        x: remote.x,
        y: remote.y,
        button: "left",
        action: "up"
      });
    }, "Long press mapped to press-and-hold.");
  }

  async function handleTwoFingerScrollGesture(deltaX: number, deltaY: number) {
    const scaledX = Math.round(deltaX * 3);
    const scaledY = Math.round(deltaY * 3);
    if (scaledX === 0 && scaledY === 0) {
      return;
    }

    await runGestureAction(
      () =>
        sendScrollInput(activeBaseUrl, {
          deltaX: scaledX,
          deltaY: scaledY
        }),
      "Two-finger scroll mapped to input scroll."
    );
  }

  async function handlePinchGesture(direction: "in" | "out") {
    await runGestureAction(
      () =>
        sendHotkeyInput(activeBaseUrl, {
          keys: direction === "in" ? ["ctrl", "plus"] : ["ctrl", "minus"]
        }),
      direction === "in" ? "Pinch-out mapped to zoom in." : "Pinch-in mapped to zoom out."
    );
  }

  function appendVoiceDraftToPrompt() {
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
      setFeedback(error instanceof Error ? error.message : "Image upload failed.");
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
      setDiffError(error instanceof Error ? error.message : "Failed to load changed files.");
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
    } catch (error) {
      setDiffError(error instanceof Error ? error.message : "Failed to load file diff.");
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
      setLogsError(error instanceof Error ? error.message : "Failed to load logs.");
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
      setSettingsError(error instanceof Error ? error.message : "Failed to load settings.");
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

      setFilesError(error instanceof Error ? error.message : "Failed to load project files.");
      setProjectFiles([]);
    } finally {
      setFilesLoading(false);
    }
  }

  async function openFilesWorkspace() {
    setFilesWorkspaceOpen(true);
    await loadProjectFiles();
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

      setTasksError(error instanceof Error ? error.message : "Failed to load task status.");
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

      setNotificationsError(error instanceof Error ? error.message : "Failed to load notifications.");
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
      setNotificationsError(error instanceof Error ? error.message : "Failed to mark notification.");
    }
  }

  async function clearAllNotifications() {
    try {
      await clearNotifications(activeBaseUrl);
      await loadNotifications();
    } catch (error) {
      setNotificationsError(error instanceof Error ? error.message : "Failed to clear notifications.");
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

      setSettingsError(error instanceof Error ? error.message : "Failed to save settings.");
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
      setFeedback(error instanceof Error ? error.message : "Failed to copy logs.");
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
      setLogsError(error instanceof Error ? error.message : "Failed to export logs.");
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
      setFeedback(error instanceof Error ? error.message : "Failed to copy diff.");
    }
  }

  function askCodexToExplainDiff() {
    if (!selectedDiff) {
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

    setDraft(
      [
        `Use this diff as context and continue implementing for ${selectedDiff.path}:`,
        "",
        selectedDiff.diffText
      ].join("\n")
    );
    setFeedback("Diff inserted into prompt draft.");
  }

  const sidePanelContent = (
    <div data-testid="ipad-side-panel" style={{ display: "grid", gap: 16, alignContent: "start" }}>
      <Panel size="ipad" style={{ display: "grid", gap: 12 }}>
        <strong style={{ fontSize: 20 }}>Inspector</strong>
        <div style={{ color: ceryxColors.onSurfaceVariant, display: "grid", gap: 8 }}>
          <div>Device: {deviceName}</div>
          <div>Session: {remoteSession.sessionId || "ipad-live-console"}</div>
          <div>
            Latency:{" "}
            {typeof remoteSession.latencyMs === "number" ? `${remoteSession.latencyMs} ms` : "-"}
          </div>
          <div>Codex: {codexStatus}</div>
          <div>Capture: {remoteSession.captureState.active ? "active" : "idle"}</div>
        </div>

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
            disabled={!connected}
            onClick={() => setVoiceSheetOpen(true)}
          >
            Voice Input
          </Button>
          <Button
            size="ipad"
            variant="secondary"
            disabled={!connected || !canUploadImage}
            onClick={() => setImageSheetOpen(true)}
          >
            Image Upload
          </Button>
          <Button
            size="ipad"
            variant="secondary"
            disabled={!connected || diffLoading}
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
        disabled={!connected}
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
                : await startCapture(activeBaseUrl);
              remoteSession.setCaptureState(response);
              return {
                message: response.active
                  ? "Capture session started."
                  : "Capture session stopped."
              };
            })
          }
        >
          <div
            ref={gestureSurfaceRef}
            data-testid="ipad-gesture-surface"
            style={{
              display: "grid",
              gap: 12,
              minHeight: 210,
              touchAction: "none"
            }}
            onTouchStart={handleGestureTouchStart}
            onTouchMove={handleGestureTouchMove}
            onTouchEnd={handleGestureTouchEnd}
          >
            <strong style={{ fontSize: 20 }}>{codexTitle}</strong>
            <div style={{ color: "#d0c7bf", maxWidth: 560 }}>{viewportMessage}</div>
            <div style={{ color: "#d0c7bf", fontSize: 13 }}>
              session={remoteSession.sessionId || "n/a"} | capture=
              {remoteSession.captureState.active ? remoteSession.captureState.mode : "idle"}
            </div>
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
                onChange={(event) => setVoiceDraft(event.target.value)}
                style={{ minHeight: 120 }}
              />
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <Button size="ipad" variant="ghost" onClick={() => setVoiceSheetOpen(false)}>
                  Cancel
                </Button>
                <Button size="ipad" disabled={!voiceDraft.trim()} onClick={appendVoiceDraftToPrompt}>
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
                  disabled={!selectedImage || uploadingImage || !canUploadImage}
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
                          onChange={(checked) =>
                            setClientSettingsDraft((current) =>
                              current ? { ...current, compactMode: checked } : current
                            )
                          }
                        />
                        <IpadCheckboxRow
                          label="Show latency in inspector"
                          checked={clientSettingsDraft.showLatency}
                          onChange={(checked) =>
                            setClientSettingsDraft((current) =>
                              current ? { ...current, showLatency: checked } : current
                            )
                          }
                        />
                      </div>
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
                            disabled={!canManageAgent}
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
                            disabled={!canManageAgent}
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
                          onChange={(checked) =>
                            setClientSettingsDraft((current) =>
                              current ? { ...current, keyboardShortcuts: checked } : current
                            )
                          }
                        />
                        <IpadCheckboxRow
                          label="Notifications enabled"
                          checked={clientSettingsDraft.notificationsEnabled}
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
                            Default capture mode
                          </span>
                          <select
                            value={agentSettingsDraft.defaultCaptureMode}
                            disabled={!canManageAgent}
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
                          disabled={!canManageAgent}
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
              <Button size="ipad" disabled={!selectedDiff} onClick={() => askCodexToExplainDiff()}>
                Ask Codex to Explain
              </Button>
              <Button
                size="ipad"
                disabled={!selectedDiff}
                onClick={() => {
                  if (!selectedDiff) {
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
              <Button size="ipad" disabled={!selectedDiff} onClick={() => openSelectedDiffInCodex()}>
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

function equalClientSettings(a: ClientSettingsState, b: ClientSettingsState): boolean {
  return (
    a.theme === b.theme &&
    a.compactMode === b.compactMode &&
    a.showLatency === b.showLatency &&
    a.keyboardShortcuts === b.keyboardShortcuts &&
    a.notificationsEnabled === b.notificationsEnabled &&
    a.logsAutoRefresh === b.logsAutoRefresh
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
    return {
      theme: parsed.theme ?? fallback.theme,
      compactMode: parsed.compactMode ?? fallback.compactMode,
      showLatency: parsed.showLatency ?? fallback.showLatency,
      keyboardShortcuts: parsed.keyboardShortcuts ?? fallback.keyboardShortcuts,
      notificationsEnabled: parsed.notificationsEnabled ?? fallback.notificationsEnabled,
      logsAutoRefresh: parsed.logsAutoRefresh ?? fallback.logsAutoRefresh
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

function clearLongPressTimer(timerRef: { current: ReturnType<typeof setTimeout> | null }) {
  if (timerRef.current) {
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }
}

type TouchCollection = ArrayLike<TouchPoint> & {
  item?: (index: number) => TouchPoint | null;
};

function readTouchPoints(touches: TouchCollection): TouchPoint[] {
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

function centroidOf(points: TouchPoint[]): TouchPoint {
  const sum = points.reduce(
    (acc, point) => ({
      clientX: acc.clientX + point.clientX,
      clientY: acc.clientY + point.clientY
    }),
    { clientX: 0, clientY: 0 }
  );

  return {
    clientX: sum.clientX / points.length,
    clientY: sum.clientY / points.length
  };
}

function distanceBetween(a: TouchPoint, b: TouchPoint): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function mapTouchPointToRemote(
  point: TouchPoint,
  surface: HTMLDivElement | null,
  captureState: { width: number; height: number }
) {
  if (!surface) {
    return null;
  }

  const rect = surface.getBoundingClientRect();
  const targetWidth = captureState.width > 0 ? captureState.width : Math.round(rect.width);
  const targetHeight = captureState.height > 0 ? captureState.height : Math.round(rect.height);
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function waitMs(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
