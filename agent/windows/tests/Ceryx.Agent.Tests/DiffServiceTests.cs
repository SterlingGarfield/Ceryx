using Ceryx.Agent.Project;
using Xunit;

namespace Ceryx.Agent.Tests;

public sealed class DiffServiceTests
{
    [Fact]
    public async Task ListChangedFilesAsync_ReturnsPerFileStats()
    {
        await WithWorkspaceRootAsync(async repoRoot =>
        {
            var git = new FakeGitCommandService();
            git.SetResponse(["diff", "--name-status", "--no-renames", "--"], "M\tsrc/main.ts\nA\tdocs/new.md\n");
            git.SetResponse(["diff", "--numstat", "--no-renames", "--"], "3\t1\tsrc/main.ts\n12\t0\tdocs/new.md\n");

            var service = new GitDiffService(git);
            var result = await service.ListChangedFilesAsync(new ProjectConfigRecord(
                Id: "workspace-default",
                ProjectName: "CeryxProject",
                ProjectRoot: repoRoot,
                UpdatedAt: DateTimeOffset.UtcNow));

            Assert.True(result.IsSuccess);
            Assert.NotNull(result.Value);
            Assert.Collection(result.Value!,
                first =>
                {
                    Assert.Equal("src/main.ts", first.Path);
                    Assert.Equal("modified", first.Status);
                    Assert.Equal(3, first.Additions);
                    Assert.Equal(1, first.Deletions);
                },
                second =>
                {
                    Assert.Equal("docs/new.md", second.Path);
                    Assert.Equal("added", second.Status);
                    Assert.Equal(12, second.Additions);
                    Assert.Equal(0, second.Deletions);
                });
        });
    }

    [Fact]
    public async Task GetFileDiffAsync_ReturnsTruncatedPayloadForLargeDiff()
    {
        await WithWorkspaceRootAsync(async repoRoot =>
        {
            var git = new FakeGitCommandService();
            git.SetResponse(["diff", "--name-status", "--no-renames", "--"], "M\tsrc/main.ts\n");
            git.SetResponse(["diff", "--numstat", "--no-renames", "--"], "8\t4\tsrc/main.ts\n");
            git.SetResponse(
                ["diff", "--no-color", "--", "src/main.ts"],
                string.Join("\n", Enumerable.Range(1, 8).Select(static index => $"line-{index}")));

            var service = new GitDiffService(git);
            var result = await service.GetFileDiffAsync(
                new ProjectConfigRecord(
                    Id: "workspace-default",
                    ProjectName: "CeryxProject",
                    ProjectRoot: repoRoot,
                    UpdatedAt: DateTimeOffset.UtcNow),
                "src/main.ts",
                lineLimit: 3);

            Assert.True(result.IsSuccess);
            Assert.NotNull(result.Value);
            Assert.True(result.Value!.Truncated);
            Assert.Equal(3, result.Value.LineLimit);
            Assert.Equal(3, result.Value.DiffText.Split(Environment.NewLine).Length);
        });
    }

    [Fact]
    public async Task GetFileDiffAsync_RejectsInvalidPathTraversal()
    {
        await WithWorkspaceRootAsync(async repoRoot =>
        {
            var service = new GitDiffService(new FakeGitCommandService());
            var result = await service.GetFileDiffAsync(
                new ProjectConfigRecord(
                    Id: "workspace-default",
                    ProjectName: "CeryxProject",
                    ProjectRoot: repoRoot,
                    UpdatedAt: DateTimeOffset.UtcNow),
                "../secrets.txt",
                lineLimit: 20);

            Assert.False(result.IsSuccess);
            Assert.NotNull(result.Error);
            Assert.Equal("E_DIFF_PATH_INVALID", result.Error!.Code);
        });
    }

    private static async Task WithWorkspaceRootAsync(Func<string, Task> action)
    {
        var repoRoot = Environment.GetEnvironmentVariable("CERYX_REPO_ROOT")
            ?? Path.GetFullPath(Directory.GetCurrentDirectory());
        var testRoot = Path.Combine(repoRoot, ".workspace-data", "tests", "diff");
        var path = Path.Combine(testRoot, Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(path);

        try
        {
            await action(path);
        }
        finally
        {
            if (Directory.Exists(path))
            {
                Directory.Delete(path, recursive: true);
            }
        }
    }

    private sealed class FakeGitCommandService : IGitCommandService
    {
        private readonly Dictionary<string, string> _responses = new(StringComparer.Ordinal);

        public void SetResponse(IReadOnlyList<string> args, string output)
        {
            _responses[ToKey(args)] = output;
        }

        public Task<Ceryx.Agent.Core.Result<string>> RunAsync(
            string workingDirectory,
            IReadOnlyList<string> arguments,
            CancellationToken cancellationToken = default)
        {
            if (_responses.TryGetValue(ToKey(arguments), out var output))
            {
                return Task.FromResult(Ceryx.Agent.Core.Result<string>.Success(output));
            }

            return Task.FromResult(Ceryx.Agent.Core.Result<string>.Failure(new Ceryx.Agent.Core.AgentError(
                Code: "E_PROJECT_GIT_FAILED",
                Message: $"Unexpected git command: {string.Join(' ', arguments)}",
                TraceId: Guid.NewGuid().ToString("N"))));
        }

        private static string ToKey(IReadOnlyList<string> args)
        {
            return string.Join("||", args);
        }
    }
}
