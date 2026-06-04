namespace Ceryx.Agent.Codex.WindowLocator;

public sealed record CodexWindowCandidate(
    string WindowId,
    string Title,
    string ProcessName,
    bool IsFocused,
    bool IsMinimized,
    int ProcessId = 0
);

public sealed record CodexWindowSnapshot(
    string Status,
    string? WindowId,
    string? Title,
    string? ProcessName,
    int CandidateCount,
    DateTimeOffset LastUpdatedAt
);

public sealed record CodexWindowListSnapshot(
    IReadOnlyList<CodexWindowSnapshot> Windows,
    string? ActiveWindowId,
    int TotalCount,
    DateTimeOffset LastUpdatedAt
);
