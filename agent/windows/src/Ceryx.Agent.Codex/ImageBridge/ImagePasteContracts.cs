namespace Ceryx.Agent.Codex.ImageBridge;

public interface IImagePasteService
{
    Task<bool> TryPasteImageAsync(string absolutePath, CancellationToken cancellationToken = default);
}

public sealed class NoOpImagePasteService : IImagePasteService
{
    public Task<bool> TryPasteImageAsync(string absolutePath, CancellationToken cancellationToken = default)
    {
        return Task.FromResult(File.Exists(absolutePath));
    }
}
