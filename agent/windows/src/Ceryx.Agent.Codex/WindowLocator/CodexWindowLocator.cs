namespace Ceryx.Agent.Codex.WindowLocator;

public sealed class CodexWindowLocator : ICodexWindowLocator
{
    private readonly object _sync = new();
    private readonly ICodexWindowProbe _probe;

    private string? _selectedWindowId;
    private CodexWindowSnapshot? _lastSnapshot;

    public CodexWindowLocator(ICodexWindowProbe probe)
    {
        _probe = probe ?? throw new ArgumentNullException(nameof(probe));
    }

    public async Task<CodexWindowSnapshot> GetWindowAsync(CancellationToken cancellationToken = default)
    {
        lock (_sync)
        {
            if (_lastSnapshot is not null)
            {
                return _lastSnapshot;
            }
        }

        return await RefreshAsync(cancellationToken);
    }

    public async Task<CodexWindowSnapshot> RefreshAsync(CancellationToken cancellationToken = default)
    {
        var candidates = await _probe.ProbeAsync(cancellationToken);
        var snapshot = ResolveSnapshot(candidates, focusedOverride: false);
        lock (_sync)
        {
            _lastSnapshot = snapshot;
        }

        return snapshot;
    }

    public async Task<CodexWindowSnapshot> FocusAsync(CancellationToken cancellationToken = default)
    {
        var current = await RefreshAsync(cancellationToken);
        if (current.WindowId is null ||
            current.Status is "not_found" or "multiple_candidates" or "permission_issue")
        {
            return current;
        }

        var focused = current with { Status = "focused", LastUpdatedAt = DateTimeOffset.UtcNow };
        lock (_sync)
        {
            _lastSnapshot = focused;
        }

        return focused;
    }

    public async Task<CodexWindowSnapshot> SelectWindowAsync(string windowId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(windowId);

        lock (_sync)
        {
            _selectedWindowId = windowId;
        }

        return await RefreshAsync(cancellationToken);
    }

    private CodexWindowSnapshot ResolveSnapshot(
        IReadOnlyList<CodexWindowCandidate> candidates,
        bool focusedOverride)
    {
        var now = DateTimeOffset.UtcNow;
        if (candidates.Count == 0)
        {
            return new CodexWindowSnapshot(
                Status: "not_found",
                WindowId: null,
                Title: null,
                ProcessName: null,
                CandidateCount: 0,
                LastUpdatedAt: now);
        }

        CodexWindowCandidate? selected = null;
        lock (_sync)
        {
            if (!string.IsNullOrWhiteSpace(_selectedWindowId))
            {
                selected = candidates.FirstOrDefault(candidate =>
                    string.Equals(candidate.WindowId, _selectedWindowId, StringComparison.OrdinalIgnoreCase));
            }
        }

        if (selected is null && candidates.Count > 1)
        {
            return new CodexWindowSnapshot(
                Status: "multiple_candidates",
                WindowId: null,
                Title: null,
                ProcessName: null,
                CandidateCount: candidates.Count,
                LastUpdatedAt: now);
        }

        var winner = selected ?? candidates[0];
        var status = winner.IsMinimized
            ? "minimized"
            : (focusedOverride || winner.IsFocused ? "focused" : "found");

        return new CodexWindowSnapshot(
            Status: status,
            WindowId: winner.WindowId,
            Title: winner.Title,
            ProcessName: winner.ProcessName,
            CandidateCount: candidates.Count,
            LastUpdatedAt: now);
    }
}
