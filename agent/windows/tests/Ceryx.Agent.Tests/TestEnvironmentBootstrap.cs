using System.Runtime.CompilerServices;

namespace Ceryx.Agent.Tests;

internal static class TestEnvironmentBootstrap
{
    [ModuleInitializer]
    internal static void Initialize()
    {
        var repoRoot = ResolveRepositoryRoot();
        var testRunId = $"{DateTime.UtcNow:yyyyMMddHHmmssfff}-{Guid.NewGuid():N}";
        var agentRoot = Path.Combine(repoRoot, ".workspace-data", "tests", "agent", testRunId);

        Directory.CreateDirectory(agentRoot);
        Environment.SetEnvironmentVariable("CERYX_REPO_ROOT", repoRoot);
        Environment.SetEnvironmentVariable("CERYX_AGENT_ROOT", agentRoot);
    }

    private static string ResolveRepositoryRoot()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            var packageJson = Path.Combine(current.FullName, "package.json");
            var workspaceFile = Path.Combine(current.FullName, "pnpm-workspace.yaml");
            if (File.Exists(packageJson) && File.Exists(workspaceFile))
            {
                return current.FullName;
            }

            current = current.Parent;
        }

        throw new InvalidOperationException("Unable to resolve repository root for test environment bootstrap.");
    }
}
