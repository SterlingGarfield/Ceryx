namespace Ceryx.Agent.Codex.WindowLocator;

public interface ICodexWindowLocator
{
    Task<CodexWindowSnapshot> GetWindowAsync(CancellationToken cancellationToken = default);

    Task<CodexWindowSnapshot> RefreshAsync(CancellationToken cancellationToken = default);

    Task<CodexWindowSnapshot> FocusAsync(CancellationToken cancellationToken = default);

    Task<CodexWindowSnapshot> SelectWindowAsync(string windowId, CancellationToken cancellationToken = default);
}
