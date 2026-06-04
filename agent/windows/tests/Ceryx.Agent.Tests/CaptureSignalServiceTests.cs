using Ceryx.Agent.Capture;
using Ceryx.Agent.Codex.WindowLocator;
using Ceryx.Agent.Core;
using Xunit;

namespace Ceryx.Agent.Tests;

public sealed class CaptureSignalServiceTests
{
    [Fact]
    public async Task SubmitSignal_RejectsMissingSessionAndInactiveCapture()
    {
        var lifecycle = new InMemoryCaptureLifecycleService();
        var service = new CaptureSignalService(lifecycle, new FakeSignalClock(DateTimeOffset.UtcNow));

        var missingSession = await service.SubmitSignalAsync(new CaptureSignalBody(
            SessionId: "",
            Type: "offer",
            Payload: null,
            Sdp: "v=0",
            Candidate: null));
        Assert.False(missingSession.Ok);
        Assert.Equal("missing_session_id", missingSession.Status);

        var inactiveCapture = await service.SubmitSignalAsync(new CaptureSignalBody(
            SessionId: "sess-inactive",
            Type: "offer",
            Payload: null,
            Sdp: "v=0",
            Candidate: null));
        Assert.False(inactiveCapture.Ok);
        Assert.Equal("capture_inactive", inactiveCapture.Status);
    }

    [Fact]
    public async Task SubmitSignal_CleansExpiredWebRtcSessions()
    {
        var clock = new FakeSignalClock(DateTimeOffset.Parse("2026-06-01T00:00:00Z"));
        var lifecycle = new InMemoryCaptureLifecycleService();
        await StartCaptureAsync(lifecycle, "w-signal-1");
        var service = new CaptureSignalService(
            lifecycle,
            clock,
            static (sessionId, createdAt) => new FakeWebRtcSession(sessionId, createdAt));

        var first = await service.SubmitSignalAsync(new CaptureSignalBody(
            SessionId: "sess-1",
            Type: "offer",
            Payload: null,
            Sdp: "v=0\no=- 1 1 IN IP4 127.0.0.1\ns=Ceryx Offer",
            Candidate: null));
        Assert.True(first.Ok);
        Assert.Equal("accepted", first.Status);
        Assert.Equal("answer", first.Type);
        Assert.Equal("v=0\no=- 1 1 IN IP4 127.0.0.1\ns=Ceryx Answer", first.Sdp);
        Assert.Equal(1, service.ActiveSessionCount);

        clock.Advance(TimeSpan.FromSeconds(61));

        var second = await service.SubmitSignalAsync(new CaptureSignalBody(
            SessionId: "sess-2",
            Type: "offer",
            Payload: null,
            Sdp: "v=0\no=- 2 2 IN IP4 127.0.0.1\ns=Ceryx Offer",
            Candidate: null));

        Assert.True(second.Ok);
        Assert.Equal("accepted", second.Status);
        Assert.Equal("answer", second.Type);
        Assert.Equal("v=0\no=- 2 2 IN IP4 127.0.0.1\ns=Ceryx Answer", second.Sdp);
        Assert.Equal(1, service.ActiveSessionCount);
        Assert.Equal("sess-2", second.SessionId);
    }

    [Fact]
    public async Task SubmitSignal_AcceptsPerformanceAndViewerSignals()
    {
        var lifecycle = new InMemoryCaptureLifecycleService();
        var service = new CaptureSignalService(lifecycle, new FakeSignalClock(DateTimeOffset.UtcNow));

        var performance = await service.SubmitSignalAsync(new CaptureSignalBody(
            SessionId: "perf-1",
            Type: "capture.performance",
            Payload: "{\"cpuUsagePercent\":12,\"networkJitterMs\":16,\"hasActiveViewer\":true}",
            Sdp: null,
            Candidate: null));
        Assert.True(performance.Ok);
        Assert.Equal("accepted", performance.Status);

        var viewerHeartbeat = await service.SubmitSignalAsync(new CaptureSignalBody(
            SessionId: "viewer-1",
            Type: "viewer.heartbeat",
            Payload: null,
            Sdp: null,
            Candidate: null));
        Assert.True(viewerHeartbeat.Ok);
        Assert.Equal("accepted", viewerHeartbeat.Status);
    }

