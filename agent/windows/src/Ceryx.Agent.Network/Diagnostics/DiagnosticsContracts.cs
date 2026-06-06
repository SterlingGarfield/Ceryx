using System.Text.Json.Serialization;

namespace Ceryx.Agent.Network.Diagnostics;

public sealed record CrashReport(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("recordedAt")] string RecordedAt,
    [property: JsonPropertyName("exceptionType")] string ExceptionType,
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("stackTrace")] string? StackTrace,
    [property: JsonPropertyName("captureBackend")] string CaptureBackend,
    [property: JsonPropertyName("activeConnections")] int ActiveConnections,
    [property: JsonPropertyName("runtimeStatus")] string RuntimeStatus,
    [property: JsonPropertyName("windowId")] string? WindowId,
    [property: JsonPropertyName("last50LogLines")] IReadOnlyList<string> Last50LogLines
);

public sealed record AgentDiagnosticsExportResult(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("archivePath")] string ArchivePath,
    [property: JsonPropertyName("archiveSizeBytes")] long ArchiveSizeBytes,
    [property: JsonPropertyName("pairedDeviceCount")] int PairedDeviceCount,
    [property: JsonPropertyName("startupCount")] int StartupCount,
    [property: JsonPropertyName("generatedAt")] string GeneratedAt
);

public sealed record AgentDiagnosticsCheckResult(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("passed")] bool Passed,
    [property: JsonPropertyName("message")] string Message
);

public sealed record AgentDiagnosticsSelfTestReport(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("passed")] int Passed,
    [property: JsonPropertyName("failed")] int Failed,
    [property: JsonPropertyName("generatedAt")] string GeneratedAt,
    [property: JsonPropertyName("checks")] IReadOnlyList<AgentDiagnosticsCheckResult> Checks
);

public interface IAgentDiagnosticsService
{
    Task<AgentDiagnosticsExportResult> ExportAsync(CancellationToken cancellationToken = default);

    Task<AgentDiagnosticsSelfTestReport> RunSelfTestAsync(CancellationToken cancellationToken = default);
}
