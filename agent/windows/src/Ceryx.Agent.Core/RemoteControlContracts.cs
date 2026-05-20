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
    [property: JsonPropertyName("height")] int Height
);

public sealed record CaptureSignalBody(
    [property: JsonPropertyName("sessionId")] string SessionId,
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("payload")] string Payload
);

public sealed record CaptureSignalResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("status")] string Status
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
