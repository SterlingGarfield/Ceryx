using Microsoft.Data.Sqlite;

namespace Ceryx.Agent.Storage;

public interface IMigrationRunner
{
    Task RunAsync(SqliteConnection connection, CancellationToken cancellationToken = default);
}

public sealed class NoOpMigrationRunner : IMigrationRunner
{
    public Task RunAsync(SqliteConnection connection, CancellationToken cancellationToken = default)
    {
        return Task.CompletedTask;
    }
}

public sealed class StorageBootstrapper
{
    private readonly IMigrationRunner _migrationRunner;

    public StorageBootstrapper(LocalPaths paths, IMigrationRunner? migrationRunner = null)
    {
        Paths = paths ?? throw new ArgumentNullException(nameof(paths));
        _migrationRunner = migrationRunner ?? new NoOpMigrationRunner();
    }

    public LocalPaths Paths { get; }

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        Paths.EnsureDirectories();

        var connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = Paths.Database,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Pooling = false
        }.ToString();

        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync(cancellationToken);

        await EnsureSchemaAsync(connection, cancellationToken);
        await _migrationRunner.RunAsync(connection, cancellationToken);
    }

    private static async Task EnsureSchemaAsync(
        SqliteConnection connection,
        CancellationToken cancellationToken)
    {
        var command = connection.CreateCommand();
        command.CommandText = """
            CREATE TABLE IF NOT EXISTS paired_devices (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS remote_sessions (
              id TEXT PRIMARY KEY,
              controller_device_id TEXT,
              started_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS audit_logs (
              id TEXT PRIMARY KEY,
              action TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS project_configs (
              id TEXT PRIMARY KEY,
              project_name TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS media_assets (
              id TEXT PRIMARY KEY,
              asset_type TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            """;

        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
