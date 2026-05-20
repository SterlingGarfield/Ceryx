namespace Ceryx.Agent.Codex.Clipboard;

public interface IClipboardService
{
    Task SetTextAsync(string text, CancellationToken cancellationToken = default);

    Task<string?> GetTextAsync(CancellationToken cancellationToken = default);
}

public sealed class MemoryClipboardService : IClipboardService
{
    private string? _text;

    public Task SetTextAsync(string text, CancellationToken cancellationToken = default)
    {
        _text = text;
        return Task.CompletedTask;
    }

    public Task<string?> GetTextAsync(CancellationToken cancellationToken = default)
    {
        return Task.FromResult(_text);
    }
}