    [Fact]
    public async Task SubmitSignal_RejectsMissingOfferOrIcePayload()
    {
        var lifecycle = new InMemoryCaptureLifecycleService();
        await StartCaptureAsync(lifecycle, "w-signal-2");
        var service = new CaptureSignalService(lifecycle, new FakeSignalClock(DateTimeOffset.UtcNow));

        var missingOffer = await service.SubmitSignalAsync(new CaptureSignalBody(
            SessionId: "sess-missing-offer",
            Type: "offer",
            Payload: null,
            Sdp: null,
            Candidate: null));
        Assert.False(missingOffer.Ok);
        Assert.Equal("missing_offer_sdp", missingOffer.Status);

        var missingCandidate = await service.SubmitSignalAsync(new CaptureSignalBody(
            SessionId: "sess-missing-candidate",
            Type: "ice-candidate",
            Payload: null,
            Sdp: null,
            Candidate: null));
        Assert.False(missingCandidate.Ok);
        Assert.Equal("missing_ice_candidate", missingCandidate.Status);
    }

    [Fact]
    public async Task SubmitSignal_AcceptsAnswerAndNegotiationSignals()
    {
        var lifecycle = new InMemoryCaptureLifecycleService();
        var clock = new FakeSignalClock(DateTimeOffset.UtcNow);
        await StartCaptureAsync(lifecycle, "w-signal-3");
        var service = new CaptureSignalService(
            lifecycle,
            clock,
            static (sessionId, createdAt) => new FakeWebRtcSession(sessionId, createdAt));

        var answer = await service.SubmitSignalAsync(new CaptureSignalBody(
            SessionId: "sess-answer",
            Type: "answer",
            Payload: null,
            Sdp: "v=0\no=- 4 4 IN IP4 127.0.0.1\ns=Ceryx Answer",
            Candidate: null));
        Assert.True(answer.Ok);
        Assert.Equal("accepted", answer.Status);
        Assert.Equal("answer", answer.Type);
        Assert.Equal("sess-answer", answer.SessionId);

        var renegotiation = await service.SubmitSignalAsync(new CaptureSignalBody(
            SessionId: "sess-answer",
            Type: "negotiation-needed",
            Payload: null,
            Sdp: null,
            Candidate: null));
        Assert.True(renegotiation.Ok);
        Assert.Equal("accepted", renegotiation.Status);
        Assert.Equal("negotiation-needed", renegotiation.Type);
        Assert.Equal("v=0\no=- 3 3 IN IP4 127.0.0.1\ns=Ceryx Negotiation", renegotiation.Sdp);
    }

    [Fact]
    public async Task SubmitSignal_PerformanceRequestWithRenegotiation_ReturnsOfferForAnswer()
    {
        var lifecycle = new RenegotiatingLifecycleService();
        var clock = new FakeSignalClock(DateTimeOffset.UtcNow);
        var service = new CaptureSignalService(
            lifecycle,
            clock,
            static (sessionId, createdAt) => new FakeWebRtcSession(sessionId, createdAt));

        var offer = await service.SubmitSignalAsync(new CaptureSignalBody(
            SessionId: "sess-reneg",
            Type: "offer",
            Payload: null,
            Sdp: "v=0\no=- 7 7 IN IP4 127.0.0.1\ns=Ceryx Offer",
            Candidate: null));
        Assert.True(offer.Ok);
        Assert.Equal("answer", offer.Type);

        var performance = await service.SubmitSignalAsync(new CaptureSignalBody(
            SessionId: "sess-reneg",
            Type: "capture.performance",
            Payload: "{\"cpuUsagePercent\":18,\"networkJitterMs\":22,\"availableOutgoingBitrateKbps\":1800,\"roundTripTimeMs\":22,\"packetsLost\":24,\"packetsSent\":200,\"framesPerSecond\":15,\"framesEncoded\":450,\"qpSum\":1700,\"hasActiveViewer\":true}",
            Sdp: null,
            Candidate: null));

        Assert.True(performance.Ok);
        Assert.Equal("accepted", performance.Status);
        Assert.Equal("negotiation-needed", performance.Type);
        Assert.Equal("v=0\no=- 3 3 IN IP4 127.0.0.1\ns=Ceryx Negotiation", performance.Sdp);
        Assert.NotNull(lifecycle.LastSignal);
        Assert.Equal(1800, lifecycle.LastSignal!.AvailableOutgoingBitrateKbps);
        Assert.Equal(22, lifecycle.LastSignal.RoundTripTimeMs);
        Assert.Equal(24, lifecycle.LastSignal.PacketsLost);
        Assert.Equal(200, lifecycle.LastSignal.PacketsSent);
        Assert.Equal(15, lifecycle.LastSignal.FramesPerSecond);
        Assert.Equal(450, lifecycle.LastSignal.FramesEncoded);
        Assert.Equal(1700, lifecycle.LastSignal.QpSum);
    }

