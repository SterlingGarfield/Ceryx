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
}
