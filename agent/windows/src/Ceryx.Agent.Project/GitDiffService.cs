using System.Diagnostics;
using Ceryx.Agent.Core;

namespace Ceryx.Agent.Project;

public sealed record ProjectDiffFileChange(
    string Path,
    string Status,
    int Additions,
    int Deletions
);

public sealed record ProjectDiffFileDetails(
    string Path,
    string Status,
    int Additions,
    int Deletions,
    string DiffText,
    bool Truncated,
    int LineLimit
);

public interface IGitDiffService
{
    Task<Result<IReadOnlyList<ProjectDiffFileChange>>> ListChangedFilesAsync(
        ProjectConfigRecord projectConfig,
        CancellationToken cancellationToken = default);

    Task<Result<ProjectDiffFileDetails>> GetFileDiffAsync(
        ProjectConfigRecord projectConfig,
        string relativePath,
        int lineLimit,
        CancellationToken cancellationToken = default);
}

public interface IGitCommandService
{
    Task<Result<string>> RunAsync(
        string workingDirectory,
        IReadOnlyList<string> arguments,
        CancellationToken cancellationToken = default);
}

public sealed class GitCommandService : IGitCommandService
{
    public async Task<Result<string>> RunAsync(
        string workingDirectory,
        IReadOnlyList<string> arguments,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(workingDirectory);
        ArgumentNullException.ThrowIfNull(arguments);

        var startInfo = new ProcessStartInfo
        {
            FileName = "git",
            WorkingDirectory = workingDirectory,
            RedirectStandardError = true,
            RedirectStandardOutput = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        foreach (var argument in arguments)
        {
            startInfo.ArgumentList.Add(argument);
        }

        using var process = new Process { StartInfo = startInfo };
        try
        {
            if (!process.Start())
            {
                return Result<string>.Failure(new AgentError(
                    Code: "E_PROJECT_GIT_FAILED",
                    Message: "Failed to start git process.",
                    TraceId: Guid.NewGuid().ToString("N"),
                    Hint: "Check whether git is installed and available in PATH."));
            }
        }
        catch (Exception ex)
        {
            return Result<string>.Failure(new AgentError(
                Code: "E_PROJECT_GIT_FAILED",
                Message: $"Failed to start git process: {ex.Message}",
                TraceId: Guid.NewGuid().ToString("N"),
                Hint: "Check whether git is installed and available in PATH."));
        }

        var outputTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var errorTask = process.StandardError.ReadToEndAsync(cancellationToken);
        await process.WaitForExitAsync(cancellationToken);

        var output = await outputTask;
        var error = await errorTask;

        if (process.ExitCode != 0)
        {
            var message = string.IsNullOrWhiteSpace(error)
                ? "Git command failed."
                : error.Trim();
            return Result<string>.Failure(new AgentError(
                Code: "E_PROJECT_GIT_FAILED",
                Message: message,
                TraceId: Guid.NewGuid().ToString("N"),
                Hint: "Verify project root is a valid git repository."));
        }

        return Result<string>.Success(output);
    }
}

public sealed class GitDiffService : IGitDiffService
{
    private readonly IGitCommandService _gitCommandService;

    public GitDiffService(IGitCommandService gitCommandService)
    {
        _gitCommandService = gitCommandService ?? throw new ArgumentNullException(nameof(gitCommandService));
    }

    public async Task<Result<IReadOnlyList<ProjectDiffFileChange>>> ListChangedFilesAsync(
        ProjectConfigRecord projectConfig,
        CancellationToken cancellationToken = default)
    {
        var rootValidationError = ValidateProjectRoot(projectConfig.ProjectRoot);
        if (rootValidationError is not null)
        {
            return Result<IReadOnlyList<ProjectDiffFileChange>>.Failure(rootValidationError);
        }

        var statusResult = await _gitCommandService.RunAsync(
            projectConfig.ProjectRoot,
            ["diff", "--name-status", "--no-renames", "--"],
            cancellationToken);
        if (!statusResult.IsSuccess || statusResult.Value is null)
        {
            return Result<IReadOnlyList<ProjectDiffFileChange>>.Failure(
                statusResult.Error ?? CreateGitFailedError("Unable to list changed files."));
        }

        var statsResult = await _gitCommandService.RunAsync(
            projectConfig.ProjectRoot,
            ["diff", "--numstat", "--no-renames", "--"],
            cancellationToken);
        if (!statsResult.IsSuccess || statsResult.Value is null)
        {
            return Result<IReadOnlyList<ProjectDiffFileChange>>.Failure(
                statsResult.Error ?? CreateGitFailedError("Unable to list diff stats."));
        }

        var statuses = ParseNameStatus(statusResult.Value);
        var stats = ParseNumStat(statsResult.Value);

        var orderedPaths = new List<string>();
        foreach (var path in statuses.Keys)
        {
            orderedPaths.Add(path);
        }

        foreach (var path in stats.Keys)
        {
            if (!statuses.ContainsKey(path))
            {
                orderedPaths.Add(path);
            }
        }

        var files = new List<ProjectDiffFileChange>(orderedPaths.Count);
        foreach (var path in orderedPaths)
        {
            var status = statuses.TryGetValue(path, out var value) ? value : "modified";
            var numbers = stats.TryGetValue(path, out var stat) ? stat : (Additions: 0, Deletions: 0);
            files.Add(new ProjectDiffFileChange(path, status, numbers.Additions, numbers.Deletions));
        }

        return Result<IReadOnlyList<ProjectDiffFileChange>>.Success(files);
    }

