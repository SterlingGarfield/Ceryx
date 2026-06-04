using Ceryx.Agent.Core;

namespace Ceryx.Agent.Capture;

public sealed record WebRtcVideoFrame(
    byte[] Bgr24Bytes,
    int Width,
    int Height,
    uint DurationMilliseconds,
    DateTimeOffset CapturedAt
);

public interface IWebRtcFrameSource
{
    Task<Result<WebRtcVideoFrame>> GetFrameAsync(CancellationToken cancellationToken = default);
}

internal sealed class NoOpWebRtcFrameSource : IWebRtcFrameSource
{
    public Task<Result<WebRtcVideoFrame>> GetFrameAsync(CancellationToken cancellationToken = default)
    {
        return Task.FromResult(Result<WebRtcVideoFrame>.Failure(new AgentError(
            Code: "E_CAPTURE_INACTIVE",
            Message: "WebRTC frame source is unavailable.",
            TraceId: "trace_webrtc_frame_source_unavailable",
            Hint: "Start capture and ensure a concrete frame source is registered.")));
    }
}
