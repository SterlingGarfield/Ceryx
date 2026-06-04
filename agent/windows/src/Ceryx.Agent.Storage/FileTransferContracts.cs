using Ceryx.Agent.Core;

namespace Ceryx.Agent.Storage;

public sealed record FileTransferRecord(
    string FileId,
    string FileName,
    long SizeBytes,
    string MimeType,
    string StoredPath,
    DateTimeOffset UploadedAt,
    string? TargetPath);

public sealed record FileTransferUploadResponse(
    bool Ok,
    string FileId,
    string FileName,
    long SizeBytes,
    string MimeType,
    string StoredPath,
    DateTimeOffset UploadedAt,
    string? TargetPath);

public sealed record FileTransferEntryResponse(
    string FileId,
    string FileName,
    long SizeBytes,
    string MimeType,
    string StoredPath,
    DateTimeOffset UploadedAt,
    string? TargetPath);

public sealed record FileTransferListResponse(
    bool Ok,
    string Path,
    int Limit,
    int Total,
    FileTransferEntryResponse[] Files);

public sealed record FileTransferDeleteResponse(
    bool Ok,
    bool Deleted,
    string FileId);

public interface IFileTransferService
{
    Task<Result<FileTransferRecord>> UploadAsync(
        string fileName,
        string mimeType,
        string? targetPath,
        Stream content,
        CancellationToken cancellationToken = default);

    Task<Result<IReadOnlyList<FileTransferRecord>>> ListAsync(
        string? path,
        int limit,
        CancellationToken cancellationToken = default);

    Task<Result<FileTransferRecord>> GetAsync(
        string fileId,
        CancellationToken cancellationToken = default);

    Task<Result<FileTransferRecord>> DeleteAsync(
        string fileId,
        CancellationToken cancellationToken = default);
}
