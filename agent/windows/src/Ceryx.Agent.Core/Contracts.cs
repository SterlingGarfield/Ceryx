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
