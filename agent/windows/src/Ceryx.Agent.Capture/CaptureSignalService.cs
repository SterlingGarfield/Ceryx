using Ceryx.Agent.Core;
using System.Collections.Concurrent;
using System.Text.Json;

namespace Ceryx.Agent.Capture;

public sealed class CaptureSignalService : ICaptureSignalService, ICaptureConnectionStatsProvider, IAsyncDisposable
{
    private static readonly TimeSpan SessionTtl = TimeSpan.FromSeconds(60);

    private readonly ICaptureLifecycleService _captureLifecycleService;
    private readonly ICaptureSignalClock _clock;
    private readonly IWebRtcFrameSource _frameSource;
    private readonly Func<string, DateTimeOffset, IWebRtcSession> _sessionFactory;
    private readonly ConcurrentDictionary<string, IWebRtcSession> _sessions = new(StringComparer.Ordinal);

    public CaptureSignalService(ICaptureLifecycleService captureLifecycleService)
        : this(
            captureLifecycleService,
            new SystemCaptureSignalClock(),
            new NoOpWebRtcFrameSource(),
            null)
    {
    }

    public CaptureSignalService(
        ICaptureLifecycleService captureLifecycleService,
        IWebRtcFrameSource frameSource)
        : this(
            captureLifecycleService,
            new SystemCaptureSignalClock(),
            frameSource,
            null)
    {
    }

    internal CaptureSignalService(
        ICaptureLifecycleService captureLifecycleService,
        ICaptureSignalClock clock)
        : this(
            captureLifecycleService,
            clock,
            new NoOpWebRtcFrameSource(),
            null)
    {
    }

    internal CaptureSignalService(
        ICaptureLifecycleService captureLifecycleService,
        ICaptureSignalClock clock,
        Func<string, DateTimeOffset, IWebRtcSession> sessionFactory)
        : this(
            captureLifecycleService,
            clock,
            new NoOpWebRtcFrameSource(),
            sessionFactory)
    {
    }

    internal CaptureSignalService(
        ICaptureLifecycleService captureLifecycleService,
        ICaptureSignalClock clock,
        IWebRtcFrameSource frameSource,
        Func<string, DateTimeOffset, IWebRtcSession>? sessionFactory)
    {
        _captureLifecycleService = captureLifecycleService ?? throw new ArgumentNullException(nameof(captureLifecycleService));
        _clock = clock ?? throw new ArgumentNullException(nameof(clock));
        _frameSource = frameSource ?? throw new ArgumentNullException(nameof(frameSource));
        _sessionFactory = sessionFactory ?? ((sessionId, createdAt) =>
            new WebRtcSession(sessionId, createdAt, _frameSource));
    }

    public int ActiveSessionCount => _sessions.Count;

    public DateTimeOffset? ConnectedSince
    {
        get
        {
            var session = _sessions.Values.OrderBy(static item => item.CreatedAt).FirstOrDefault();
            return session?.CreatedAt;
        }
    }

    public async Task<CaptureSignalResponse> SubmitSignalAsync(
        CaptureSignalBody body,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(body);
        cancellationToken.ThrowIfCancellationRequested();

        var now = _clock.UtcNow;
        CleanupExpiredSessions(now);

        var kind = NormalizeSignalKind(body.Type);

        if (IsPerformanceSignal(kind))
        {
            return await SubmitPerformanceSignalAsync(body, cancellationToken);
        }

        if (IsViewerSignal(kind))
        {
            return await SubmitViewerSignalAsync(kind, cancellationToken);
        }

        if (!IsWebRtcSignal(kind))
        {
            return Rejected("unsupported_type", body.SessionId, kind);
        }

        var sessionId = body.SessionId?.Trim();
        if (string.IsNullOrWhiteSpace(sessionId))
        {
            return Rejected("missing_session_id", null, kind);
        }

        if (!_captureLifecycleService.CurrentState.Active)
        {
            return Rejected("capture_inactive", sessionId, kind);
        }

        var session = _sessions.GetOrAdd(sessionId, id => _sessionFactory(id, now));
        session.Touch(now);

        return kind switch
        {
            "offer" => await SubmitOfferAsync(session, sessionId, body, cancellationToken),
            "answer" => await SubmitAnswerAsync(session, sessionId, body, cancellationToken),
            "ice-candidate" => await SubmitIceCandidateAsync(session, sessionId, body, cancellationToken),
            "negotiation-needed" => await SubmitNegotiationNeededAsync(session, sessionId, cancellationToken),
            _ => Rejected("unsupported_type", sessionId, kind)
        };
    }

