using System.Text.Json.Serialization;

namespace Ceryx.Agent.Core;

public sealed record TrustedDeviceResponse(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("platform")] string Platform,
    [property: JsonPropertyName("permissions")] IReadOnlyList<string> Permissions,
    [property: JsonPropertyName("autoConnect")] bool AutoConnect,
    [property: JsonPropertyName("createdAt")] string CreatedAt,
    [property: JsonPropertyName("lastConnectedAt")] string? LastConnectedAt
);

public sealed record DeviceDeleteResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("deleted")] bool Deleted
);

public sealed record HighRiskConfirmationBody(
    [property: JsonPropertyName("confirmHighRisk")] bool ConfirmHighRisk
);

public sealed record CodexWindowResponse(
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("windowId")] string? WindowId,
    [property: JsonPropertyName("title")] string? Title,
    [property: JsonPropertyName("processName")] string? ProcessName,
    [property: JsonPropertyName("candidateCount")] int CandidateCount,
    [property: JsonPropertyName("lastUpdatedAt")] string LastUpdatedAt
);

public sealed record CodexSelectWindowBody(
    [property: JsonPropertyName("windowId")] string WindowId
);

public sealed record InputKeyBody(
    [property: JsonPropertyName("key")] string Key,
    [property: JsonPropertyName("action")] string Action,
    [property: JsonPropertyName("modifiers")] IReadOnlyList<string>? Modifiers
);

public sealed record InputMouseBody(
    [property: JsonPropertyName("x")] int X,
    [property: JsonPropertyName("y")] int Y,
    [property: JsonPropertyName("button")] string Button,
    [property: JsonPropertyName("action")] string Action
);

public sealed record InputScrollBody(
    [property: JsonPropertyName("deltaX")] int DeltaX,
    [property: JsonPropertyName("deltaY")] int DeltaY
);

public sealed record InputHotkeyBody(
    [property: JsonPropertyName("keys")] IReadOnlyList<string> Keys
);

public sealed record InputTextBody(
    [property: JsonPropertyName("text")] string Text
);

public sealed record InputActionResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("action")] string Action,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("message")] string Message
);

public sealed record PromptSendBody(
    [property: JsonPropertyName("prompt")] string Prompt,
    [property: JsonPropertyName("submit")] bool Submit
);

public sealed record PromptSendResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("submitted")] bool Submitted
);

public sealed record ProjectDiffResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("summary")] string Summary,
    [property: JsonPropertyName("diffText")] string? DiffText
);

public sealed record ProjectDiffFileEntryResponse(
    [property: JsonPropertyName("path")] string Path,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("additions")] int Additions,
    [property: JsonPropertyName("deletions")] int Deletions
);

public sealed record ProjectDiffFilesResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("projectId")] string ProjectId,
    [property: JsonPropertyName("projectName")] string ProjectName,
    [property: JsonPropertyName("page")] int Page,
    [property: JsonPropertyName("pageSize")] int PageSize,
    [property: JsonPropertyName("total")] int Total,
    [property: JsonPropertyName("hasMore")] bool HasMore,
    [property: JsonPropertyName("files")] IReadOnlyList<ProjectDiffFileEntryResponse> Files
);

public sealed record ProjectDiffFileResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("projectId")] string ProjectId,
    [property: JsonPropertyName("path")] string Path,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("additions")] int Additions,
    [property: JsonPropertyName("deletions")] int Deletions,
    [property: JsonPropertyName("diffText")] string DiffText,
    [property: JsonPropertyName("truncated")] bool Truncated,
    [property: JsonPropertyName("lineLimit")] int LineLimit
);

public sealed record ProjectIndexedFileResponse(
    [property: JsonPropertyName("path")] string Path,
    [property: JsonPropertyName("extension")] string Extension,
    [property: JsonPropertyName("tracked")] bool Tracked,
    [property: JsonPropertyName("changed")] bool Changed
);

public sealed record ProjectFilesResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("projectId")] string ProjectId,
    [property: JsonPropertyName("projectName")] string ProjectName,
    [property: JsonPropertyName("generatedAt")] string GeneratedAt,
    [property: JsonPropertyName("files")] IReadOnlyList<ProjectIndexedFileResponse> Files
);

public sealed record ProjectTaskStateResponse(
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("currentAction")] string? CurrentAction,
    [property: JsonPropertyName("updatedAt")] string UpdatedAt
);

public sealed record ProjectTaskPromptActionResponse(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("action")] string Action,
    [property: JsonPropertyName("details")] string Details,
    [property: JsonPropertyName("severity")] string Severity,
    [property: JsonPropertyName("sessionId")] string SessionId,
    [property: JsonPropertyName("createdAt")] string CreatedAt
);

public sealed record ProjectTestRequestStateResponse(
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("requestId")] string? RequestId,
    [property: JsonPropertyName("scope")] string? Scope,
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("requestedAt")] string? RequestedAt
);

public sealed record ProjectTasksResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("taskState")] ProjectTaskStateResponse TaskState,
    [property: JsonPropertyName("recentPromptActions")] IReadOnlyList<ProjectTaskPromptActionResponse> RecentPromptActions,
    [property: JsonPropertyName("testRequest")] ProjectTestRequestStateResponse TestRequest
);

public sealed record ProjectTestRequestBody(
    [property: JsonPropertyName("scope")] string? Scope
);

public sealed record ProjectTestResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("requestId")] string? RequestId
);

