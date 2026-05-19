namespace Ceryx.Agent.Storage;

public sealed class LocalPaths
{
    private const string AgentRootEnvVar = "CERYX_AGENT_ROOT";
    private const string RepoRootEnvVar = "CERYX_REPO_ROOT";

    public LocalPaths(string root)
    {
        if (string.IsNullOrWhiteSpace(root))
        {
            throw new ArgumentException("Root path is required.", nameof(root));
        }

        Root = Path.GetFullPath(root);
        Logs = Path.Combine(Root, "Logs");
        Uploads = Path.Combine(Root, "Uploads");
        Screenshots = Path.Combine(Root, "Screenshots");
        Recordings = Path.Combine(Root, "Recordings");
        Database = Path.Combine(Root, "ceryx.db");
    }

    public string Root { get; }

    public string Logs { get; }

    public string Uploads { get; }

    public string Screenshots { get; }

    public string Recordings { get; }

    public string Database { get; }

    public static LocalPaths CreateDefault()
    {
        var repoRoot = ResolveRepositoryRoot();
        var configuredRoot = Environment.GetEnvironmentVariable(AgentRootEnvVar);
        var root = string.IsNullOrWhiteSpace(configuredRoot)
            ? Path.Combine(repoRoot, ".workspace-data", "agent")
            : configuredRoot;

        var fullRoot = Path.GetFullPath(root);
        ValidateBoundary(fullRoot, repoRoot);
        return new LocalPaths(fullRoot);
    }

    public void EnsureDirectories()
    {
        Directory.CreateDirectory(Root);
        Directory.CreateDirectory(Logs);
        Directory.CreateDirectory(Uploads);
        Directory.CreateDirectory(Screenshots);
        Directory.CreateDirectory(Recordings);
    }

    private static string ResolveRepositoryRoot()
    {
        var fromEnv = Environment.GetEnvironmentVariable(RepoRootEnvVar);
        if (!string.IsNullOrWhiteSpace(fromEnv))
        {
            return Path.GetFullPath(fromEnv);
        }

        var candidates = new[]
        {
            Directory.GetCurrentDirectory(),
            AppContext.BaseDirectory
        };

        foreach (var candidate in candidates)
        {
            var found = TryFindRepositoryRoot(candidate);
            if (!string.IsNullOrWhiteSpace(found))
            {
                return found;
            }
        }

        throw new InvalidOperationException(
            "Unable to resolve repository root for disk boundary. Set CERYX_REPO_ROOT explicitly.");
    }

    private static string? TryFindRepositoryRoot(string startPath)
    {
        if (string.IsNullOrWhiteSpace(startPath))
        {
            return null;
        }

        var directory = new DirectoryInfo(Path.GetFullPath(startPath));
        while (directory is not null)
        {
            var packageJson = Path.Combine(directory.FullName, "package.json");
            var workspaceYaml = Path.Combine(directory.FullName, "pnpm-workspace.yaml");
            if (File.Exists(packageJson) && File.Exists(workspaceYaml))
            {
                return directory.FullName;
            }

            directory = directory.Parent;
        }

        return null;
    }

    private static void ValidateBoundary(string root, string repoRoot)
    {
        if (root.StartsWith("C:\\", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                $"Agent root '{root}' is on C drive, which violates disk boundary policy.");
        }

        var normalizedRoot = root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            + Path.DirectorySeparatorChar;
        var normalizedRepoRoot = Path.GetFullPath(repoRoot)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            + Path.DirectorySeparatorChar;

        if (!normalizedRoot.StartsWith(normalizedRepoRoot, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                $"Agent root '{root}' is outside repository root '{repoRoot}'.");
        }
    }
}
