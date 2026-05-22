using Ceryx.Agent.Storage.Sqlite;

namespace Ceryx.Agent.Project;

public sealed record ProjectConfigRecord(
    string Id,
    string ProjectName,
    string ProjectRoot,
    DateTimeOffset UpdatedAt
);

public interface IProjectConfigRepository
{
    Task<ProjectConfigRecord> GetOrCreateDefaultAsync(CancellationToken cancellationToken = default);

    Task<ProjectConfigRecord?> FindByIdAsync(string projectId, CancellationToken cancellationToken = default);
}

public sealed class SqliteProjectConfigRepository : IProjectConfigRepository
{
    public const string DefaultProjectId = "workspace-default";

    private readonly SqliteConnectionFactory _connectionFactory;

    public SqliteProjectConfigRepository(SqliteConnectionFactory connectionFactory)
    {
        _connectionFactory = connectionFactory ?? throw new ArgumentNullException(nameof(connectionFactory));
    }

    public async Task<ProjectConfigRecord> GetOrCreateDefaultAsync(CancellationToken cancellationToken = default)
    {
        var existing = await FindByIdAsync(DefaultProjectId, cancellationToken);
        if (existing is not null)
        {
            return existing;
        }

        var defaultRoot = ResolveDefaultProjectRoot();
        var defaultRecord = new ProjectConfigRecord(
            Id: DefaultProjectId,
            ProjectName: ResolveProjectName(defaultRoot),
            ProjectRoot: defaultRoot,
            UpdatedAt: DateTimeOffset.UtcNow);

        await using var connection = await _connectionFactory.OpenConnectionAsync(cancellationToken);
        var command = connection.CreateCommand();
        command.CommandText = """
            INSERT OR REPLACE INTO project_configs (
                id,
                project_name,
                project_root,
                updated_at
            )
            VALUES (
                $id,
                $projectName,
                $projectRoot,
                $updatedAt
            );
            """;
        command.Parameters.AddWithValue("$id", defaultRecord.Id);
        command.Parameters.AddWithValue("$projectName", defaultRecord.ProjectName);
        command.Parameters.AddWithValue("$projectRoot", defaultRecord.ProjectRoot);
        command.Parameters.AddWithValue("$updatedAt", defaultRecord.UpdatedAt.ToString("O"));
        await command.ExecuteNonQueryAsync(cancellationToken);

        return defaultRecord;
    }

    public async Task<ProjectConfigRecord?> FindByIdAsync(string projectId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(projectId);

        await using var connection = await _connectionFactory.OpenConnectionAsync(cancellationToken);
        var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, project_name, project_root, updated_at
            FROM project_configs
            WHERE id = $id
            LIMIT 1;
            """;
        command.Parameters.AddWithValue("$id", projectId.Trim());

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return new ProjectConfigRecord(
            Id: reader.GetString(0),
            ProjectName: reader.GetString(1),
            ProjectRoot: reader.GetString(2),
            UpdatedAt: DateTimeOffset.Parse(reader.GetString(3), null, System.Globalization.DateTimeStyles.RoundtripKind));
    }

    private static string ResolveDefaultProjectRoot()
    {
        var configuredRoot = Environment.GetEnvironmentVariable("CERYX_REPO_ROOT");
        if (!string.IsNullOrWhiteSpace(configuredRoot))
        {
            return Path.GetFullPath(configuredRoot);
        }

        return Path.GetFullPath(Directory.GetCurrentDirectory());
    }

    private static string ResolveProjectName(string rootPath)
    {
        var directoryName = Path.GetFileName(rootPath.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
        return string.IsNullOrWhiteSpace(directoryName) ? "workspace" : directoryName;
    }
}