    private static async Task StartCaptureAsync(ICaptureLifecycleService lifecycle, string windowId)
    {
        var started = await lifecycle.StartAsync(
            new CaptureStartBody(Mode: "balanced", Target: "codex_window"),
            new CodexWindowSnapshot(
                Status: "focused",
                WindowId: windowId,
                Title: "Codex",
                ProcessName: "codex",
                CandidateCount: 1,
                LastUpdatedAt: DateTimeOffset.UtcNow));
        Assert.True(started.IsSuccess);
    }

    private sealed class FakeSignalClock : ICaptureSignalClock
    {
        private DateTimeOffset _utcNow;

        public FakeSignalClock(DateTimeOffset utcNow)
        {
            _utcNow = utcNow;
        }

        public DateTimeOffset UtcNow => _utcNow;

        public void Advance(TimeSpan delta)
        {
            _utcNow = _utcNow.Add(delta);
        }
    }

    private sealed class FakeWebRtcSession : IWebRtcSession
    {
        private readonly Queue<CaptureIceCandidateBody> _candidates = new();

        public FakeWebRtcSession(string sessionId, DateTimeOffset createdAt)
        {
            SessionId = sessionId;
            CreatedAt = createdAt;
            LastActivityAt = createdAt;
        }

        public string SessionId { get; }

        public DateTimeOffset CreatedAt { get; }

        public DateTimeOffset LastActivityAt { get; private set; }

        public void Touch(DateTimeOffset now)
        {
            LastActivityAt = now;
        }

        public Task<Result<string>> ApplyOfferAsync(string offerSdp, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (string.IsNullOrWhiteSpace(offerSdp))
            {
                return Task.FromResult(Result<string>.Failure(new AgentError(
                    Code: "offer_rejected",
                    Message: "Offer is required.",
                    TraceId: "test_offer_missing")));
            }

            var answer = offerSdp.Replace("Offer", "Answer", StringComparison.Ordinal);
            return Task.FromResult(Result<string>.Success(answer));
        }

        public Task<Result<bool>> ApplyAnswerAsync(string answerSdp, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(Result<bool>.Success(true));
        }

        public Task<Result<bool>> AddRemoteCandidateAsync(
            CaptureIceCandidateBody candidate,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            _candidates.Enqueue(candidate);
            return Task.FromResult(Result<bool>.Success(true));
        }

        public Task<Result<string?>> HandleNegotiationNeededAsync(CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(Result<string?>.Success("v=0\no=- 3 3 IN IP4 127.0.0.1\ns=Ceryx Negotiation"));
        }

        public CaptureIceCandidateBody? TryDequeueLocalCandidate()
        {
            return _candidates.Count == 0 ? null : _candidates.Dequeue();
        }

        public ValueTask DisposeAsync()
        {
            return ValueTask.CompletedTask;
        }
    }

    private sealed class RenegotiatingLifecycleService : ICaptureLifecycleService
    {
        public CapturePerformanceSignal? LastSignal { get; private set; }

        public CaptureState CurrentState { get; private set; } = new(
            Active: true,
            Paused: false,
            Mode: "balanced",
            WindowId: "w-signal-reneg",
            Width: 1280,
            Height: 720,
            FrameRate: 30,
            Quality: "high");

        public Task<Result<CaptureState>> StartAsync(
            CaptureStartBody body,
            CodexWindowSnapshot window,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            CurrentState = CurrentState with { Active = true };
            return Task.FromResult(Result<CaptureState>.Success(CurrentState));
        }

        public Task<CaptureState> StopAsync(CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            CurrentState = CurrentState with { Active = false, Paused = false, WindowId = null };
            return Task.FromResult(CurrentState);
        }

        public Task<CapturePolicyResult> ApplyPerformanceSignalAsync(
            CapturePerformanceSignal signal,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            LastSignal = signal;
            CurrentState = CurrentState with { Paused = false };
            return Task.FromResult(new CapturePolicyResult(CurrentState, RenegotiationNeeded: true));
        }
    }
}
