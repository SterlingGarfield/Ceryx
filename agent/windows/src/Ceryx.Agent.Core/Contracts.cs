using System.Text.Json.Serialization;

namespace Ceryx.Agent.Core;

public sealed record HealthResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("service")] string Service,
    [property: JsonPropertyName("version")] string Version
);

public sealed record AgentStatusResponse(
    [property: JsonPropertyName("agentVersion")] string AgentVersion,
    [property: JsonPropertyName("deviceName")] string DeviceName,
    [property: JsonPropertyName("platform")] string Platform,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("httpPort")] int HttpPort,
    [property: JsonPropertyName("supportsWebRTC")] bool SupportsWebRTC,
    [property: JsonPropertyName("supportsDesktopClient")] bool SupportsDesktopClient,
    [property: JsonPropertyName("codexStatus")] string CodexStatus
);

public sealed record AgentPathsResponse(
    [property: JsonPropertyName("root")] string Root,
    [property: JsonPropertyName("logs")] string Logs,
    [property: JsonPropertyName("uploads")] string Uploads,
    [property: JsonPropertyName("screenshots")] string Screenshots,
    [property: JsonPropertyName("recordings")] string Recordings,
    [property: JsonPropertyName("database")] string Database
);

public sealed record AgentManagementResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("action")] string Action,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("executed")] bool Executed,
    [property: JsonPropertyName("message")] string Message
);

public sealed record PairingRequestBody(
    [property: JsonPropertyName("clientName")] string ClientName,
    [property: JsonPropertyName("clientType")] string ClientType,
    [property: JsonPropertyName("platform")] string Platform
);

public sealed record PairingRequestResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("state")] string State,
    [property: JsonPropertyName("pairingId")] string? PairingId,
    [property: JsonPropertyName("expiresAt")] string? ExpiresAt,
    [property: JsonPropertyName("rejectedReason")] string? RejectedReason
);

public sealed record PairingDesktopConfirmBody(
    [property: JsonPropertyName("pairingId")] string PairingId
);

public sealed record PairingDesktopConfirmResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("state")] string State
);

public sealed record PairingConfirmBody(
    [property: JsonPropertyName("pairingId")] string PairingId,
    [property: JsonPropertyName("code")] string Code
);

public sealed record PairingConfirmResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("deviceId")] string DeviceId,
    [property: JsonPropertyName("deviceToken")] string DeviceToken,
    [property: JsonPropertyName("permissions")] IReadOnlyList<string> Permissions
);

public sealed record PairingConfirmRejectedResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("state")] string State,
    [property: JsonPropertyName("isLocked")] bool IsLocked,
    [property: JsonPropertyName("failedAttempts")] int FailedAttempts,
    [property: JsonPropertyName("rejectedReason")] string? RejectedReason
);

public sealed record StandardErrorResponse(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("error")] StandardErrorBody Error
);

public sealed record StandardErrorBody(
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("hint")] string? Hint,
    [property: JsonPropertyName("traceId")] string TraceId
);