    public async Task<Result<ProjectDiffFileDetails>> GetFileDiffAsync(
        ProjectConfigRecord projectConfig,
        string relativePath,
        int lineLimit,
        CancellationToken cancellationToken = default)
    {
        var normalizedPath = NormalizeRelativePath(relativePath);
        if (normalizedPath is null)
        {
            return Result<ProjectDiffFileDetails>.Failure(new AgentError(
                Code: "E_DIFF_PATH_INVALID",
                Message: "path query parameter is invalid.",
                TraceId: Guid.NewGuid().ToString("N"),
                Hint: "Use a project-relative file path like src/main.ts."));
        }

        var effectiveLineLimit = lineLimit > 0 ? lineLimit : 1200;

        var listResult = await ListChangedFilesAsync(projectConfig, cancellationToken);
        if (!listResult.IsSuccess || listResult.Value is null)
        {
            return Result<ProjectDiffFileDetails>.Failure(
                listResult.Error ?? CreateGitFailedError("Unable to load changed files."));
        }

        var file = listResult.Value.FirstOrDefault(item =>
            string.Equals(item.Path, normalizedPath, StringComparison.OrdinalIgnoreCase));
        if (file is null)
        {
            return Result<ProjectDiffFileDetails>.Failure(new AgentError(
                Code: "E_DIFF_FILE_NOT_FOUND",
                Message: $"Diff file '{normalizedPath}' not found.",
                TraceId: Guid.NewGuid().ToString("N"),
                Hint: "Load /api/v1/project/diff/files and select a file from the returned list."));
        }

        var diffResult = await _gitCommandService.RunAsync(
            projectConfig.ProjectRoot,
            ["diff", "--no-color", "--", normalizedPath],
            cancellationToken);
        if (!diffResult.IsSuccess || diffResult.Value is null)
        {
            return Result<ProjectDiffFileDetails>.Failure(
                diffResult.Error ?? CreateGitFailedError("Unable to load file diff."));
        }

        var lines = SplitLines(diffResult.Value);
        var truncated = lines.Count > effectiveLineLimit;
        var selectedLines = truncated ? lines.Take(effectiveLineLimit).ToArray() : lines.ToArray();
        var text = string.Join(Environment.NewLine, selectedLines);

        return Result<ProjectDiffFileDetails>.Success(new ProjectDiffFileDetails(
            Path: file.Path,
            Status: file.Status,
            Additions: file.Additions,
            Deletions: file.Deletions,
            DiffText: text,
            Truncated: truncated,
            LineLimit: effectiveLineLimit));
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

    private static Dictionary<string, string> ParseNameStatus(string raw)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in SplitLines(raw))
        {
            var parts = line.Split('\t', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 2)
            {
                continue;
            }

            var status = MapStatus(parts[0]);
            var path = NormalizeDiffPath(parts[^1]);
            if (path is null)
            {
                continue;
            }

            result[path] = status;
        }

        return result;
    }

    private static Dictionary<string, (int Additions, int Deletions)> ParseNumStat(string raw)
    {
        var result = new Dictionary<string, (int Additions, int Deletions)>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in SplitLines(raw))
        {
            var parts = line.Split('\t', StringSplitOptions.None);
            if (parts.Length < 3)
            {
                continue;
            }

            var path = NormalizeDiffPath(parts[2]);
            if (path is null)
            {
                continue;
            }

            var additions = int.TryParse(parts[0], out var addValue) ? addValue : 0;
            var deletions = int.TryParse(parts[1], out var deleteValue) ? deleteValue : 0;
            result[path] = (additions, deletions);
        }

        return result;
    }

    private static IReadOnlyList<string> SplitLines(string raw)
    {
        return raw.Replace("\r\n", "\n", StringComparison.Ordinal)
            .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    }

    private static string? NormalizeDiffPath(string input)
    {
        return NormalizeRelativePath(input);
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

    private static string MapStatus(string raw)
    {
        return raw.Trim().ToUpperInvariant() switch
        {
            "A" => "added",
            "D" => "deleted",
            "R" => "renamed",
            "C" => "copied",
            "U" => "unmerged",
            _ => "modified"
        };
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
