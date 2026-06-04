using Ceryx.Agent.Core;
using SIPSorcery.Media;
using SIPSorcery.Net;
using SIPSorceryMedia.Abstractions;
using System.Collections.Concurrent;

namespace Ceryx.Agent.Capture;

internal interface IWebRtcSession : IAsyncDisposable
{
    string SessionId { get; }

    DateTimeOffset CreatedAt { get; }

    DateTimeOffset LastActivityAt { get; }

    void Touch(DateTimeOffset now);

    Task<Result<string>> ApplyOfferAsync(string offerSdp, CancellationToken cancellationToken = default);

    Task<Result<bool>> ApplyAnswerAsync(string answerSdp, CancellationToken cancellationToken = default);

    Task<Result<bool>> AddRemoteCandidateAsync(
        CaptureIceCandidateBody candidate,
        CancellationToken cancellationToken = default);

    Task<Result<string?>> HandleNegotiationNeededAsync(CancellationToken cancellationToken = default);

    CaptureIceCandidateBody? TryDequeueLocalCandidate();
}

internal sealed class WebRtcSession : IWebRtcSession
{
    private static readonly TimeSpan IdleLoopDelay = TimeSpan.FromMilliseconds(90);

    private readonly object _sync = new();
    private readonly ConcurrentQueue<CaptureIceCandidateBody> _localCandidates = new();
    private readonly RTCPeerConnection _peerConnection;
    private readonly VideoTestPatternSource _videoSource;
    private readonly IWebRtcFrameSource _frameSource;
    private readonly CancellationTokenSource _pumpCts = new();
    private readonly Task _pumpTask;
    private readonly VideoPixelFormatsEnum _pixelFormat;
    private bool _disposed;

    public WebRtcSession(
        string sessionId,
        DateTimeOffset createdAt,
        IWebRtcFrameSource frameSource)
    {
        if (string.IsNullOrWhiteSpace(sessionId))
        {
            throw new ArgumentException("Session id is required.", nameof(sessionId));
        }

        _frameSource = frameSource ?? throw new ArgumentNullException(nameof(frameSource));
        _pixelFormat = ResolvePixelFormat();

        SessionId = sessionId;
        CreatedAt = createdAt;
        LastActivityAt = createdAt;

        _peerConnection = new RTCPeerConnection(new RTCConfiguration());
        _peerConnection.onicecandidate += HandleLocalIceCandidate;
        _peerConnection.onconnectionstatechange += HandleConnectionStateChanged;

        var encoder = CreateVideoEncoder();
        _videoSource = new VideoTestPatternSource(encoder);
        _videoSource.OnVideoSourceEncodedSample += _peerConnection.SendVideo;

        var sourceFormats = _videoSource.GetVideoSourceFormats();
        var localVideoTrack = sourceFormats is { Count: > 0 }
            ? new MediaStreamTrack(sourceFormats, MediaStreamStatusEnum.SendOnly)
            : new MediaStreamTrack(
                SDPMediaTypesEnum.video,
                false,
                new List<SDPAudioVideoMediaFormat>
                {
                    new(new VideoFormat(VideoCodecsEnum.VP8, 101, 90000, string.Empty)),
                    new(new VideoFormat(
                        VideoCodecsEnum.H264,
                        102,
                        90000,
                        "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f"))
                },
                MediaStreamStatusEnum.SendOnly);
        _peerConnection.addTrack(localVideoTrack);

        _pumpTask = Task.Run(() => PumpFramesAsync(_pumpCts.Token));
    }

    public string SessionId { get; }

    public DateTimeOffset CreatedAt { get; }

    public DateTimeOffset LastActivityAt { get; private set; }

    public void Touch(DateTimeOffset now)
    {
        lock (_sync)
        {
            LastActivityAt = now;
        }
    }

