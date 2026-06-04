using System.Text.Json;
using Ceryx.Agent.Core;
using Ceryx.Agent.Storage;

namespace Ceryx.Agent.Media;

public sealed class RecordingCatalogService : IRecordingCatalogService
{
    private const string MetadataFileName = "metadata.json";
    private readonly LocalPaths _localPaths;

    public RecordingCatalogService(LocalPaths localPaths)
    {
        _localPaths = localPaths ?? throw new ArgumentNullException(nameof(localPaths));
    }

    public Task<Result<IReadOnlyList<RecordingCatalogEntry>>> ListAsync(
        int limit,
        CancellationToken cancellationToken = default)
    {
        if (limit <= 0)
        {
            return Task.FromResult(Result<IReadOnlyList<RecordingCatalogEntry>>.Failure(new AgentError(
                Code: "E_INVALID_REQUEST",
                Message: "limit must be greater than 0.",
                TraceId: "trace_recording_limit")));
        }

        var entries = new List<RecordingCatalogEntry>();
        foreach (var manifestPath in EnumerateManifestPaths())
        {
            cancellationToken.ThrowIfCancellationRequested();
            var entry = ReadEntry(manifestPath);
            if (entry is not null)
            {
                entries.Add(entry);
            }
        }

        var ordered = entries
            .OrderByDescending(entry => entry.StoppedAt, StringComparer.Ordinal)
            .Take(limit)
            .ToArray();

        return Task.FromResult(Result<IReadOnlyList<RecordingCatalogEntry>>.Success(ordered));
    }

    public Task<Result<RecordingCatalogEntry>> GetByFileNameAsync(
        string fileName,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(fileName))
        {
            return Task.FromResult(Result<RecordingCatalogEntry>.Failure(new AgentError(
                Code: "E_INVALID_REQUEST",
                Message: "fileName is required.",
                TraceId: "trace_recording_file")));
        }

        foreach (var manifestPath in EnumerateManifestPaths())
        {
            cancellationToken.ThrowIfCancellationRequested();
            var entry = ReadEntry(manifestPath);
            if (entry is null)
            {
                continue;
            }

            if (IsMatchingEntry(entry, fileName))
            {
                return Task.FromResult(Result<RecordingCatalogEntry>.Success(entry));
            }
        }

        return Task.FromResult(Result<RecordingCatalogEntry>.Failure(new AgentError(
            Code: "E_RECORDING_NOT_FOUND",
            Message: $"Recording '{fileName}' was not found.",
            TraceId: "trace_recording_missing")));
    }

    public async Task<Result<Stream>> OpenFileAsync(
        string fileName,
        CancellationToken cancellationToken = default)
    {
        var manifestResult = await GetByFileNameAsync(fileName, cancellationToken);
        if (!manifestResult.IsSuccess || manifestResult.Value is null)
        {
            return Result<Stream>.Failure(manifestResult.Error ?? new AgentError(
                Code: "E_RECORDING_NOT_FOUND",
                Message: $"Recording '{fileName}' was not found.",
                TraceId: "trace_recording_missing_stream"));
        }

        var path = ResolveFilePath(manifestResult.Value, fileName);
        if (path is null || !File.Exists(path))
        {
            return Result<Stream>.Failure(new AgentError(
                Code: "E_RECORDING_NOT_FOUND",
                Message: $"Recording file '{fileName}' was not found.",
                TraceId: "trace_recording_file_missing"));
        }

        var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        return Result<Stream>.Success(stream);
    }

    private IEnumerable<string> EnumerateManifestPaths()
    {
        if (!Directory.Exists(_localPaths.Recordings))
        {
            yield break;
        }

        foreach (var directory in Directory.EnumerateDirectories(_localPaths.Recordings))
        {
            var manifestPath = Path.Combine(directory, MetadataFileName);
            if (File.Exists(manifestPath))
            {
                yield return manifestPath;
            }
        }
    }

    private static RecordingCatalogEntry? ReadEntry(string manifestPath)
    {
        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(manifestPath));
            var root = document.RootElement;
            return new RecordingCatalogEntry(
                RecordingId: root.GetProperty("recordingId").GetString() ?? Path.GetFileNameWithoutExtension(Path.GetDirectoryName(manifestPath)),
                FileName: root.GetProperty("fileName").GetString() ?? string.Empty,
                SizeBytes: root.GetProperty("sizeBytes").GetInt64(),
                DurationSeconds: root.GetProperty("durationSeconds").GetDouble(),
                AudioEnabled: root.GetProperty("audioEnabled").GetBoolean(),
                AudioFormat: root.GetProperty("audioFormat").GetString() ?? "none",
                ThumbnailFileName: root.TryGetProperty("thumbnailFileName", out var thumbnail) ? thumbnail.GetString() : null,
                OutputPaths: ReadStringArray(root, "outputPaths"),
                StartedAt: root.GetProperty("startedAt").GetString() ?? string.Empty,
                StoppedAt: root.GetProperty("stoppedAt").GetString() ?? string.Empty);
        }
        catch
        {
            return null;
        }
    }

    private static IReadOnlyList<string> ReadStringArray(JsonElement root, string propertyName)
    {
        if (!root.TryGetProperty(propertyName, out var property) || property.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<string>();
        }

        var values = new List<string>();
        foreach (var item in property.EnumerateArray())
        {
            var value = item.GetString();
            if (!string.IsNullOrWhiteSpace(value))
            {
                values.Add(value);
            }
        }

        return values;
    }

    private static bool IsMatchingEntry(RecordingCatalogEntry entry, string fileName)
    {
        if (string.Equals(entry.FileName, fileName, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (string.Equals(entry.ThumbnailFileName, fileName, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return entry.OutputPaths.Any(path =>
            string.Equals(Path.GetFileName(path), fileName, StringComparison.OrdinalIgnoreCase) ||
            string.Equals(path, fileName, StringComparison.OrdinalIgnoreCase));
    }

    private static string? ResolveFilePath(RecordingCatalogEntry entry, string fileName)
    {
        foreach (var path in entry.OutputPaths)
        {
            if (string.Equals(Path.GetFileName(path), fileName, StringComparison.OrdinalIgnoreCase) ||
                string.Equals(path, fileName, StringComparison.OrdinalIgnoreCase))
            {
                return path;
            }
        }

        if (!string.IsNullOrWhiteSpace(entry.ThumbnailFileName) &&
            string.Equals(entry.ThumbnailFileName, fileName, StringComparison.OrdinalIgnoreCase))
        {
            return entry.OutputPaths
                .Select(Path.GetDirectoryName)
                .FirstOrDefault(directory => !string.IsNullOrWhiteSpace(directory))
                is { } directory
                ? Path.Combine(directory, entry.ThumbnailFileName)
                : null;
        }

        if (string.Equals(entry.FileName, fileName, StringComparison.OrdinalIgnoreCase))
        {
            return entry.OutputPaths.FirstOrDefault();
        }

        return null;
    }
}
