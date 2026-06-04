using Ceryx.Agent.Codex.WindowLocator;
using Ceryx.Agent.Core;

namespace Ceryx.Agent.Capture;

public sealed record CaptureState(
    bool Active,
    bool Paused,
    string Mode,
    string? WindowId,
    int Width,
    int Height,
    int FrameRate = 30,
    string Quality = "balanced"
);

public sealed record CapturePerformanceSignal(
    double CpuUsagePercent,
    double NetworkJitterMs,
    bool HasActiveViewer,
    DateTimeOffset? ObservedAt = null,
    double? AvailableOutgoingBitrateKbps = null,
    double? RoundTripTimeMs = null,
    long? PacketsLost = null,
    long? PacketsSent = null,
    double? FramesPerSecond = null,
    long? FramesEncoded = null,
    double? QpSum = null
);

public sealed record CapturePolicyResult(
    CaptureState State,
    bool RenegotiationNeeded,
    string? Reason = null
);

public interface ICaptureLifecycleService
{
    Task<Result<CaptureState>> StartAsync(
        CaptureStartBody body,
        CodexWindowSnapshot window,
        CancellationToken cancellationToken = default);

    Task<CaptureState> StopAsync(CancellationToken cancellationToken = default);

    Task<CapturePolicyResult> ApplyPerformanceSignalAsync(
        CapturePerformanceSignal signal,
        CancellationToken cancellationToken = default);

    CaptureState CurrentState { get; }
}

public interface ICaptureSignalService
{
    Task<CaptureSignalResponse> SubmitSignalAsync(CaptureSignalBody body, CancellationToken cancellationToken = default);
}
