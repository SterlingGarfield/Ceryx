using Ceryx.Agent.Storage.Sqlite;
using Microsoft.Data.Sqlite;

namespace Ceryx.Agent.Storage.Settings;

public sealed record AgentSettingsRecord(
    string Id,
    int HttpPort,
    string DirectTestCommand,
    bool AllowFullscreenCapture,
    bool AllowClearLogs,
    string DefaultCaptureMode,
    DateTimeOffset UpdatedAt
);

public sealed record AgentSettingsUpdate(
    int? HttpPort = null,
    string? DirectTestCommand = null,
    bool? AllowFullscreenCapture = null,
    bool? AllowClearLogs = null,
    string? DefaultCaptureMode = null
);

public interface IAgentSettingsStore
{
    Task<AgentSettingsRecord> GetOrCreateAsync(CancellationToken cancellationToken = default);

    Task<AgentSettingsRecord> UpdateAsync(
        AgentSettingsUpdate update,
        CancellationToken cancellationToken = default);
}

public sealed class SqliteAgentSettingsStore : IAgentSettingsStore
{
    private const string DefaultId = "default";
    private const int DefaultHttpPort = 41527;
    private const string DefaultDirectTestCommand = "dotnet test agent/windows/Ceryx.Agent.Windows.sln";
    private const string DefaultCaptureMode = "balanced";

    private readonly SqliteConnectionFactory _connectionFactory;

    public SqliteAgentSettingsStore(SqliteConnectionFactory connectionFactory)
    {
        _connectionFactory = connectionFactory ?? throw new ArgumentNullException(nameof(connectionFactory));
    }

    public async Task<AgentSettingsRecord> GetOrCreateAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = await _connectionFactory.OpenConnectionAsync(cancellationToken);
        var existing = await FindByIdAsync(connection, cancellationToken);
        if (existing is not null)
        {
            return existing;
        }

        var created = CreateDefaultRecord();
        await UpsertAsync(connection, created, cancellationToken);
        return created;
    }

    public async Task<AgentSettingsRecord> UpdateAsync(
        AgentSettingsUpdate update,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(update);

        await using var connection = await _connectionFactory.OpenConnectionAsync(cancellationToken);
        var current = await FindByIdAsync(connection, cancellationToken) ?? CreateDefaultRecord();

        var next = new AgentSettingsRecord(
            Id: DefaultId,
            HttpPort: ValidatePort(update.HttpPort ?? current.HttpPort),
            DirectTestCommand: NormalizeDirectTestCommand(update.DirectTestCommand, current.DirectTestCommand),
            AllowFullscreenCapture: update.AllowFullscreenCapture ?? current.AllowFullscreenCapture,
            AllowClearLogs: update.AllowClearLogs ?? current.AllowClearLogs,
            DefaultCaptureMode: NormalizeCaptureMode(update.DefaultCaptureMode, current.DefaultCaptureMode),
            UpdatedAt: DateTimeOffset.UtcNow);

        await UpsertAsync(connection, next, cancellationToken);
        return next;
    }

    private static async Task<AgentSettingsRecord?> FindByIdAsync(
        SqliteConnection connection,
        CancellationToken cancellationToken)
    {
        var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, http_port, direct_test_command, allow_fullscreen_capture, allow_clear_logs, default_capture_mode, updated_at
            FROM agent_settings
            WHERE id = $id
            LIMIT 1;
            """;
        command.Parameters.AddWithValue("$id", DefaultId);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return new AgentSettingsRecord(
            Id: reader.GetString(0),
            HttpPort: reader.GetInt32(1),
            DirectTestCommand: reader.GetString(2),
            AllowFullscreenCapture: reader.GetInt32(3) == 1,
            AllowClearLogs: reader.GetInt32(4) == 1,
            DefaultCaptureMode: reader.GetString(5),
            UpdatedAt: DateTimeOffset.Parse(
                reader.GetString(6),
                null,
                System.Globalization.DateTimeStyles.RoundtripKind));
    }

    private static async Task UpsertAsync(
        SqliteConnection connection,
        AgentSettingsRecord record,
        CancellationToken cancellationToken)
    {
        var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO agent_settings (
                id,
                http_port,
                direct_test_command,
                allow_fullscreen_capture,
                allow_clear_logs,
                default_capture_mode,
                updated_at
            )
            VALUES (
                $id,
                $httpPort,
                $directTestCommand,
                $allowFullscreenCapture,
                $allowClearLogs,
                $defaultCaptureMode,
                $updatedAt
            )
            ON CONFLICT(id) DO UPDATE SET
                http_port = excluded.http_port,
                direct_test_command = excluded.direct_test_command,
                allow_fullscreen_capture = excluded.allow_fullscreen_capture,
                allow_clear_logs = excluded.allow_clear_logs,
                default_capture_mode = excluded.default_capture_mode,
                updated_at = excluded.updated_at;
            """;
        command.Parameters.AddWithValue("$id", record.Id);
        command.Parameters.AddWithValue("$httpPort", record.HttpPort);
        command.Parameters.AddWithValue("$directTestCommand", record.DirectTestCommand);
        command.Parameters.AddWithValue("$allowFullscreenCapture", record.AllowFullscreenCapture ? 1 : 0);
        command.Parameters.AddWithValue("$allowClearLogs", record.AllowClearLogs ? 1 : 0);
        command.Parameters.AddWithValue("$defaultCaptureMode", record.DefaultCaptureMode);
        command.Parameters.AddWithValue("$updatedAt", record.UpdatedAt.ToString("O"));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static AgentSettingsRecord CreateDefaultRecord()
    {
        return new AgentSettingsRecord(
            Id: DefaultId,
            HttpPort: DefaultHttpPort,
            DirectTestCommand: DefaultDirectTestCommand,
            AllowFullscreenCapture: false,
            AllowClearLogs: false,
            DefaultCaptureMode: DefaultCaptureMode,
            UpdatedAt: DateTimeOffset.UtcNow);
    }

    private static int ValidatePort(int value)
    {
        if (value is < 1 or > 65535)
        {
            throw new ArgumentOutOfRangeException(nameof(value), "httpPort must be between 1 and 65535.");
        }

        return value;
    }

    private static string NormalizeDirectTestCommand(string? value, string fallback)
    {
        if (value is null)
        {
            return fallback;
        }

        return string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();
    }

    private static string NormalizeCaptureMode(string? value, string fallback)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return fallback;
        }

        return value.Trim();
    }
}