    public async Task<Result<string>> ApplyOfferAsync(
        string offerSdp,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (string.IsNullOrWhiteSpace(offerSdp))
        {
            return Result<string>.Failure(new AgentError(
                Code: "missing_offer_sdp",
                Message: "Offer SDP is required.",
                TraceId: "trace_signal_offer_sdp"));
        }

        try
        {
            var setResult = _peerConnection.setRemoteDescription(
                new RTCSessionDescriptionInit
                {
                    type = RTCSdpType.offer,
                    sdp = offerSdp
                });

            if (setResult != SetDescriptionResultEnum.OK)
            {
                return Result<string>.Failure(new AgentError(
                    Code: "offer_rejected",
                    Message: $"Failed to apply remote offer. result={setResult}",
                    TraceId: "trace_signal_offer_rejected"));
            }

            var answer = _peerConnection.createAnswer();
            await _peerConnection.setLocalDescription(answer);

            if (string.IsNullOrWhiteSpace(answer.sdp))
            {
                return Result<string>.Failure(new AgentError(
                    Code: "offer_rejected",
                    Message: "WebRTC answer SDP is empty.",
                    TraceId: "trace_signal_offer_empty_answer"));
            }

            return Result<string>.Success(answer.sdp);
        }
        catch (Exception ex)
        {
            return Result<string>.Failure(new AgentError(
                Code: "offer_rejected",
                Message: $"Failed to negotiate WebRTC offer. {ex.Message}",
                TraceId: "trace_signal_offer_exception"));
        }
    }

    public Task<Result<bool>> ApplyAnswerAsync(
        string answerSdp,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (string.IsNullOrWhiteSpace(answerSdp))
        {
            return Task.FromResult(Result<bool>.Failure(new AgentError(
                Code: "missing_answer_sdp",
                Message: "Answer SDP is required.",
                TraceId: "trace_signal_answer_sdp")));
        }

        try
        {
            var setResult = _peerConnection.setRemoteDescription(
                new RTCSessionDescriptionInit
                {
                    type = RTCSdpType.answer,
                    sdp = answerSdp
                });

            if (setResult != SetDescriptionResultEnum.OK)
            {
                return Task.FromResult(Result<bool>.Failure(new AgentError(
                    Code: "answer_rejected",
                    Message: $"Failed to apply remote answer. result={setResult}",
                    TraceId: "trace_signal_answer_rejected")));
            }

            return Task.FromResult(Result<bool>.Success(true));
        }
        catch (Exception ex)
        {
            return Task.FromResult(Result<bool>.Failure(new AgentError(
                Code: "answer_rejected",
                Message: $"Failed to process WebRTC answer. {ex.Message}",
                TraceId: "trace_signal_answer_exception")));
        }
    }

    public Task<Result<bool>> AddRemoteCandidateAsync(
        CaptureIceCandidateBody candidate,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (candidate is null || string.IsNullOrWhiteSpace(candidate.Candidate))
        {
            return Task.FromResult(Result<bool>.Failure(new AgentError(
                Code: "missing_ice_candidate",
                Message: "ICE candidate is required.",
                TraceId: "trace_signal_candidate_missing")));
        }

        try
        {
            _peerConnection.addIceCandidate(
                new RTCIceCandidateInit
                {
                    candidate = candidate.Candidate,
                    sdpMid = candidate.SdpMid,
                    sdpMLineIndex = (ushort)Math.Max(0, candidate.SdpMLineIndex ?? 0)
                });
            return Task.FromResult(Result<bool>.Success(true));
        }
        catch (Exception ex)
        {
            return Task.FromResult(Result<bool>.Failure(new AgentError(
                Code: "ice_candidate_rejected",
                Message: $"Failed to add ICE candidate. {ex.Message}",
                TraceId: "trace_signal_candidate_exception")));
        }
    }

