using System.Buffers;
using System.Text.Json;
using Ceryx.Agent.Core;

namespace Ceryx.Agent.Storage;

public sealed class FileTransferService : IFileTransferService
{
    private const long DefaultMaxUploadBytes = 100 * 1024 * 1024;
    private const string DefaultContentType = "application/octet-stream";
    private const string UploadsFolderName = "files";
    private const string MetadataFileName = "metadata.json";

    private readonly string _baseDirectory;
    private readonly long _maxUploadBytes;

    public FileTransferService(LocalPaths localPaths)
        : this(localPaths, DefaultMaxUploadBytes)
    {
    }

    public FileTransferService(LocalPaths localPaths, long maxUploadBytes)
    {
        ArgumentNullException.ThrowIfNull(localPaths);

        if (maxUploadBytes <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(maxUploadBytes));
        }

        _baseDirectory = Path.Combine(localPaths.Uploads, UploadsFolderName);
        _maxUploadBytes = maxUploadBytes;
        Directory.CreateDirectory(_baseDirectory);
    }

    public async Task<Result<FileTransferRecord>> UploadAsync(
        string fileName,
        string mimeType,
        string? targetPath,
        Stream content,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(fileName))
        {
            return Result<FileTransferRecord>.Failure(CreateInvalidRequestError(
                "File name is required."));
        }

        ArgumentNullException.ThrowIfNull(content);

        var normalizedTargetPathResult = NormalizeTargetPath(targetPath);
        if (!normalizedTargetPathResult.IsSuccess)
        {
            return Result<FileTransferRecord>.Failure(normalizedTargetPathResult.Error!);
        }

        var normalizedFileName = NormalizeFileName(fileName);
        var fileId = "file_" + Guid.NewGuid().ToString("N");
        var fileDirectory = BuildFileDirectory(normalizedTargetPathResult.Value, fileId);
        Directory.CreateDirectory(fileDirectory);

        var storedPath = Path.Combine(fileDirectory, normalizedFileName);
        var uploadTime = DateTimeOffset.UtcNow;
        var totalBytes = 0L;
        AgentError? uploadError = null;

        await using (var destination = new FileStream(
            storedPath,
            FileMode.CreateNew,
            FileAccess.Write,
            FileShare.Read,
            bufferSize: 81920,
            FileOptions.Asynchronous | FileOptions.SequentialScan))
        {
            var buffer = ArrayPool<byte>.Shared.Rent(81920);
            try
            {
                while (true)
                {
                    var read = await content.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken);
                    if (read <= 0)
                    {
                        break;
                    }

                    totalBytes += read;
                    if (totalBytes > _maxUploadBytes)
                    {
                        uploadError = new AgentError(
                            Code: "E_FILE_TOO_LARGE",
                            Message: $"Upload exceeds {_maxUploadBytes / (1024 * 1024)}MB limit.",
                            TraceId: "trace_file_limit");
                        break;
                    }

                    await destination.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
                }

                if (uploadError is null)
                {
                    await destination.FlushAsync(cancellationToken);
                }
            }
            finally
            {
                ArrayPool<byte>.Shared.Return(buffer);
            }
        }

        if (uploadError is not null)
        {
            return await FailUploadAsync(storedPath, fileDirectory, uploadError);
        }

        var record = new FileTransferRecord(
            FileId: fileId,
            FileName: normalizedFileName,
            SizeBytes: totalBytes,
            MimeType: string.IsNullOrWhiteSpace(mimeType) ? DefaultContentType : mimeType,
            StoredPath: Path.GetFullPath(storedPath),
            UploadedAt: uploadTime,
            TargetPath: normalizedTargetPathResult.Value);

        await WriteMetadataAsync(fileDirectory, record, cancellationToken);
        return Result<FileTransferRecord>.Success(record);
    }

    public async Task<Result<IReadOnlyList<FileTransferRecord>>> ListAsync(
        string? path,
        int limit,
        CancellationToken cancellationToken = default)
    {
        var effectiveLimit = Math.Clamp(limit, 1, 500);
        var normalizedPathResult = NormalizeListPath(path);
        if (!normalizedPathResult.IsSuccess)
        {
            return Result<IReadOnlyList<FileTransferRecord>>.Failure(normalizedPathResult.Error!);
        }

        var entries = new List<FileTransferRecord>();
        foreach (var metadataPath in EnumerateMetadataFiles())
        {
            cancellationToken.ThrowIfCancellationRequested();
            var record = await ReadMetadataAsync(metadataPath, cancellationToken);
            if (record is null)
            {
                continue;
            }

            if (normalizedPathResult.Value is not null &&
                !MatchesFilter(record.TargetPath, normalizedPathResult.Value))
            {
                continue;
            }

            entries.Add(record);
        }

        var ordered = entries
            .OrderByDescending(static entry => entry.UploadedAt)
            .Take(effectiveLimit)
            .ToArray();

        return Result<IReadOnlyList<FileTransferRecord>>.Success(ordered);
    }

    public async Task<Result<FileTransferRecord>> GetAsync(
        string fileId,
        CancellationToken cancellationToken = default)
    {
        var metadataPath = FindMetadataPath(fileId);
        if (metadataPath is null)
        {
            return Result<FileTransferRecord>.Failure(CreateNotFoundError(fileId));
        }

        var record = await ReadMetadataAsync(metadataPath, cancellationToken);
        if (record is null)
        {
            return Result<FileTransferRecord>.Failure(CreateNotFoundError(fileId));
        }

        return Result<FileTransferRecord>.Success(record);
    }

    public async Task<Result<FileTransferRecord>> DeleteAsync(
        string fileId,
        CancellationToken cancellationToken = default)
    {
        var metadataPath = FindMetadataPath(fileId);
        if (metadataPath is null)
        {
            return Result<FileTransferRecord>.Failure(CreateNotFoundError(fileId));
        }

        var record = await ReadMetadataAsync(metadataPath, cancellationToken);
        if (record is null)
        {
            return Result<FileTransferRecord>.Failure(CreateNotFoundError(fileId));
        }

        var fileDirectory = Path.GetDirectoryName(metadataPath) ?? _baseDirectory;
        try
        {
            if (Directory.Exists(fileDirectory))
            {
                Directory.Delete(fileDirectory, recursive: true);
            }
            else if (File.Exists(record.StoredPath))
            {
                File.Delete(record.StoredPath);
                File.Delete(metadataPath);
            }
        }
        catch (IOException ex)
        {
            return Result<FileTransferRecord>.Failure(new AgentError(
                Code: "E_FILE_UPLOAD_FAILED",
                Message: $"Failed to delete file '{fileId}'. {ex.Message}",
                TraceId: Guid.NewGuid().ToString("N")));
        }
        catch (UnauthorizedAccessException ex)
        {
            return Result<FileTransferRecord>.Failure(new AgentError(
                Code: "E_FILE_UPLOAD_FAILED",
                Message: $"Failed to delete file '{fileId}'. {ex.Message}",
                TraceId: Guid.NewGuid().ToString("N")));
        }

        return Result<FileTransferRecord>.Success(record);
    }

    private IEnumerable<string> EnumerateMetadataFiles()
    {
        if (!Directory.Exists(_baseDirectory))
        {
            yield break;
        }

        foreach (var metadataPath in Directory.EnumerateFiles(_baseDirectory, MetadataFileName, SearchOption.AllDirectories))
        {
            yield return metadataPath;
        }
    }

    private string? FindMetadataPath(string fileId)
    {
        if (string.IsNullOrWhiteSpace(fileId) || !Directory.Exists(_baseDirectory))
        {
            return null;
        }

        return Directory.EnumerateFiles(_baseDirectory, MetadataFileName, SearchOption.AllDirectories)
            .FirstOrDefault(path => string.Equals(ReadFileIdFromMetadataPath(path), fileId, StringComparison.OrdinalIgnoreCase));
    }

    private static string? ReadFileIdFromMetadataPath(string metadataPath)
    {
        var directory = Path.GetDirectoryName(metadataPath);
        return string.IsNullOrWhiteSpace(directory)
            ? null
            : Path.GetFileName(directory);
    }

    private static bool MatchesFilter(string? targetPath, string filter)
    {
        if (string.IsNullOrWhiteSpace(filter))
        {
            return true;
        }

        if (string.IsNullOrWhiteSpace(targetPath))
        {
            return false;
        }

        return targetPath.Equals(filter, StringComparison.OrdinalIgnoreCase) ||
               targetPath.StartsWith(filter + "/", StringComparison.OrdinalIgnoreCase);
    }

    private static Result<string?> NormalizeListPath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path) ||
            string.Equals(path.Trim(), "uploads", StringComparison.OrdinalIgnoreCase))
        {
            return Result<string?>.Success(null);
        }

        var normalized = NormalizeRelativePath(path);
        if (normalized is null)
        {
            return Result<string?>.Failure(CreateInvalidRequestError("Path must be relative to the uploads root."));
        }

        return Result<string?>.Success(normalized);
    }

    private static Result<string?> NormalizeTargetPath(string? targetPath)
    {
        if (string.IsNullOrWhiteSpace(targetPath))
        {
            return Result<string?>.Success(null);
        }

        if (string.Equals(targetPath.Trim(), "uploads", StringComparison.OrdinalIgnoreCase))
        {
            return Result<string?>.Success(null);
        }

        var normalized = NormalizeRelativePath(targetPath);
        if (normalized is null)
        {
            return Result<string?>.Failure(CreateInvalidRequestError("targetPath must be relative to the uploads root."));
        }

        return Result<string?>.Success(normalized);
    }

    private static string? NormalizeRelativePath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return null;
        }

        var trimmed = path.Trim().Replace('\\', '/');
        if (trimmed.StartsWith("/", StringComparison.Ordinal) || trimmed.Contains(":", StringComparison.Ordinal))
        {
            return null;
        }

        var segments = trimmed.Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (segments.Length == 0)
        {
            return null;
        }

        var sanitizedSegments = new List<string>(segments.Length);
        foreach (var segment in segments)
        {
            if (segment is "." or "..")
            {
                return null;
            }

            sanitizedSegments.Add(SanitizePathSegment(segment));
        }

        return string.Join("/", sanitizedSegments);
    }

    private static string SanitizePathSegment(string segment)
    {
        var invalidChars = Path.GetInvalidFileNameChars();
        var builder = new System.Text.StringBuilder(segment.Length);
        foreach (var character in segment)
        {
            builder.Append(invalidChars.Contains(character) || character is '/' or '\\' ? '_' : character);
        }

        var sanitized = builder.ToString().Trim();
        return string.IsNullOrWhiteSpace(sanitized) ? "_" : sanitized;
    }

    private static string NormalizeFileName(string fileName)
    {
        var safeName = Path.GetFileName(fileName);
        if (string.IsNullOrWhiteSpace(safeName))
        {
            safeName = "upload.bin";
        }

        return SanitizePathSegment(safeName);
    }

    private string BuildFileDirectory(string? targetPath, string fileId)
    {
        var targetDirectory = string.IsNullOrWhiteSpace(targetPath)
            ? _baseDirectory
            : Path.Combine(_baseDirectory, targetPath.Replace('/', Path.DirectorySeparatorChar));
        var fileDirectory = Path.Combine(targetDirectory, fileId);
        var fullPath = Path.GetFullPath(fileDirectory);
        if (!fullPath.StartsWith(Path.GetFullPath(_baseDirectory).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(fullPath, Path.GetFullPath(_baseDirectory), StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException($"Resolved file path '{fullPath}' escaped the uploads root.");
        }

        return fullPath;
    }

    private static async Task WriteMetadataAsync(
        string fileDirectory,
        FileTransferRecord record,
        CancellationToken cancellationToken)
    {
        var metadataPath = Path.Combine(fileDirectory, MetadataFileName);
        await using var stream = File.Create(metadataPath);
        await JsonSerializer.SerializeAsync(stream, record, cancellationToken: cancellationToken);
        await stream.FlushAsync(cancellationToken);
    }

    private static async Task<FileTransferRecord?> ReadMetadataAsync(
        string metadataPath,
        CancellationToken cancellationToken)
    {
        if (!File.Exists(metadataPath))
        {
            return null;
        }

        await using var stream = File.Open(metadataPath, FileMode.Open, FileAccess.Read, FileShare.Read);
        return await JsonSerializer.DeserializeAsync<FileTransferRecord>(stream, cancellationToken: cancellationToken);
    }

    private async Task<Result<FileTransferRecord>> FailUploadAsync(
        string storedPath,
        string fileDirectory,
        AgentError error)
    {
        try
        {
            if (File.Exists(storedPath))
            {
                File.Delete(storedPath);
            }

            if (Directory.Exists(fileDirectory))
            {
                Directory.Delete(fileDirectory, recursive: true);
            }
        }
        catch
        {
            // Best effort cleanup. The caller only needs the original failure.
        }

        return await Task.FromResult(Result<FileTransferRecord>.Failure(error));
    }

    private static AgentError CreateInvalidRequestError(string message)
    {
        return new AgentError(
            Code: "E_FILE_INVALID_REQUEST",
            Message: message,
            TraceId: Guid.NewGuid().ToString("N"));
    }

    private static AgentError CreateNotFoundError(string fileId)
    {
        return new AgentError(
            Code: "E_FILE_NOT_FOUND",
            Message: $"File '{fileId}' was not found.",
            TraceId: Guid.NewGuid().ToString("N"));
    }
}
