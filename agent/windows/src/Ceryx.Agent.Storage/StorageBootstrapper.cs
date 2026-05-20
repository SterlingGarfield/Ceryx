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
              platform TEXT NOT NULL,
              client_type TEXT NOT NULL,
              token_hash TEXT NOT NULL,
              permissions_json TEXT NOT NULL,
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
        await EnsurePairedDeviceColumnsAsync(connection, cancellationToken);
    }

    private static async Task EnsurePairedDeviceColumnsAsync(
        SqliteConnection connection,
        CancellationToken cancellationToken)
    {
        var existingColumns = await ReadTableColumnsAsync(connection, "paired_devices", cancellationToken);

        await AddColumnIfMissingAsync(
            connection,
            existingColumns,
            "platform",
            "TEXT NOT NULL DEFAULT 'unknown'",
            cancellationToken);
        await AddColumnIfMissingAsync(
            connection,
            existingColumns,
            "client_type",
            "TEXT NOT NULL DEFAULT 'ipad'",
            cancellationToken);
        await AddColumnIfMissingAsync(
            connection,
            existingColumns,
            "token_hash",
            "TEXT NOT NULL DEFAULT ''",
            cancellationToken);
        await AddColumnIfMissingAsync(
            connection,
            existingColumns,
            "permissions_json",
            "TEXT NOT NULL DEFAULT '[]'",
            cancellationToken);
    }

    private static async Task<HashSet<string>> ReadTableColumnsAsync(
        SqliteConnection connection,
        string tableName,
        CancellationToken cancellationToken)
    {
        var command = connection.CreateCommand();
        command.CommandText = $"PRAGMA table_info({tableName});";
        var columns = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            columns.Add(reader.GetString(1));
        }

        return columns;
    }

    private static async Task AddColumnIfMissingAsync(
        SqliteConnection connection,
        ISet<string> existingColumns,
        string columnName,
        string columnDefinition,
        CancellationToken cancellationToken)
    {
        if (existingColumns.Contains(columnName))
        {
            return;
        }

        var command = connection.CreateCommand();
        command.CommandText = $"ALTER TABLE paired_devices ADD COLUMN {columnName} {columnDefinition};";
        try
        {
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
        catch (SqliteException ex) when (
            ex.SqliteErrorCode == 1 &&
            ex.Message.Contains("duplicate column name", StringComparison.OrdinalIgnoreCase))
        {
            // Another process finished the same migration step first.
        }

        existingColumns.Add(columnName);
    }
}
