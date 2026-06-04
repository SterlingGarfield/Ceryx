using System.Runtime.CompilerServices;
using System.Reflection;

namespace Ceryx.Agent.Tests;

internal static class TestEnvironmentBootstrap
{
    private const string AgentRootOverrideEnvVar = "CERYX_AGENT_ROOT_OVERRIDE";

    [ModuleInitializer]
    internal static void Initialize()
    {
        var repoRoot = ResolveRepositoryRoot();
        var testRunId = $"{DateTime.UtcNow:yyyyMMddHHmmssfff}-{Guid.NewGuid():N}";
        var agentRoot = Path.Combine(Path.GetTempPath(), "ceryx-tests", "agent", testRunId);

        Directory.CreateDirectory(agentRoot);
        Environment.SetEnvironmentVariable("CERYX_REPO_ROOT", repoRoot);
        Environment.SetEnvironmentVariable(AgentRootOverrideEnvVar, agentRoot);
    }

    private static string ResolveRepositoryRoot()
    {
        var configuredRoot = Environment.GetEnvironmentVariable("CERYX_REPO_ROOT");
        if (!string.IsNullOrWhiteSpace(configuredRoot) && IsRepositoryRoot(configuredRoot))
        {
            return Path.GetFullPath(configuredRoot);
        }

        var metadataRoot = GetAssemblyMetadataRepositoryRoot();
        if (!string.IsNullOrWhiteSpace(metadataRoot) && IsRepositoryRoot(metadataRoot))
        {
            return Path.GetFullPath(metadataRoot);
        }

        var repositoryRoot = FindRepositoryRoot(Directory.GetCurrentDirectory())
            ?? FindRepositoryRoot(AppContext.BaseDirectory);

        if (repositoryRoot is not null)
        {
            return repositoryRoot;
        }

        throw new InvalidOperationException("Unable to resolve repository root for test environment bootstrap.");
    }

    private static string? GetAssemblyMetadataRepositoryRoot()
    {
        foreach (var attribute in typeof(TestEnvironmentBootstrap).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>())
        {
            if (string.Equals(attribute.Key, "CeryxRepoRoot", StringComparison.Ordinal) &&
                !string.IsNullOrWhiteSpace(attribute.Value))
            {
                return attribute.Value;
            }
        }

        return null;
    }

    private static string? FindRepositoryRoot(string startDirectory)
    {
        var current = new DirectoryInfo(startDirectory);
        while (current is not null)
        {
            if (IsRepositoryRoot(current.FullName))
            {
                return current.FullName;
            }

            current = current.Parent;
        }

        return null;
    }

    private static bool IsRepositoryRoot(string path)
    {
        var packageJson = Path.Combine(path, "package.json");
        var workspaceFile = Path.Combine(path, "pnpm-workspace.yaml");
        return File.Exists(packageJson) && File.Exists(workspaceFile);
    }
}
