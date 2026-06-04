using Ceryx.Agent.Capture;
using Ceryx.Agent.Codex.WindowLocator;
using Ceryx.Agent.Core;
using Ceryx.Agent.Media;
using Xunit;

namespace Ceryx.Agent.Tests;

public sealed class WindowWebRtcFrameSourceTests
{
    [Fact]
    public async Task GetFrameAsync_RejectsWhenCaptureInactive()
    {
        var lifecycle = new InMemoryCaptureLifecycleService();
        var source = new WindowWebRtcFrameSource(
            new StaticWindowLocator(FocusedWindow()),
            lifecycle,
            new StaticWindowImageCapture());

        var result = await source.GetFrameAsync();
        Assert.False(result.IsSuccess);
        Assert.Equal("E_CAPTURE_INACTIVE", result.Error?.Code);
    }

    [Fact]
    public async Task GetFrameAsync_ReturnsBgr24FrameWhenActive()
    {
        var lifecycle = new InMemoryCaptureLifecycleService();
        var window = FocusedWindow();
        var started = await lifecycle.StartAsync(
            new CaptureStartBody(Mode: "balanced", Target: "codex_window"),
            window);
        Assert.True(started.IsSuccess);

        var source = new WindowWebRtcFrameSource(
            new StaticWindowLocator(window),
            lifecycle,
            new StaticWindowImageCapture());

        var result = await source.GetFrameAsync();
        Assert.True(result.IsSuccess, result.Error?.Message);
        Assert.NotNull(result.Value);
        Assert.Equal(1, result.Value!.Width);
        Assert.Equal(1, result.Value.Height);
        Assert.Equal(3, result.Value.Bgr24Bytes.Length);
        Assert.True(result.Value.DurationMilliseconds > 0);
    }

    private static CodexWindowSnapshot FocusedWindow()
    {
        return new CodexWindowSnapshot(
            Status: "focused",
            WindowId: "hwnd_001",
            Title: "Codex",
            ProcessName: "codex",
            CandidateCount: 1,
            LastUpdatedAt: DateTimeOffset.UtcNow);
    }

    private sealed class StaticWindowLocator : ICodexWindowLocator
    {
        private readonly CodexWindowSnapshot _snapshot;

        public StaticWindowLocator(CodexWindowSnapshot snapshot)
        {
            _snapshot = snapshot;
        }

        public Task<CodexWindowSnapshot> GetWindowAsync(CancellationToken cancellationToken = default)
        {
            return Task.FromResult(_snapshot);
        }

        public Task<CodexWindowSnapshot> RefreshAsync(CancellationToken cancellationToken = default)
        {
            return Task.FromResult(_snapshot with { LastUpdatedAt = DateTimeOffset.UtcNow });
        }

        public Task<CodexWindowSnapshot> FocusAsync(CancellationToken cancellationToken = default)
        {
            return Task.FromResult(_snapshot);
        }

        public Task<CodexWindowSnapshot> SelectWindowAsync(string windowId, CancellationToken cancellationToken = default)
        {
            return Task.FromResult(_snapshot);
        }

        public Task<CodexWindowListSnapshot> ListWindowsAsync(CancellationToken cancellationToken = default)
            => Task.FromResult(new CodexWindowListSnapshot(
                Windows: [_snapshot],
                ActiveWindowId: _snapshot.WindowId,
                TotalCount: _snapshot.WindowId is null ? 0 : 1,
                LastUpdatedAt: _snapshot.LastUpdatedAt));
    }

    private sealed class StaticWindowImageCapture : IWindowImageCapture
    {
        private static readonly byte[] JpegBytes = Convert.FromBase64String(
            "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD50ooor8MP9Uz/2Q==");

        public Task<Result<CapturedWindowFrame>> CaptureAsync(
            CodexWindowSnapshot window,
            WindowImageFormat format,
            CancellationToken cancellationToken = default)
        {
            return Task.FromResult(Result<CapturedWindowFrame>.Success(new CapturedWindowFrame(
                Bytes: JpegBytes,
                ContentType: "image/jpeg",
                Width: 1,
                Height: 1,
                CapturedAt: DateTimeOffset.UtcNow)));
        }
    }
}
