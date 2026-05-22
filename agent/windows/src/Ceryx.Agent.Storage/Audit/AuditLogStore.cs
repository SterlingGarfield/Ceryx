using Ceryx.Agent.Storage.Sqlite;

namespace Ceryx.Agent.Storage.Audit;

public sealed record AuditLogEntry(
    string Id,
    string Action,
    string Details,
    string Severity,
    string SessionId,
    DateTimeOffset CreatedAt
);

public sealed record AuditLogQuery(
    int Page = 1,
    int PageSize = 100,
    string? Severity = null,
    string? Action = null,
    string? SessionId = null
);

public sealed record AuditLogPageResult(
    int Page,
    int PageSize,
    int Total,
    bool HasMore,
    IReadOnlyList<AuditLogEntry> Items
);

public interface IAuditLogStore
{
    Task WriteAsync(string action, string details, CancellationToken cancellationToken = default);

    Task WriteAsync(
        string action,
        string details,
        string severity,
        string? sessionId,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<AuditLogEntry>> ListAsync(int take = 100, CancellationToken cancellationToken = default);

    Task<AuditLogPageResult> QueryAsync(
        AuditLogQuery query,
        CancellationToken cancellationToken = default);
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
        await WriteAsync(action, details, severity: "info", sessionId: null, cancellationToken);
    }

    public async Task WriteAsync(
        string action,
        string details,
        string severity,
        string? sessionId,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(action);
        details ??= string.Empty;
        severity = NormalizeSeverity(severity);
        sessionId = (sessionId ?? string.Empty).Trim();

        await using var connection = await _connectionFactory.OpenConnectionAsync(cancellationToken);
        var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO audit_logs (id, action, details, severity, session_id, created_at)
            VALUES ($id, $action, $details, $severity, $sessionId, $createdAt);
            """;
        command.Parameters.AddWithValue("$id", "audit_" + Guid.NewGuid().ToString("N"));
        command.Parameters.AddWithValue("$action", action);
        command.Parameters.AddWithValue("$details", details);
        command.Parameters.AddWithValue("$severity", severity);
        command.Parameters.AddWithValue("$sessionId", sessionId);
        command.Parameters.AddWithValue("$createdAt", DateTimeOffset.UtcNow.ToString("O"));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<AuditLogEntry>> ListAsync(int take = 100, CancellationToken cancellationToken = default)
    {
        if (take <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(take));
        }

        var result = await QueryAsync(
            new AuditLogQuery(Page: 1, PageSize: take),
            cancellationToken);

        return result.Items;
    }

    public async Task<AuditLogPageResult> QueryAsync(
        AuditLogQuery query,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);

        if (query.Page <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(query.Page));
        }

        if (query.PageSize <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(query.PageSize));
        }

        var severity = NormalizeFilter(query.Severity);
        var action = NormalizeFilter(query.Action);
        var sessionId = NormalizeFilter(query.SessionId);

        await using var connection = await _connectionFactory.OpenConnectionAsync(cancellationToken);

        var whereClauses = new List<string>();
        if (!string.IsNullOrEmpty(severity))
        {
            whereClauses.Add("severity = $severity");
        }

        if (!string.IsNullOrEmpty(action))
        {
            whereClauses.Add("action = $action");
        }

        if (!string.IsNullOrEmpty(sessionId))
        {
            whereClauses.Add("session_id = $sessionId");
        }

        var whereSql = whereClauses.Count == 0
            ? string.Empty
            : $"WHERE {string.Join(" AND ", whereClauses)}";

        var countCommand = connection.CreateCommand();
        countCommand.CommandText = $"""
            SELECT COUNT(1)
            FROM audit_logs
            {whereSql};
            """;
        if (!string.IsNullOrEmpty(severity))
        {
            countCommand.Parameters.AddWithValue("$severity", severity);
        }

        if (!string.IsNullOrEmpty(action))
        {
            countCommand.Parameters.AddWithValue("$action", action);
        }

        if (!string.IsNullOrEmpty(sessionId))
        {
            countCommand.Parameters.AddWithValue("$sessionId", sessionId);
        }

        var total = Convert.ToInt32(await countCommand.ExecuteScalarAsync(cancellationToken), System.Globalization.CultureInfo.InvariantCulture);

        var offset = (query.Page - 1) * query.PageSize;
        var command = connection.CreateCommand();
        command.CommandText = $"""
            SELECT id, action, details, severity, session_id, created_at
            FROM audit_logs
            {whereSql}
            ORDER BY created_at DESC
            LIMIT $take
            OFFSET $offset;
            """;
        command.Parameters.AddWithValue("$take", query.PageSize);
        command.Parameters.AddWithValue("$offset", offset);
        if (!string.IsNullOrEmpty(severity))
        {
            command.Parameters.AddWithValue("$severity", severity);
        }

        if (!string.IsNullOrEmpty(action))
        {
            command.Parameters.AddWithValue("$action", action);
        }

        if (!string.IsNullOrEmpty(sessionId))
        {
            command.Parameters.AddWithValue("$sessionId", sessionId);
        }

        var result = new List<AuditLogEntry>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(new AuditLogEntry(
                Id: reader.GetString(0),
                Action: reader.GetString(1),
                Details: reader.GetString(2),
                Severity: reader.GetString(3),
                SessionId: reader.GetString(4),
                CreatedAt: DateTimeOffset.Parse(reader.GetString(5), null, System.Globalization.DateTimeStyles.RoundtripKind)));
        }

        var hasMore = offset + result.Count < total;
        return new AuditLogPageResult(
            Page: query.Page,
            PageSize: query.PageSize,
            Total: total,
            HasMore: hasMore,
            Items: result);
    }

    private static string NormalizeSeverity(string? severity)
    {
        var normalized = NormalizeFilter(severity)?.ToLowerInvariant();
        return normalized switch
        {
            "warning" => "warning",
            "error" => "error",
            _ => "info"
        };
    }

    private static string? NormalizeFilter(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return value.Trim();
    }
}
