using Ceryx.Agent.Storage;
using Xunit;

namespace Ceryx.Agent.Tests;

public sealed class LocalPathsTests
{
    [Fact]
    public void EnsureDirectories_CreatesExpectedFolders()
    {
        var tempRoot = CreateWorkspaceTestPath("ceryx-localpaths");

        try
        {
            var paths = new LocalPaths(tempRoot);
            paths.EnsureDirectories();

            Assert.True(Directory.Exists(paths.Root));
            Assert.True(Directory.Exists(paths.Logs));
            Assert.True(Directory.Exists(paths.Uploads));
            Assert.True(Directory.Exists(paths.Screenshots));
            Assert.True(Directory.Exists(paths.Recordings));
            Assert.Equal(Path.Combine(paths.Root, "ceryx.db"), paths.Database);
        }
        finally
        {
            TryDeleteDirectory(tempRoot);
        }
    }

    [Fact]
    public void CreateDefault_UsesConfiguredAgentRootWithinRepo()
    {
        var repoRoot = CreateWorkspaceTestPath("ceryx-repo");
        var configuredRoot = Path.Combine(repoRoot, ".workspace-data", "agent");

        Directory.CreateDirectory(repoRoot);
        File.WriteAllText(Path.Combine(repoRoot, "package.json"), "{}");
        File.WriteAllText(Path.Combine(repoRoot, "pnpm-workspace.yaml"), "packages: []");

        var oldRepo = Environment.GetEnvironmentVariable("CERYX_REPO_ROOT");
        var oldAgent = Environment.GetEnvironmentVariable("CERYX_AGENT_ROOT");

        try
        {
            Environment.SetEnvironmentVariable("CERYX_REPO_ROOT", repoRoot);
            Environment.SetEnvironmentVariable("CERYX_AGENT_ROOT", configuredRoot);

            var paths = LocalPaths.CreateDefault();

            Assert.Equal(Path.GetFullPath(configuredRoot), paths.Root);
        }
        finally
        {
            Environment.SetEnvironmentVariable("CERYX_REPO_ROOT", oldRepo);
            Environment.SetEnvironmentVariable("CERYX_AGENT_ROOT", oldAgent);

            TryDeleteDirectory(repoRoot);
        }
    }

    [Fact]
    public void CreateDefault_RejectsRootOutsideRepository()
    {
        var repoRoot = CreateWorkspaceTestPath("ceryx-repo");
        Directory.CreateDirectory(repoRoot);
        File.WriteAllText(Path.Combine(repoRoot, "package.json"), "{}");
        File.WriteAllText(Path.Combine(repoRoot, "pnpm-workspace.yaml"), "packages: []");

        var outsideRoot = CreateWorkspaceTestPath("ceryx-outside");

        var oldRepo = Environment.GetEnvironmentVariable("CERYX_REPO_ROOT");
        var oldAgent = Environment.GetEnvironmentVariable("CERYX_AGENT_ROOT");

        try
        {
            Environment.SetEnvironmentVariable("CERYX_REPO_ROOT", repoRoot);
            Environment.SetEnvironmentVariable("CERYX_AGENT_ROOT", outsideRoot);

            var exception = Assert.Throws<InvalidOperationException>(() => LocalPaths.CreateDefault());
            Assert.Contains("outside repository root", exception.Message, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            Environment.SetEnvironmentVariable("CERYX_REPO_ROOT", oldRepo);
            Environment.SetEnvironmentVariable("CERYX_AGENT_ROOT", oldAgent);

            TryDeleteDirectory(repoRoot);
            TryDeleteDirectory(outsideRoot);
        }
    }

    [Fact]
    public void CreateDefault_RejectsCRootOnWindows()
    {
        if (!OperatingSystem.IsWindows())
        {
            return;
        }

        var repoRoot = CreateWorkspaceTestPath("ceryx-repo");
        Directory.CreateDirectory(repoRoot);
        File.WriteAllText(Path.Combine(repoRoot, "package.json"), "{}");
        File.WriteAllText(Path.Combine(repoRoot, "pnpm-workspace.yaml"), "packages: []");

        var oldRepo = Environment.GetEnvironmentVariable("CERYX_REPO_ROOT");
        var oldAgent = Environment.GetEnvironmentVariable("CERYX_AGENT_ROOT");

        try
        {
            Environment.SetEnvironmentVariable("CERYX_REPO_ROOT", repoRoot);
            Environment.SetEnvironmentVariable("CERYX_AGENT_ROOT", @"C:\Ceryx\agent");

            var exception = Assert.Throws<InvalidOperationException>(() => LocalPaths.CreateDefault());
            Assert.Contains("C drive", exception.Message, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            Environment.SetEnvironmentVariable("CERYX_REPO_ROOT", oldRepo);
            Environment.SetEnvironmentVariable("CERYX_AGENT_ROOT", oldAgent);

            TryDeleteDirectory(repoRoot);
        }
    }

    private static string CreateWorkspaceTestPath(string prefix)
    {
        var repositoryRoot = Environment.GetEnvironmentVariable("CERYX_REPO_ROOT");
        var testRoot = !string.IsNullOrWhiteSpace(repositoryRoot)
            ? Path.Combine(Path.GetFullPath(repositoryRoot), ".workspace-data", "tests", "localpaths")
            : Path.Combine(Path.GetFullPath(AppContext.BaseDirectory), ".workspace-data", "tests", "localpaths");

        return Path.Combine(testRoot, $"{prefix}-{Guid.NewGuid():N}");
    }

    private static void TryDeleteDirectory(string path)
    {
        if (!Directory.Exists(path))
        {
            return;
        }

        try
        {
            Directory.Delete(path, recursive: true);
        }
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }
    }
}