public sealed record NotificationEntryResponse(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("severity")] string Severity,
    [property: JsonPropertyName("createdAt")] string CreatedAt,
    [property: JsonPropertyName("read")] bool Read
);

public sealed record NotificationsResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("total")] int Total,
    [property: JsonPropertyName("unread")] int Unread,
    [property: JsonPropertyName("items")] IReadOnlyList<NotificationEntryResponse> Items
);

public sealed record NotificationReadResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("read")] bool Read
);

public sealed record NotificationClearResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("clearedBefore")] string ClearedBefore
);

public sealed record AgentLogEntryResponse(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("action")] string Action,
    [property: JsonPropertyName("details")] string Details,
    [property: JsonPropertyName("severity")] string Severity,
    [property: JsonPropertyName("sessionId")] string SessionId,
    [property: JsonPropertyName("createdAt")] string CreatedAt
);

public sealed record LogsResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("page")] int Page,
    [property: JsonPropertyName("pageSize")] int PageSize,
    [property: JsonPropertyName("total")] int Total,
    [property: JsonPropertyName("hasMore")] bool HasMore,
    [property: JsonPropertyName("items")] IReadOnlyList<AgentLogEntryResponse> Items
);

public sealed record AgentSettingsStateResponse(
    [property: JsonPropertyName("httpPort")] int HttpPort,
    [property: JsonPropertyName("directTestCommand")] string DirectTestCommand,
    [property: JsonPropertyName("allowFullscreenCapture")] bool AllowFullscreenCapture,
    [property: JsonPropertyName("allowClearLogs")] bool AllowClearLogs,
    [property: JsonPropertyName("defaultCaptureMode")] string DefaultCaptureMode
);

public sealed record ClientSettingsStateResponse(
    [property: JsonPropertyName("theme")] string Theme,
    [property: JsonPropertyName("compactMode")] bool CompactMode,
    [property: JsonPropertyName("showLatency")] bool ShowLatency,
    [property: JsonPropertyName("keyboardShortcuts")] bool KeyboardShortcuts,
    [property: JsonPropertyName("notificationsEnabled")] bool NotificationsEnabled,
    [property: JsonPropertyName("logsAutoRefresh")] bool LogsAutoRefresh,
    [property: JsonPropertyName("previewRefreshProfile")] string PreviewRefreshProfile,
    [property: JsonPropertyName("viewportTransport")] string ViewportTransport
);

public sealed record SettingsResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("updatedAt")] string UpdatedAt,
    [property: JsonPropertyName("agentSettings")] AgentSettingsStateResponse AgentSettings,
    [property: JsonPropertyName("clientSettings")] ClientSettingsStateResponse ClientSettings
);

public sealed record AgentSettingsPatchBody(
    [property: JsonPropertyName("httpPort")] int? HttpPort,
    [property: JsonPropertyName("directTestCommand")] string? DirectTestCommand,
    [property: JsonPropertyName("allowFullscreenCapture")] bool? AllowFullscreenCapture,
    [property: JsonPropertyName("allowClearLogs")] bool? AllowClearLogs,
    [property: JsonPropertyName("defaultCaptureMode")] string? DefaultCaptureMode
);

public sealed record SettingsPatchBody(
    [property: JsonPropertyName("agentSettings")] AgentSettingsPatchBody? AgentSettings,
    [property: JsonPropertyName("confirmHighRisk")] bool ConfirmHighRisk
);

public sealed record CaptureStartBody(
    [property: JsonPropertyName("mode")] string Mode,
    [property: JsonPropertyName("target")] string Target
);

public sealed record CaptureStateResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("active")] bool Active,
    [property: JsonPropertyName("paused")] bool Paused,
    [property: JsonPropertyName("mode")] string Mode,
    [property: JsonPropertyName("windowId")] string? WindowId,
    [property: JsonPropertyName("width")] int Width,
    [property: JsonPropertyName("height")] int Height,
    [property: JsonPropertyName("frameRate")] int FrameRate,
    [property: JsonPropertyName("quality")] string Quality
);

public sealed record CaptureSignalBody(
    [property: JsonPropertyName("sessionId")] string SessionId,
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("payload")] string? Payload,
    [property: JsonPropertyName("sdp")] string? Sdp,
    [property: JsonPropertyName("candidate")] CaptureIceCandidateBody? Candidate
);

public sealed record CaptureSignalResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("sessionId")] string? SessionId = null,
    [property: JsonPropertyName("type")] string? Type = null,
    [property: JsonPropertyName("sdp")] string? Sdp = null,
    [property: JsonPropertyName("candidate")] CaptureIceCandidateBody? Candidate = null
);

public sealed record CaptureIceCandidateBody(
    [property: JsonPropertyName("candidate")] string Candidate,
    [property: JsonPropertyName("sdpMid")] string? SdpMid,
    [property: JsonPropertyName("sdpMLineIndex")] int? SdpMLineIndex
);

public sealed record UploadImageResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("assetId")] string AssetId,
    [property: JsonPropertyName("fileName")] string FileName,
    [property: JsonPropertyName("sizeBytes")] long SizeBytes
);

public sealed record ScreenshotResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("fileName")] string FileName,
    [property: JsonPropertyName("sizeBytes")] long SizeBytes
);

public sealed record RecordingStartResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("startedAt")] string StartedAt
);

public sealed record RecordingStopResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("fileName")] string FileName,
    [property: JsonPropertyName("sizeBytes")] long SizeBytes
);
