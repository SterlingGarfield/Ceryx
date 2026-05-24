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
        var state = await service.ApplyPerformanceSignalAsync(new CapturePerformanceSignal(
            CpuUsagePercent: 80,
            NetworkJitterMs: 12,
            HasActiveViewer: true));

        Assert.Equal(20, state.FrameRate);
        Assert.Equal("cpu_throttled", state.Quality);
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

        Assert.True(degraded.Active);
        Assert.Equal(960, degraded.Width);
        Assert.Equal(540, degraded.Height);
        Assert.Equal("network_degraded", degraded.Quality);

        clock.Advance(TimeSpan.FromSeconds(4));
        var disconnected = await service.ApplyPerformanceSignalAsync(new CapturePerformanceSignal(
            CpuUsagePercent: 25,
            NetworkJitterMs: 145,
            HasActiveViewer: true));

        Assert.False(disconnected.Active);
        Assert.False(disconnected.Paused);
        Assert.Null(disconnected.WindowId);
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

        Assert.True(paused.Active);
        Assert.True(paused.Paused);

        var resumed = await service.ApplyPerformanceSignalAsync(new CapturePerformanceSignal(
            CpuUsagePercent: 10,
            NetworkJitterMs: 8,
            HasActiveViewer: true));

        Assert.False(resumed.Paused);
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
