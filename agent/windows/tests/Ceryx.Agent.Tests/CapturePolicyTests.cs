using Ceryx.Agent.Capture;
using Ceryx.Agent.Codex.WindowLocator;
using Ceryx.Agent.Core;
using Xunit;

namespace Ceryx.Agent.Tests;

public sealed class CapturePolicyTests
{
    [Fact]
    public async Task CaptureStart_RejectsFullDesktopTarget()
    {
        var service = new InMemoryCaptureLifecycleService();
        var window = new CodexWindowSnapshot("found", "w1", "Codex", "codex", 1, DateTimeOffset.UtcNow);

        var result = await service.StartAsync(
            new CaptureStartBody(Mode: "balanced", Target: "full_desktop"),
            window);

        Assert.False(result.IsSuccess);
        Assert.Equal("E_CAPTURE_DENIED", result.Error?.Code);
    }

    [Fact]
    public async Task CaptureStart_PausesWhenWindowMinimized()
    {
        var service = new InMemoryCaptureLifecycleService();
        var window = new CodexWindowSnapshot("minimized", "w1", "Codex", "codex", 1, DateTimeOffset.UtcNow);

        var result = await service.StartAsync(
            new CaptureStartBody(Mode: "low_latency", Target: "codex_window"),
            window);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value?.Paused);
    }

    [Fact]
    public async Task PerformancePolicy_CpuAboveThresholdForFiveSeconds_DropsFrameRate()
    {
        var clock = new FakeCaptureClock(DateTimeOffset.Parse("2026-05-23T00:00:00Z"));
        var service = new InMemoryCaptureLifecycleService(clock);
        var window = new CodexWindowSnapshot("found", "w1", "Codex", "codex", 1, clock.UtcNow);

        var started = await service.StartAsync(
            new CaptureStartBody(Mode: "balanced", Target: "codex_window"),
            window);
        Assert.True(started.IsSuccess);
        Assert.NotNull(started.Value);
        Assert.Equal(30, started.Value!.FrameRate);

        await service.ApplyPerformanceSignalAsync(new CapturePerformanceSignal(
            CpuUsagePercent: 75,
            NetworkJitterMs: 10,
            HasActiveViewer: true));
        clock.Advance(TimeSpan.FromSeconds(5));
        var result = await service.ApplyPerformanceSignalAsync(new CapturePerformanceSignal(
            CpuUsagePercent: 80,
            NetworkJitterMs: 12,
            HasActiveViewer: true));

        Assert.Equal(20, result.State.FrameRate);
        Assert.Equal("cpu_throttled", result.State.Quality);
    }

    [Fact]
    public async Task PerformancePolicy_HighJitter_LowersResolutionBeforeDisconnect()
    {
        var clock = new FakeCaptureClock(DateTimeOffset.Parse("2026-05-23T00:00:00Z"));
        var service = new InMemoryCaptureLifecycleService(clock);
        var window = new CodexWindowSnapshot("found", "w1", "Codex", "codex", 1, clock.UtcNow);

        var started = await service.StartAsync(
            new CaptureStartBody(Mode: "high_quality", Target: "codex_window"),
            window);
        Assert.True(started.IsSuccess);

        await service.ApplyPerformanceSignalAsync(new CapturePerformanceSignal(
            CpuUsagePercent: 20,
            NetworkJitterMs: 160,
            HasActiveViewer: true));
        clock.Advance(TimeSpan.FromSeconds(2));
        var degraded = await service.ApplyPerformanceSignalAsync(new CapturePerformanceSignal(
            CpuUsagePercent: 22,
            NetworkJitterMs: 150,
            HasActiveViewer: true));

        Assert.True(degraded.State.Active);
        Assert.Equal(960, degraded.State.Width);
        Assert.Equal(540, degraded.State.Height);
        Assert.Equal("network_degraded", degraded.State.Quality);

        clock.Advance(TimeSpan.FromSeconds(4));
        var disconnected = await service.ApplyPerformanceSignalAsync(new CapturePerformanceSignal(
            CpuUsagePercent: 25,
            NetworkJitterMs: 145,
            HasActiveViewer: true));

        Assert.False(disconnected.State.Active);
        Assert.False(disconnected.State.Paused);
        Assert.Null(disconnected.State.WindowId);
    }

    [Fact]
    public async Task PerformancePolicy_NoViewerForThreeSeconds_PausesCapture()
    {
        var clock = new FakeCaptureClock(DateTimeOffset.Parse("2026-05-23T00:00:00Z"));
        var service = new InMemoryCaptureLifecycleService(clock);
        var window = new CodexWindowSnapshot("found", "w1", "Codex", "codex", 1, clock.UtcNow);

        var started = await service.StartAsync(
            new CaptureStartBody(Mode: "low_latency", Target: "codex_window"),
            window);
        Assert.True(started.IsSuccess);

        await service.ApplyPerformanceSignalAsync(new CapturePerformanceSignal(
            CpuUsagePercent: 10,
            NetworkJitterMs: 10,
            HasActiveViewer: false));
        clock.Advance(TimeSpan.FromSeconds(3));
        var paused = await service.ApplyPerformanceSignalAsync(new CapturePerformanceSignal(
            CpuUsagePercent: 11,
            NetworkJitterMs: 8,
            HasActiveViewer: false));

        Assert.True(paused.State.Active);
        Assert.True(paused.State.Paused);

        var resumed = await service.ApplyPerformanceSignalAsync(new CapturePerformanceSignal(
            CpuUsagePercent: 10,
            NetworkJitterMs: 8,
            HasActiveViewer: true));

        Assert.False(resumed.State.Paused);
    }

    [Fact]
    public async Task PerformancePolicy_HighBandwidthForFiveSeconds_UpgradesTierAndRequestsRenegotiation()
    {
        var clock = new FakeCaptureClock(DateTimeOffset.Parse("2026-05-23T00:00:00Z"));
        var service = new InMemoryCaptureLifecycleService(clock);
        var window = new CodexWindowSnapshot("found", "w1", "Codex", "codex", 1, clock.UtcNow);

        var started = await service.StartAsync(
            new CaptureStartBody(Mode: "power_save", Target: "codex_window"),
            window);
        Assert.True(started.IsSuccess);
        Assert.Equal(20, started.Value!.FrameRate);

        var signal = new CapturePerformanceSignal(
            CpuUsagePercent: 10,
            NetworkJitterMs: 8,
            HasActiveViewer: true,
            AvailableOutgoingBitrateKbps: 7000,
            RoundTripTimeMs: 8,
            PacketsLost: 0,
            PacketsSent: 1000,
            FramesPerSecond: 20,
            FramesEncoded: 600,
            QpSum: 1500);

        await service.ApplyPerformanceSignalAsync(signal);
        clock.Advance(TimeSpan.FromSeconds(5));
        var upgraded = await service.ApplyPerformanceSignalAsync(signal);

        Assert.True(upgraded.RenegotiationNeeded);
        Assert.Equal(30, upgraded.State.FrameRate);
        Assert.Equal(1280, upgraded.State.Width);
        Assert.Equal(720, upgraded.State.Height);
        Assert.Equal("high", upgraded.State.Quality);
    }

    [Fact]
    public async Task PerformancePolicy_WeakBandwidthForThreeSeconds_DowngradesTierAndRequestsRenegotiation()
    {
        var clock = new FakeCaptureClock(DateTimeOffset.Parse("2026-05-23T00:00:00Z"));
        var service = new InMemoryCaptureLifecycleService(clock);
        var window = new CodexWindowSnapshot("found", "w1", "Codex", "codex", 1, clock.UtcNow);

        var started = await service.StartAsync(
            new CaptureStartBody(Mode: "power_save", Target: "codex_window"),
            window);
        Assert.True(started.IsSuccess);

        var healthy = new CapturePerformanceSignal(
            CpuUsagePercent: 10,
            NetworkJitterMs: 8,
            HasActiveViewer: true,
            AvailableOutgoingBitrateKbps: 7000,
            RoundTripTimeMs: 8,
            PacketsLost: 0,
            PacketsSent: 1000,
            FramesPerSecond: 20,
            FramesEncoded: 600,
            QpSum: 1500);

        await service.ApplyPerformanceSignalAsync(healthy);
        clock.Advance(TimeSpan.FromSeconds(5));
        var high = await service.ApplyPerformanceSignalAsync(healthy);
        Assert.Equal("high", high.State.Quality);

        var constrained = new CapturePerformanceSignal(
            CpuUsagePercent: 10,
            NetworkJitterMs: 25,
            HasActiveViewer: true,
            AvailableOutgoingBitrateKbps: 2600,
            RoundTripTimeMs: 25,
            PacketsLost: 0,
            PacketsSent: 1000,
            FramesPerSecond: 30,
            FramesEncoded: 900,
            QpSum: 1800);

        await service.ApplyPerformanceSignalAsync(constrained);
        clock.Advance(TimeSpan.FromSeconds(3));
        var downgraded = await service.ApplyPerformanceSignalAsync(constrained);

        Assert.True(downgraded.RenegotiationNeeded);
        Assert.Equal(15, downgraded.State.FrameRate);
        Assert.Equal("medium", downgraded.State.Quality);
    }

    [Fact]
    public async Task PerformancePolicy_PacketLossAboveTenPercent_ImmediatelyDowngradesTier()
    {
        var clock = new FakeCaptureClock(DateTimeOffset.Parse("2026-05-23T00:00:00Z"));
        var service = new InMemoryCaptureLifecycleService(clock);
        var window = new CodexWindowSnapshot("found", "w1", "Codex", "codex", 1, clock.UtcNow);

        var started = await service.StartAsync(
            new CaptureStartBody(Mode: "power_save", Target: "codex_window"),
            window);
        Assert.True(started.IsSuccess);

        var healthy = new CapturePerformanceSignal(
            CpuUsagePercent: 10,
            NetworkJitterMs: 8,
            HasActiveViewer: true,
            AvailableOutgoingBitrateKbps: 7000,
            RoundTripTimeMs: 8,
            PacketsLost: 0,
            PacketsSent: 1000,
            FramesPerSecond: 20,
            FramesEncoded: 600,
            QpSum: 1500);

        await service.ApplyPerformanceSignalAsync(healthy);
        clock.Advance(TimeSpan.FromSeconds(5));
        await service.ApplyPerformanceSignalAsync(healthy);

        var lossy = new CapturePerformanceSignal(
            CpuUsagePercent: 10,
            NetworkJitterMs: 30,
            HasActiveViewer: true,
            AvailableOutgoingBitrateKbps: 6500,
            RoundTripTimeMs: 30,
            PacketsLost: 180,
            PacketsSent: 820,
            FramesPerSecond: 30,
            FramesEncoded: 900,
            QpSum: 2100);

        var downgraded = await service.ApplyPerformanceSignalAsync(lossy);

        Assert.True(downgraded.RenegotiationNeeded);
        Assert.Equal(960, downgraded.State.Width);
        Assert.Equal(540, downgraded.State.Height);
        Assert.Equal(8, downgraded.State.FrameRate);
        Assert.Equal("low", downgraded.State.Quality);
    }

    private sealed class FakeCaptureClock : ICaptureClock
    {
        private DateTimeOffset _utcNow;

        public FakeCaptureClock(DateTimeOffset utcNow)
        {
            _utcNow = utcNow;
        }

        public DateTimeOffset UtcNow => _utcNow;

        public void Advance(TimeSpan delta)
        {
            _utcNow = _utcNow.Add(delta);
        }
    }
}
