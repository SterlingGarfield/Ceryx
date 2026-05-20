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
            if (Directory.Exists(tempRoot))
            {
                Directory.Delete(tempRoot, recursive: true);
            }
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

            if (Directory.Exists(repoRoot))
            {
                Directory.Delete(repoRoot, recursive: true);
            }
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

            if (Directory.Exists(repoRoot))
            {
                Directory.Delete(repoRoot, recursive: true);
            }

            if (Directory.Exists(outsideRoot))
            {
                Directory.Delete(outsideRoot, recursive: true);
            }
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

            if (Directory.Exists(repoRoot))
            {
                Directory.Delete(repoRoot, recursive: true);
            }
        }
    }

    private static string CreateWorkspaceTestPath(string prefix)
    {
        var testRoot = Path.Combine(Directory.GetCurrentDirectory(), ".workspace-data", "test-temp");
        return Path.Combine(testRoot, $"{prefix}-{Guid.NewGuid():N}");
    }
}
