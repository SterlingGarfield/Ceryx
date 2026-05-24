using Ceryx.Agent.Core;
using System.Text.Json;

namespace Ceryx.Agent.Capture;

public sealed class NoOpCaptureSignalService : ICaptureSignalService
{
    private readonly ICaptureLifecycleService _captureLifecycleService;

    public NoOpCaptureSignalService(ICaptureLifecycleService captureLifecycleService)
    {
        _captureLifecycleService = captureLifecycleService ?? throw new ArgumentNullException(nameof(captureLifecycleService));
    }

    public Task<CaptureSignalResponse> SubmitSignalAsync(
        CaptureSignalBody body,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(body);

        return SubmitSignalCoreAsync(body, cancellationToken);
    }

    private async Task<CaptureSignalResponse> SubmitSignalCoreAsync(
        CaptureSignalBody body,
        CancellationToken cancellationToken)
    {
        var kind = body.Type?.Trim().ToLowerInvariant() ?? string.Empty;
        switch (kind)
        {
            case "capture.performance":
            case "performance":
            {
                var signal = ParsePerformanceSignal(body.Payload);
                if (signal is not null)
                {
                    _ = await _captureLifecycleService.ApplyPerformanceSignalAsync(signal, cancellationToken);
                    return new CaptureSignalResponse(Ok: true, Status: "accepted");
                }

                return new CaptureSignalResponse(Ok: true, Status: "ignored");
            }
            case "viewer.heartbeat":
                _ = await _captureLifecycleService.ApplyPerformanceSignalAsync(
                    new CapturePerformanceSignal(
                        CpuUsagePercent: 0,
                        NetworkJitterMs: 0,
                        HasActiveViewer: true),
                    cancellationToken);
                return new CaptureSignalResponse(Ok: true, Status: "accepted");
            case "viewer.idle":
            case "viewer.inactive":
                _ = await _captureLifecycleService.ApplyPerformanceSignalAsync(
                    new CapturePerformanceSignal(
                        CpuUsagePercent: 0,
                        NetworkJitterMs: 0,
                        HasActiveViewer: false),
                    cancellationToken);
                return new CaptureSignalResponse(Ok: true, Status: "accepted");
            default:
                return new CaptureSignalResponse(Ok: true, Status: "accepted");
        }
    }

    private static CapturePerformanceSignal? ParsePerformanceSignal(string payload)
    {
        if (string.IsNullOrWhiteSpace(payload))
        {
            return null;
        }

        try
        {
            using var doc = JsonDocument.Parse(payload);
            var root = doc.RootElement;
            var cpu = root.TryGetProperty("cpuUsagePercent", out var cpuProperty) && cpuProperty.TryGetDouble(out var parsedCpu)
                ? parsedCpu
                : 0;
            var jitter = root.TryGetProperty("networkJitterMs", out var jitterProperty) && jitterProperty.TryGetDouble(out var parsedJitter)
                ? parsedJitter
                : 0;
            var hasViewer = root.TryGetProperty("hasActiveViewer", out var viewerProperty) &&
                viewerProperty.ValueKind is JsonValueKind.True or JsonValueKind.False
                ? viewerProperty.GetBoolean()
                : true;
            return new CapturePerformanceSignal(
                CpuUsagePercent: cpu,
                NetworkJitterMs: jitter,
                HasActiveViewer: hasViewer);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
