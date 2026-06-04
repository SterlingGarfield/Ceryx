using Microsoft.Data.Sqlite;
using Ceryx.Agent.Storage.Sqlite;

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
        await SqliteConnectionFactory.ConfigureConnectionAsync(connection, cancellationToken);

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
              wol_json TEXT NOT NULL DEFAULT '',
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
              details TEXT NOT NULL DEFAULT '',
              severity TEXT NOT NULL DEFAULT 'info',
              session_id TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS project_configs (
              id TEXT PRIMARY KEY,
              project_name TEXT NOT NULL,
              project_root TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS media_assets (
              id TEXT PRIMARY KEY,
              asset_type TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS agent_settings (
              id TEXT PRIMARY KEY,
              http_port INTEGER NOT NULL DEFAULT 41527,
              direct_test_command TEXT NOT NULL DEFAULT 'dotnet test agent/windows/Ceryx.Agent.Windows.sln',
              allow_fullscreen_capture INTEGER NOT NULL DEFAULT 0,
              allow_clear_logs INTEGER NOT NULL DEFAULT 0,
              default_capture_mode TEXT NOT NULL DEFAULT 'balanced',
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS notification_reads (
              notification_id TEXT PRIMARY KEY,
              read_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS notification_state (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              cleared_before TEXT
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
        await AddColumnIfMissingAsync(
            connection,
            existingColumns,
            "wol_json",
            "TEXT NOT NULL DEFAULT ''",
            cancellationToken);

        var auditColumns = await ReadTableColumnsAsync(connection, "audit_logs", cancellationToken);
        await AddColumnIfMissingAsync(
            connection,
            auditColumns,
            "details",
            "TEXT NOT NULL DEFAULT ''",
            cancellationToken,
            tableName: "audit_logs");
        await AddColumnIfMissingAsync(
            connection,
            auditColumns,
            "severity",
            "TEXT NOT NULL DEFAULT 'info'",
            cancellationToken,
            tableName: "audit_logs");
        await AddColumnIfMissingAsync(
            connection,
            auditColumns,
            "session_id",
            "TEXT NOT NULL DEFAULT ''",
            cancellationToken,
            tableName: "audit_logs");
        await EnsureAuditLogIndexesAsync(connection, cancellationToken);

        var projectConfigColumns = await ReadTableColumnsAsync(connection, "project_configs", cancellationToken);
        await AddColumnIfMissingAsync(
            connection,
            projectConfigColumns,
            "project_root",
            "TEXT NOT NULL DEFAULT ''",
            cancellationToken,
            tableName: "project_configs");

        var agentSettingsColumns = await ReadTableColumnsAsync(connection, "agent_settings", cancellationToken);
        await AddColumnIfMissingAsync(
            connection,
            agentSettingsColumns,
            "http_port",
            "INTEGER NOT NULL DEFAULT 41527",
            cancellationToken,
            tableName: "agent_settings");
        await AddColumnIfMissingAsync(
            connection,
            agentSettingsColumns,
            "direct_test_command",
            "TEXT NOT NULL DEFAULT 'dotnet test agent/windows/Ceryx.Agent.Windows.sln'",
            cancellationToken,
            tableName: "agent_settings");
        await AddColumnIfMissingAsync(
            connection,
            agentSettingsColumns,
            "allow_fullscreen_capture",
            "INTEGER NOT NULL DEFAULT 0",
            cancellationToken,
            tableName: "agent_settings");
        await AddColumnIfMissingAsync(
            connection,
            agentSettingsColumns,
            "allow_clear_logs",
            "INTEGER NOT NULL DEFAULT 0",
            cancellationToken,
            tableName: "agent_settings");
        await AddColumnIfMissingAsync(
            connection,
            agentSettingsColumns,
            "default_capture_mode",
            "TEXT NOT NULL DEFAULT 'balanced'",
            cancellationToken,
            tableName: "agent_settings");
        await AddColumnIfMissingAsync(
            connection,
            agentSettingsColumns,
            "updated_at",
            "TEXT NOT NULL DEFAULT ''",
            cancellationToken,
            tableName: "agent_settings");
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
        CancellationToken cancellationToken,
        string tableName = "paired_devices")
    {
        if (existingColumns.Contains(columnName))
        {
            return;
        }

        var command = connection.CreateCommand();
        command.CommandText = $"ALTER TABLE {tableName} ADD COLUMN {columnName} {columnDefinition};";
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

    private static async Task EnsureAuditLogIndexesAsync(
        SqliteConnection connection,
        CancellationToken cancellationToken)
    {
        var createdAtIndex = connection.CreateCommand();
        createdAtIndex.CommandText = """
            CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
            ON audit_logs(created_at DESC);
            """;
        await createdAtIndex.ExecuteNonQueryAsync(cancellationToken);

        var filterIndex = connection.CreateCommand();
        filterIndex.CommandText = """
            CREATE INDEX IF NOT EXISTS idx_audit_logs_filters
            ON audit_logs(severity, action, session_id, created_at DESC);
            """;
        await filterIndex.ExecuteNonQueryAsync(cancellationToken);
    }
}
