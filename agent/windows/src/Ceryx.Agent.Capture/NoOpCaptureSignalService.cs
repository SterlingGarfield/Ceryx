using Ceryx.Agent.Core;

namespace Ceryx.Agent.Capture;

public sealed class NoOpCaptureSignalService : ICaptureSignalService
{
    public Task<CaptureSignalResponse> SubmitSignalAsync(
        CaptureSignalBody body,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(body);
        return Task.FromResult(new CaptureSignalResponse(
            Ok: true,
            Status: "accepted"));
    }
}
