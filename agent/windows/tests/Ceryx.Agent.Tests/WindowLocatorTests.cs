using Ceryx.Agent.Codex.WindowLocator;
using Xunit;

namespace Ceryx.Agent.Tests;

public sealed class WindowLocatorTests
{
    [Fact]
    public async Task WindowLocator_ReturnsMultipleCandidates_WhenAmbiguous()
    {
        var locator = new CodexWindowLocator(new FakeProbe(
        [
            new CodexWindowCandidate("w1", "Codex A", "codex", false, false),
            new CodexWindowCandidate("w2", "Codex B", "codex", false, false)
        ]));

        var snapshot = await locator.RefreshAsync();

        Assert.Equal("multiple_candidates", snapshot.Status);
        Assert.Null(snapshot.WindowId);
        Assert.Equal(2, snapshot.CandidateCount);
    }

    [Fact]
    public async Task WindowLocator_SelectWindow_ResolvesToFound()
    {
        var locator = new CodexWindowLocator(new FakeProbe(
        [
            new CodexWindowCandidate("w1", "Codex A", "codex", false, false),
            new CodexWindowCandidate("w2", "Codex B", "codex", false, false)
        ]));

        var selected = await locator.SelectWindowAsync("w2");
        var focused = await locator.FocusAsync();

        Assert.Equal("found", selected.Status);
        Assert.Equal("w2", selected.WindowId);
        Assert.Equal("focused", focused.Status);
        Assert.Equal("w2", focused.WindowId);
    }

    [Fact]
    public async Task WindowLocator_ListWindows_ReturnsAllCandidates()
    {
        var locator = new CodexWindowLocator(new FakeProbe(
        [
            new CodexWindowCandidate("w1", "Codex A", "codex", false, false),
            new CodexWindowCandidate("w2", "Codex B", "codex", true, false)
        ]));

        var method = typeof(CodexWindowLocator).GetMethod("ListWindowsAsync");
        Assert.NotNull(method);

        var task = method!.Invoke(locator, [CancellationToken.None]) as Task;
        Assert.NotNull(task);
        await task!;

        var result = task!.GetType().GetProperty("Result")!.GetValue(task)!;
        var windows = (System.Collections.IEnumerable?)result.GetType().GetProperty("Windows")!.GetValue(result);
        var totalCount = (int)result.GetType().GetProperty("TotalCount")!.GetValue(result)!;
        var activeWindowId = (string?)result.GetType().GetProperty("ActiveWindowId")!.GetValue(result);

        Assert.Equal(2, totalCount);
        Assert.Equal("w2", activeWindowId);
        Assert.Equal(2, windows!.Cast<object>().Count());
    }

    [Fact]
    public async Task WindowLocator_ListWindows_ReactsToWindowCreateAndDestroy()
    {
        var probe = new MutableProbe(
        [
            new CodexWindowCandidate("w1", "Codex A", "codex", true, false)
        ]);
        var locator = new CodexWindowLocator(probe);

        var initial = await locator.ListWindowsAsync();
        Assert.Equal(1, initial.TotalCount);
        Assert.Equal("w1", initial.ActiveWindowId);

        probe.SetCandidates([
            new CodexWindowCandidate("w1", "Codex A", "codex", false, false),
            new CodexWindowCandidate("w2", "Codex B", "codex", true, false)
        ]);

        var created = await locator.ListWindowsAsync();
        Assert.Equal(2, created.TotalCount);
        Assert.Equal("w2", created.ActiveWindowId);

        probe.SetCandidates([
            new CodexWindowCandidate("w2", "Codex B", "codex", true, false)
        ]);

        var destroyed = await locator.ListWindowsAsync();
        Assert.Equal(1, destroyed.TotalCount);
        Assert.Equal("w2", destroyed.ActiveWindowId);
    }

    [Fact]
    public async Task WindowLocator_RefreshAsync_FallsBackWhenSelectedWindowDisappears()
    {
        var probe = new MutableProbe(
        [
            new CodexWindowCandidate("w1", "Codex A", "codex", true, false),
            new CodexWindowCandidate("w2", "Codex B", "codex", false, false)
        ]);
        var locator = new CodexWindowLocator(probe);

        var selected = await locator.SelectWindowAsync("w2");
        Assert.Equal("found", selected.Status);
        Assert.Equal("w2", selected.WindowId);

        probe.SetCandidates([
            new CodexWindowCandidate("w1", "Codex A", "codex", true, false)
        ]);

        var refreshed = await locator.RefreshAsync();
        Assert.Equal("focused", refreshed.Status);
        Assert.Equal("w1", refreshed.WindowId);
        Assert.Equal(1, refreshed.CandidateCount);
    }

    private sealed class FakeProbe : ICodexWindowProbe
    {
        private readonly IReadOnlyList<CodexWindowCandidate> _candidates;

        public FakeProbe(IReadOnlyList<CodexWindowCandidate> candidates)
        {
            _candidates = candidates;
        }

        public Task<IReadOnlyList<CodexWindowCandidate>> ProbeAsync(CancellationToken cancellationToken = default)
        {
            return Task.FromResult(_candidates);
        }
    }

    private sealed class MutableProbe : ICodexWindowProbe
    {
        private readonly object _sync = new();
        private IReadOnlyList<CodexWindowCandidate> _candidates;

        public MutableProbe(IReadOnlyList<CodexWindowCandidate> candidates)
        {
            _candidates = candidates;
        }

        public void SetCandidates(IReadOnlyList<CodexWindowCandidate> candidates)
        {
            lock (_sync)
            {
                _candidates = candidates;
            }
        }

        public Task<IReadOnlyList<CodexWindowCandidate>> ProbeAsync(CancellationToken cancellationToken = default)
        {
            lock (_sync)
            {
                return Task.FromResult(_candidates);
            }
        }
    }
}
