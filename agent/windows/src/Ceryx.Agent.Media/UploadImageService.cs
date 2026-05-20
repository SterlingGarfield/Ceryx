using Ceryx.Agent.Core;
using Ceryx.Agent.Storage;

namespace Ceryx.Agent.Media;

public sealed class UploadImageService : IUploadImageService
{
    private const long MaxUploadBytes = 20 * 1024 * 1024;
    private static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".png", ".jpg", ".jpeg", ".webp"
    };

    private readonly LocalPaths _localPaths;

    public UploadImageService(LocalPaths localPaths)
    {
        _localPaths = localPaths ?? throw new ArgumentNullException(nameof(localPaths));
    }

    public async Task<Result<UploadImageResponse>> UploadImageAsync(
        string fileName,
        Stream content,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(fileName);
        ArgumentNullException.ThrowIfNull(content);

        var extension = Path.GetExtension(fileName);
        if (string.IsNullOrWhiteSpace(extension) || !AllowedExtensions.Contains(extension))
        {
            return Result<UploadImageResponse>.Failure(new AgentError(
                Code: "E_CAPTURE_DENIED",
                Message: "Unsupported image extension.",
                TraceId: "trace_upload_ext"));
        }

        await using var copyStream = new MemoryStream();
        await content.CopyToAsync(copyStream, cancellationToken);
        if (copyStream.Length > MaxUploadBytes)
        {
            return Result<UploadImageResponse>.Failure(new AgentError(
                Code: "E_UPLOAD_TOO_LARGE",
                Message: "Upload exceeds 20MB limit.",
                TraceId: "trace_upload_limit"));
        }

        var assetId = "asset_" + Guid.NewGuid().ToString("N");
        var safeFileName = $"{assetId}{extension.ToLowerInvariant()}";
        var destination = Path.Combine(_localPaths.Uploads, safeFileName);

        copyStream.Position = 0;
        await using var destinationStream = File.Create(destination);
        await copyStream.CopyToAsync(destinationStream, cancellationToken);
        await destinationStream.FlushAsync(cancellationToken);

        return Result<UploadImageResponse>.Success(new UploadImageResponse(
            Ok: true,
            AssetId: assetId,
            FileName: safeFileName,
            SizeBytes: copyStream.Length));
    }
}
