namespace Ceryx.Agent.Codex.WindowLocator;

public interface ICodexWindowProbe
{
    Task<IReadOnlyList<CodexWindowCandidate>> ProbeAsync(CancellationToken cancellationToken = default);
}