    private async Task<CaptureSignalResponse> SubmitPerformanceSignalAsync(
        CaptureSignalBody body,
        CancellationToken cancellationToken)
    {
        var signal = ParsePerformanceSignal(body.Payload);
        if (signal is not null)
        {
            var sessionId = body.SessionId?.Trim();
            var session = !string.IsNullOrWhiteSpace(sessionId) && _sessions.TryGetValue(sessionId, out var existingSession)
                ? existingSession
                : null;

            if (session is not null)
            {
                session.Touch(_clock.UtcNow);
            }

            var result = await _captureLifecycleService.ApplyPerformanceSignalAsync(signal, cancellationToken);
            if (result.RenegotiationNeeded && session is not null)
            {
                var renegotiation = await session.HandleNegotiationNeededAsync(cancellationToken);
                if (!renegotiation.IsSuccess || string.IsNullOrWhiteSpace(renegotiation.Value))
                {
                    return Rejected(renegotiation.Error?.Code ?? "negotiation_rejected", sessionId, "negotiation-needed");
                }

                return new CaptureSignalResponse(
                    Ok: true,
                    Status: "accepted",
                    SessionId: sessionId,
                    Type: "negotiation-needed",
                    Sdp: renegotiation.Value);
            }

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
                HasActiveViewer: hasActiveViewer,
                ObservedAt: _clock.UtcNow),
            cancellationToken);
        return new CaptureSignalResponse(Ok: true, Status: "accepted");
    }

    private async Task<CaptureSignalResponse> SubmitOfferAsync(
        IWebRtcSession session,
        string sessionId,
        CaptureSignalBody request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Sdp))
        {
            return Rejected("missing_offer_sdp", sessionId, "offer");
        }

        var result = await session.ApplyOfferAsync(request.Sdp, cancellationToken);
        if (!result.IsSuccess || string.IsNullOrWhiteSpace(result.Value))
        {
            return Rejected(result.Error?.Code ?? "offer_rejected", sessionId, "offer");
        }

        return new CaptureSignalResponse(
            Ok: true,
            Status: "accepted",
            SessionId: sessionId,
            Type: "answer",
            Sdp: result.Value,
            Candidate: session.TryDequeueLocalCandidate());
    }

    private async Task<CaptureSignalResponse> SubmitAnswerAsync(
        IWebRtcSession session,
        string sessionId,
        CaptureSignalBody request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Sdp))
        {
            return Rejected("missing_answer_sdp", sessionId, "answer");
        }

        var result = await session.ApplyAnswerAsync(request.Sdp, cancellationToken);
        if (!result.IsSuccess)
        {
            return Rejected(result.Error?.Code ?? "answer_rejected", sessionId, "answer");
        }

        return new CaptureSignalResponse(
            Ok: true,
            Status: "accepted",
            SessionId: sessionId,
            Type: "answer");
    }

    private async Task<CaptureSignalResponse> SubmitIceCandidateAsync(
        IWebRtcSession session,
        string sessionId,
        CaptureSignalBody request,
        CancellationToken cancellationToken)
    {
        if (request.Candidate is null || string.IsNullOrWhiteSpace(request.Candidate.Candidate))
        {
            return Rejected("missing_ice_candidate", sessionId, "ice-candidate");
        }

        var result = await session.AddRemoteCandidateAsync(request.Candidate, cancellationToken);
        if (!result.IsSuccess)
        {
            return Rejected(result.Error?.Code ?? "ice_candidate_rejected", sessionId, "ice-candidate");
        }

        return new CaptureSignalResponse(
            Ok: true,
            Status: "accepted",
            SessionId: sessionId,
            Type: "ice-candidate",
            Candidate: session.TryDequeueLocalCandidate());
    }

    private async Task<CaptureSignalResponse> SubmitNegotiationNeededAsync(
        IWebRtcSession session,
        string sessionId,
        CancellationToken cancellationToken)
    {
        var result = await session.HandleNegotiationNeededAsync(cancellationToken);
        if (!result.IsSuccess)
        {
            return Rejected(result.Error?.Code ?? "negotiation_rejected", sessionId, "negotiation-needed");
        }

        return new CaptureSignalResponse(
            Ok: true,
            Status: "accepted",
            SessionId: sessionId,
            Type: "negotiation-needed",
            Sdp: result.Value);
    }

    private void CleanupExpiredSessions(DateTimeOffset now)
    {
        foreach (var pair in _sessions)
        {
            if (now - pair.Value.LastActivityAt <= SessionTtl)
            {
                continue;
            }

            if (_sessions.TryRemove(pair.Key, out var removed))
            {
                _ = DisposeSessionAsync(removed);
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        var sessions = _sessions.ToArray();
        _sessions.Clear();
        foreach (var pair in sessions)
        {
            await DisposeSessionAsync(pair.Value);
        }
    }

    private static CaptureSignalResponse Rejected(
        string status,
        string? sessionId,
        string? type)
    {
        return new CaptureSignalResponse(
            Ok: false,
            Status: status,
            SessionId: sessionId,
            Type: type);
    }

    private static string NormalizeSignalKind(string? value)
    {
        return value?.Trim().ToLowerInvariant() ?? string.Empty;
    }

    private static bool IsPerformanceSignal(string kind)
    {
        return kind is "capture.performance" or "performance";
    }

    private static bool IsViewerSignal(string kind)
    {
        return kind is "viewer.heartbeat" or "viewer.idle" or "viewer.inactive";
    }

    private static bool IsWebRtcSignal(string kind)
    {
        return kind is "offer" or "answer" or "ice-candidate" or "negotiation-needed";
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
            var jitter = TryGetDouble(root, "roundTripTimeMs")
                        ?? TryGetDouble(root, "networkJitterMs")
                        ?? 0;
            var hasViewer = root.TryGetProperty("hasActiveViewer", out var viewerProperty) &&
                            viewerProperty.ValueKind is JsonValueKind.True or JsonValueKind.False
                ? viewerProperty.GetBoolean()
                : true;
            var availableOutgoingBitrateKbps = TryGetDouble(root, "availableOutgoingBitrateKbps");
            var roundTripTimeMs = TryGetDouble(root, "roundTripTimeMs");
            var packetsLost = TryGetLong(root, "packetsLost");
            var packetsSent = TryGetLong(root, "packetsSent");
            var framesPerSecond = TryGetDouble(root, "framesPerSecond");
            var framesEncoded = TryGetLong(root, "framesEncoded");
            var qpSum = TryGetDouble(root, "qpSum");

            return new CapturePerformanceSignal(
                CpuUsagePercent: cpu,
                NetworkJitterMs: jitter,
                HasActiveViewer: hasViewer,
                ObservedAt: null,
                AvailableOutgoingBitrateKbps: availableOutgoingBitrateKbps,
                RoundTripTimeMs: roundTripTimeMs,
                PacketsLost: packetsLost,
                PacketsSent: packetsSent,
                FramesPerSecond: framesPerSecond,
                FramesEncoded: framesEncoded,
                QpSum: qpSum);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static double? TryGetDouble(JsonElement root, string propertyName)
    {
        return root.TryGetProperty(propertyName, out var property) && property.TryGetDouble(out var parsed)
            ? parsed
            : null;
    }

    private static long? TryGetLong(JsonElement root, string propertyName)
    {
        return root.TryGetProperty(propertyName, out var property) && property.TryGetInt64(out var parsed)
            ? parsed
            : null;
    }

    private static async Task DisposeSessionAsync(IWebRtcSession session)
    {
        try
        {
            await session.DisposeAsync();
        }
        catch
        {
            // Session disposal should never fail request handling paths.
        }
    }
}

public interface ICaptureSignalClock
{
    DateTimeOffset UtcNow { get; }
}

public sealed class SystemCaptureSignalClock : ICaptureSignalClock
{
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
}