    public async Task<Result<string?>> HandleNegotiationNeededAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        try
        {
            var offer = _peerConnection.createOffer(null);
            await _peerConnection.setLocalDescription(offer);
            return Result<string?>.Success(offer.sdp);
        }
        catch (Exception ex)
        {
            return Result<string?>.Failure(new AgentError(
                Code: "negotiation_rejected",
                Message: $"Failed to renegotiate WebRTC session. {ex.Message}",
                TraceId: "trace_signal_negotiation_exception"));
        }
    }

    public CaptureIceCandidateBody? TryDequeueLocalCandidate()
    {
        return _localCandidates.TryDequeue(out var candidate) ? candidate : null;
    }

    public async ValueTask DisposeAsync()
    {
        lock (_sync)
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
        }

        _pumpCts.Cancel();
        try
        {
            await _pumpTask;
        }
        catch (OperationCanceledException)
        {
            // ignore
        }

        _videoSource.OnVideoSourceEncodedSample -= _peerConnection.SendVideo;
        if (_videoSource is IDisposable disposable)
        {
            disposable.Dispose();
        }
        _pumpCts.Dispose();

        _peerConnection.onicecandidate -= HandleLocalIceCandidate;
        _peerConnection.onconnectionstatechange -= HandleConnectionStateChanged;
        _peerConnection.Close("session_disposed");
    }

    private static IVideoEncoder? CreateVideoEncoder()
    {
        // Reflection keeps this path resilient against namespace/package shape drift.
        foreach (var typeName in CandidateEncoderTypeNames)
        {
            var type = Type.GetType(typeName, throwOnError: false);
            if (type is null)
            {
                continue;
            }

            if (Activator.CreateInstance(type) is IVideoEncoder encoder)
            {
                return encoder;
            }
        }

        return null;
    }

    private static VideoPixelFormatsEnum ResolvePixelFormat()
    {
        foreach (var candidate in CandidatePixelFormats)
        {
            if (Enum.TryParse<VideoPixelFormatsEnum>(candidate, ignoreCase: true, out var value))
            {
                return value;
            }
        }

        return default;
    }

    private void HandleLocalIceCandidate(RTCIceCandidate candidate)
    {
        if (candidate is null || string.IsNullOrWhiteSpace(candidate.candidate))
        {
            return;
        }

        _localCandidates.Enqueue(new CaptureIceCandidateBody(
            Candidate: candidate.candidate,
            SdpMid: candidate.sdpMid,
            SdpMLineIndex: candidate.sdpMLineIndex));
    }

    private void HandleConnectionStateChanged(RTCPeerConnectionState state)
    {
        if (IsState(state, "failed"))
        {
            _peerConnection.Close("connection_failed");
        }
    }

    private async Task PumpFramesAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            if (!IsState(_peerConnection.connectionState, "connected"))
            {
                await Task.Delay(IdleLoopDelay, cancellationToken);
                continue;
            }

            var frameResult = await _frameSource.GetFrameAsync(cancellationToken);
            if (!frameResult.IsSuccess || frameResult.Value is null)
            {
                await Task.Delay(IdleLoopDelay, cancellationToken);
                continue;
            }

            var frame = frameResult.Value;
            if (frame.Width <= 0 || frame.Height <= 0 || frame.Bgr24Bytes.Length == 0)
            {
                await Task.Delay(IdleLoopDelay, cancellationToken);
                continue;
            }

            try
            {
                _videoSource.ExternalVideoSourceRawSample(
                    frame.DurationMilliseconds,
                    frame.Width,
                    frame.Height,
                    frame.Bgr24Bytes,
                    _pixelFormat);
            }
            catch
            {
                await Task.Delay(IdleLoopDelay, cancellationToken);
                continue;
            }

            var nextDelay = (int)Math.Clamp(frame.DurationMilliseconds, 16, 1000);
            await Task.Delay(TimeSpan.FromMilliseconds(nextDelay), cancellationToken);
        }
    }

    private static bool IsState(RTCPeerConnectionState state, string expected)
    {
        return string.Equals(state.ToString(), expected, StringComparison.OrdinalIgnoreCase);
    }

    private static readonly string[] CandidateEncoderTypeNames =
    [
        "SIPSorceryMedia.Encoders.VpxVideoEncoder, SIPSorceryMedia.Encoders",
        "SIPSorceryMedia.Encoders.VP8.VpxVideoEncoder, SIPSorceryMedia.Encoders"
    ];

    private static readonly string[] CandidatePixelFormats =
    [
        "Bgr24",
        "BGR24",
        "Bgr",
        "BGR",
        "Rgb24",
        "RGB24"
    ];
}
