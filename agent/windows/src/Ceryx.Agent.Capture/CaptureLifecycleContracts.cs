using Ceryx.Agent.Codex.WindowLocator;
using Ceryx.Agent.Core;

namespace Ceryx.Agent.Capture;

public sealed record CaptureState(
    bool Active,
    bool Paused,
    string Mode,
    string? WindowId,
    int Width,
    int Height
);

public interface ICaptureLifecycleService
{
    Task<Result<CaptureState>> StartAsync(
        CaptureStartBody body,
        CodexWindowSnapshot window,
        CancellationToken cancellationToken = default);

    Task<CaptureState> StopAsync(CancellationToken cancellationToken = default);

    CaptureState CurrentState { get; }
}

public interface ICaptureSignalService
{
    Task<CaptureSignalResponse> SubmitSignalAsync(CaptureSignalBody body, CancellationToken cancellationToken = default);
}
