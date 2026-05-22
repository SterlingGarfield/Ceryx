using Ceryx.Agent.Core;

namespace Ceryx.Agent.Project;

public sealed record ProjectIndexedFile(
    string Path,
    string Extension,
    bool IsTracked,
    bool IsChanged
);

public interface IProjectFileIndexService
{
    Task<Result<IReadOnlyList<ProjectIndexedFile>>> ListFilesAsync(
        ProjectConfigRecord projectConfig,
        string? query = null,
        int limit = 400,
        CancellationToken cancellationToken = default);
}

public sealed class ProjectFileIndexService : IProjectFileIndexService
{
    private const int MaxLimit = 2_000;
    private readonly IGitCommandService _gitCommandService;

    public ProjectFileIndexService(IGitCommandService gitCommandService)
    {
        _gitCommandService = gitCommandService ?? throw new ArgumentNullException(nameof(gitCommandService));
    }

    public async Task<Result<IReadOnlyList<ProjectIndexedFile>>> ListFilesAsync(
        ProjectConfigRecord projectConfig,
        string? query = null,
        int limit = 400,
        CancellationToken cancellationToken = default)
    {
        var rootValidationError = ValidateProjectRoot(projectConfig.ProjectRoot);
        if (rootValidationError is not null)
        {
            return Result<IReadOnlyList<ProjectIndexedFile>>.Failure(rootValidationError);
        }

        var effectiveLimit = Math.Clamp(limit, 1, MaxLimit);
        var trackedResult = await _gitCommandService.RunAsync(
            projectConfig.ProjectRoot,
            ["ls-files", "--"],
            cancellationToken);
        if (!trackedResult.IsSuccess || trackedResult.Value is null)
        {
            return Result<IReadOnlyList<ProjectIndexedFile>>.Failure(
                trackedResult.Error ?? CreateGitFailedError("Unable to load tracked files."));
        }

        var untrackedResult = await _gitCommandService.RunAsync(
            projectConfig.ProjectRoot,
            ["ls-files", "--others", "--exclude-standard", "--"],
            cancellationToken);
        if (!untrackedResult.IsSuccess || untrackedResult.Value is null)
        {
            return Result<IReadOnlyList<ProjectIndexedFile>>.Failure(
                untrackedResult.Error ?? CreateGitFailedError("Unable to load untracked files."));
        }

        var changedResult = await _gitCommandService.RunAsync(
            projectConfig.ProjectRoot,
            ["diff", "--name-only", "--no-renames", "--"],
            cancellationToken);
        if (!changedResult.IsSuccess || changedResult.Value is null)
        {
            return Result<IReadOnlyList<ProjectIndexedFile>>.Failure(
                changedResult.Error ?? CreateGitFailedError("Unable to load changed files."));
        }

        var tracked = ParsePaths(trackedResult.Value);
        var untracked = ParsePaths(untrackedResult.Value);
        var changed = ParsePaths(changedResult.Value);
        foreach (var path in untracked)
        {
            changed.Add(path);
        }

        var filter = NormalizeFilter(query);
        var allPaths = new HashSet<string>(tracked, StringComparer.OrdinalIgnoreCase);
        foreach (var path in untracked)
        {
            allPaths.Add(path);
        }

        var indexed = allPaths
            .Where(path => filter is null || path.Contains(filter, StringComparison.OrdinalIgnoreCase))
            .OrderBy(static path => path, StringComparer.OrdinalIgnoreCase)
            .Take(effectiveLimit)
            .Select(path => new ProjectIndexedFile(
                Path: path,
                Extension: NormalizeExtension(path),
                IsTracked: tracked.Contains(path),
                IsChanged: changed.Contains(path)))
            .ToArray();

        return Result<IReadOnlyList<ProjectIndexedFile>>.Success(indexed);
    }

    private static HashSet<string> ParsePaths(string raw)
    {
        var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in raw.Replace("\r\n", "\n", StringComparison.Ordinal)
                     .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var normalized = NormalizeRelativePath(line);
            if (normalized is not null)
            {
                result.Add(normalized);
            }
        }

        return result;
    }

    private static string NormalizeExtension(string path)
    {
        var extension = Path.GetExtension(path);
        return string.IsNullOrWhiteSpace(extension) ? string.Empty : extension.TrimStart('.').ToLowerInvariant();
    }

    private static string? NormalizeFilter(string? query)
    {
        if (string.IsNullOrWhiteSpace(query))
        {
            return null;
        }

        return query.Trim();
    }

    private static string? NormalizeRelativePath(string? input)
    {
        if (string.IsNullOrWhiteSpace(input))
        {
            return null;
        }

        var normalized = input.Trim().Replace('\\', '/');
        if (normalized.StartsWith('/'))
        {
            return null;
        }

        if (Path.IsPathRooted(normalized))
        {
            return null;
        }

        var parts = normalized.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0)
        {
            return null;
        }

        foreach (var part in parts)
        {
            if (part is "." or "..")
            {
                return null;
            }
        }

        return string.Join('/', parts);
    }

    private static AgentError? ValidateProjectRoot(string root)
    {
        if (string.IsNullOrWhiteSpace(root))
        {
            return new AgentError(
                Code: "E_PROJECT_NOT_FOUND",
                Message: "Project root is not configured.",
                TraceId: Guid.NewGuid().ToString("N"),
                Hint: "Update project configuration and retry.");
        }

        var fullPath = Path.GetFullPath(root);
        if (!Directory.Exists(fullPath))
        {
            return new AgentError(
                Code: "E_PROJECT_NOT_FOUND",
                Message: $"Project root does not exist: {fullPath}",
                TraceId: Guid.NewGuid().ToString("N"),
                Hint: "Verify project path in project_configs.");
        }

        return null;
    }

    private static AgentError CreateGitFailedError(string message)
    {
        return new AgentError(
            Code: "E_PROJECT_GIT_FAILED",
            Message: message,
            TraceId: Guid.NewGuid().ToString("N"),
            Hint: "Ensure the project path is a valid git repository.");
    }
}
