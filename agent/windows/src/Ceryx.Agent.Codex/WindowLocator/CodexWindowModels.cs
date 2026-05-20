namespace Ceryx.Agent.Codex.WindowLocator;

public sealed record CodexWindowCandidate(
    string WindowId,
    string Title,
    string ProcessName,
    bool IsFocused,
    bool IsMinimized
);

public sealed record CodexWindowSnapshot(
    string Status,
    string? WindowId,
    string? Title,
    string? ProcessName,
    int CandidateCount,
    DateTimeOffset LastUpdatedAt
);
