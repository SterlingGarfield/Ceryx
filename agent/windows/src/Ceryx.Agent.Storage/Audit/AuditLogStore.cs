using Ceryx.Agent.Storage.Sqlite;

namespace Ceryx.Agent.Storage.Audit;

public sealed record AuditLogEntry(
    string Id,
    string Action,
    string Details,
    DateTimeOffset CreatedAt
);

public interface IAuditLogStore
{
    Task WriteAsync(string action, string details, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<AuditLogEntry>> ListAsync(int take = 100, CancellationToken cancellationToken = default);
}

public sealed class SqliteAuditLogStore : IAuditLogStore
{
    private readonly SqliteConnectionFactory _connectionFactory;

    public SqliteAuditLogStore(SqliteConnectionFactory connectionFactory)
    {
        _connectionFactory = connectionFactory ?? throw new ArgumentNullException(nameof(connectionFactory));
    }

    public async Task WriteAsync(string action, string details, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(action);
        details ??= string.Empty;

        await using var connection = await _connectionFactory.OpenConnectionAsync(cancellationToken);
        var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO audit_logs (id, action, details, created_at)
            VALUES ($id, $action, $details, $createdAt);
            """;
        command.Parameters.AddWithValue("$id", "audit_" + Guid.NewGuid().ToString("N"));
        command.Parameters.AddWithValue("$action", action);
        command.Parameters.AddWithValue("$details", details);
        command.Parameters.AddWithValue("$createdAt", DateTimeOffset.UtcNow.ToString("O"));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<AuditLogEntry>> ListAsync(int take = 100, CancellationToken cancellationToken = default)
    {
        if (take <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(take));
        }

        await using var connection = await _connectionFactory.OpenConnectionAsync(cancellationToken);
        var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, action, details, created_at
            FROM audit_logs
            ORDER BY created_at DESC
            LIMIT $take;
            """;
        command.Parameters.AddWithValue("$take", take);

        var result = new List<AuditLogEntry>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(new AuditLogEntry(
                Id: reader.GetString(0),
                Action: reader.GetString(1),
                Details: reader.GetString(2),
                CreatedAt: DateTimeOffset.Parse(reader.GetString(3), null, System.Globalization.DateTimeStyles.RoundtripKind)));
        }

        return result;
    }
}
