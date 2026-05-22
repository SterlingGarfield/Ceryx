using Ceryx.Agent.Storage.Sqlite;

namespace Ceryx.Agent.Storage.Notifications;

public interface INotificationStateStore
{
    Task<DateTimeOffset?> GetClearedBeforeAsync(CancellationToken cancellationToken = default);

    Task<IReadOnlySet<string>> GetReadIdsAsync(
        IReadOnlyList<string> notificationIds,
        CancellationToken cancellationToken = default);

    Task MarkReadAsync(string notificationId, CancellationToken cancellationToken = default);

    Task ClearAllAsync(DateTimeOffset clearedBefore, CancellationToken cancellationToken = default);
}

public sealed class SqliteNotificationStateStore : INotificationStateStore
{
    private readonly SqliteConnectionFactory _connectionFactory;

    public SqliteNotificationStateStore(SqliteConnectionFactory connectionFactory)
    {
        _connectionFactory = connectionFactory ?? throw new ArgumentNullException(nameof(connectionFactory));
    }

    public async Task<DateTimeOffset?> GetClearedBeforeAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = await _connectionFactory.OpenConnectionAsync(cancellationToken);
        var command = connection.CreateCommand();
        command.CommandText = """
            SELECT cleared_before
            FROM notification_state
            WHERE id = 1
            LIMIT 1;
            """;

        var value = await command.ExecuteScalarAsync(cancellationToken);
        if (value is null || value == DBNull.Value)
        {
            return null;
        }

        var text = Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture);
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        return DateTimeOffset.Parse(text, null, System.Globalization.DateTimeStyles.RoundtripKind);
    }

    public async Task<IReadOnlySet<string>> GetReadIdsAsync(
        IReadOnlyList<string> notificationIds,
        CancellationToken cancellationToken = default)
    {
        if (notificationIds.Count == 0)
        {
            return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        }

        await using var connection = await _connectionFactory.OpenConnectionAsync(cancellationToken);
        var command = connection.CreateCommand();
        var placeholders = new List<string>(notificationIds.Count);
        for (var index = 0; index < notificationIds.Count; index += 1)
        {
            var parameter = $"$id{index}";
            placeholders.Add(parameter);
            command.Parameters.AddWithValue(parameter, notificationIds[index]);
        }

        command.CommandText = $"""
            SELECT notification_id
            FROM notification_reads
            WHERE notification_id IN ({string.Join(", ", placeholders)});
            """;

        var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(reader.GetString(0));
        }

        return result;
    }

    public async Task MarkReadAsync(string notificationId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(notificationId);

        await using var connection = await _connectionFactory.OpenConnectionAsync(cancellationToken);
        var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO notification_reads (notification_id, read_at)
            VALUES ($notificationId, $readAt)
            ON CONFLICT(notification_id) DO UPDATE
            SET read_at = excluded.read_at;
            """;
        command.Parameters.AddWithValue("$notificationId", notificationId.Trim());
        command.Parameters.AddWithValue("$readAt", DateTimeOffset.UtcNow.ToString("O"));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task ClearAllAsync(DateTimeOffset clearedBefore, CancellationToken cancellationToken = default)
    {
        await using var connection = await _connectionFactory.OpenConnectionAsync(cancellationToken);
        var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO notification_state (id, cleared_before)
            VALUES (1, $clearedBefore)
            ON CONFLICT(id) DO UPDATE
            SET cleared_before = excluded.cleared_before;
            """;
        command.Parameters.AddWithValue("$clearedBefore", clearedBefore.ToString("O"));
        await command.ExecuteNonQueryAsync(cancellationToken);

        var cleanup = connection.CreateCommand();
        cleanup.CommandText = """
            DELETE FROM notification_reads
            WHERE read_at <= $clearedBefore;
            """;
        cleanup.Parameters.AddWithValue("$clearedBefore", clearedBefore.ToString("O"));
        await cleanup.ExecuteNonQueryAsync(cancellationToken);
    }
}
