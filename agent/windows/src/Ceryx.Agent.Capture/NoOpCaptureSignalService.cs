using Ceryx.Agent.Core;
using System.Collections.Concurrent;
using System.Text.Json;

namespace Ceryx.Agent.Capture;

public sealed class NoOpCaptureSignalService : ICaptureSignalService
{
    private static readonly TimeSpan SessionTtl = TimeSpan.FromSeconds(60);
    private readonly ICaptureLifecycleService _captureLifecycleService;
    private readonly ConcurrentDictionary<string, WebRtcSessionState> _sessions = new(StringComparer.Ordinal);

    public NoOpCaptureSignalService(ICaptureLifecycleService captureLifecycleService)
    {
        _captureLifecycleService = captureLifecycleService ?? throw new ArgumentNullException(nameof(captureLifecycleService));
    }

    public Task<CaptureSignalResponse> SubmitSignalAsync(
        CaptureSignalBody body,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(body);
        cancellationToken.ThrowIfCancellationRequested();

        CleanupExpiredSessions();

        var kind = body.Type?.Trim().ToLowerInvariant() ?? string.Empty;
        if (kind is "capture.performance" or "performance")
        {
            return SubmitPerformanceSignalAsync(body, cancellationToken);
        }

        if (kind is "viewer.heartbeat" or "viewer.idle" or "viewer.inactive")
        {
            return SubmitViewerSignalAsync(kind, cancellationToken);
        }

        if (string.IsNullOrWhiteSpace(body.SessionId))
        {
            return Task.FromResult(new CaptureSignalResponse(
                Ok: false,
                Status: "rejected",
                SessionId: null,
                Type: kind));
        }

        var session = _sessions.AddOrUpdate(
            body.SessionId.Trim(),
            _ => WebRtcSessionState.FromRequest(body),
            (_, existing) => existing.Apply(body));

        return Task.FromResult(CreateSignalResponse(kind, session));
    }

    private async Task<CaptureSignalResponse> SubmitPerformanceSignalAsync(
        CaptureSignalBody body,
        CancellationToken cancellationToken)
    {
        var signal = ParsePerformanceSignal(body.Payload);
        if (signal is not null)
        {
            _ = await _captureLifecycleService.ApplyPerformanceSignalAsync(signal, cancellationToken);
            return new CaptureSignalResponse(Ok: true, Status: "accepted");
        }

        return new CaptureSignalResponse(Ok: true, Status: "ignored");
    }

    private async Task<CaptureSignalResponse> SubmitViewerSignalAsync(
        string kind,
        CancellationToken cancellationToken)
    {
        var hasActiveViewer = kind == "viewer.heartbeat";
        _ = await _captureLifecycleService.ApplyPerformanceSignalAsync(
            new CapturePerformanceSignal(
                CpuUsagePercent: 0,
                NetworkJitterMs: 0,
                HasActiveViewer: hasActiveViewer),
            cancellationToken);
        return new CaptureSignalResponse(Ok: true, Status: "accepted");
    }

    private CaptureSignalResponse CreateSignalResponse(string kind, WebRtcSessionState session)
    {
        return kind switch
        {
            "offer" => new CaptureSignalResponse(
                Ok: true,
                Status: "accepted",
                SessionId: session.SessionId,
                Type: "answer",
                // Signal-only phase: ack negotiated shape while media plane remains server-side.
                Sdp: session.OfferSdp),
            "ice-candidate" => new CaptureSignalResponse(
                Ok: true,
                Status: "accepted",
                SessionId: session.SessionId,
                Type: "ice-candidate",
                Candidate: session.LastCandidate),
            "negotiation-needed" => new CaptureSignalResponse(
                Ok: true,
                Status: "accepted",
                SessionId: session.SessionId,
                Type: "negotiation-needed"),
            "answer" => new CaptureSignalResponse(
                Ok: true,
                Status: "accepted",
                SessionId: session.SessionId,
                Type: "answer",
                Sdp: session.AnswerSdp),
            _ => new CaptureSignalResponse(
                Ok: true,
                Status: "accepted",
                SessionId: session.SessionId,
                Type: kind)
        };
    }

    private void CleanupExpiredSessions()
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var pair in _sessions)
        {
            if (now - pair.Value.LastActivityAt > SessionTtl)
            {
                _sessions.TryRemove(pair.Key, out _);
            }
        }
    }

    private static CapturePerformanceSignal? ParsePerformanceSignal(string? payload)
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

internal sealed record WebRtcSessionState(
    string SessionId,
    string? OfferSdp,
    string? AnswerSdp,
    CaptureIceCandidateBody? LastCandidate,
    DateTimeOffset LastActivityAt)
{
    public static WebRtcSessionState FromRequest(CaptureSignalBody request)
    {
        var now = DateTimeOffset.UtcNow;
        return new WebRtcSessionState(
            SessionId: request.SessionId.Trim(),
            OfferSdp: request.Type.Equals("offer", StringComparison.OrdinalIgnoreCase) ? request.Sdp : null,
            AnswerSdp: request.Type.Equals("answer", StringComparison.OrdinalIgnoreCase) ? request.Sdp : null,
            LastCandidate: request.Candidate,
            LastActivityAt: now);
    }

    public WebRtcSessionState Apply(CaptureSignalBody request)
    {
        var nextOffer = OfferSdp;
        var nextAnswer = AnswerSdp;
        if (request.Type.Equals("offer", StringComparison.OrdinalIgnoreCase))
        {
            nextOffer = request.Sdp;
        }

        if (request.Type.Equals("answer", StringComparison.OrdinalIgnoreCase))
        {
            nextAnswer = request.Sdp;
        }

        return this with
        {
            OfferSdp = nextOffer,
            AnswerSdp = nextAnswer,
            LastCandidate = request.Candidate ?? LastCandidate,
            LastActivityAt = DateTimeOffset.UtcNow
        };
    }
}
