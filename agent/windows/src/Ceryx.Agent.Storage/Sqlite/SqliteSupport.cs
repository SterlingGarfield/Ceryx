using Microsoft.Data.Sqlite;

namespace Ceryx.Agent.Storage.Sqlite;

public sealed class SqliteConnectionFactory
{
    private const int DefaultCommandTimeoutSeconds = 5;
    private const int BusyTimeoutMilliseconds = 5000;
    private readonly LocalPaths _paths;

    public SqliteConnectionFactory(LocalPaths paths)
    {
        _paths = paths ?? throw new ArgumentNullException(nameof(paths));
    }

    public async Task<SqliteConnection> OpenConnectionAsync(CancellationToken cancellationToken = default)
    {
        var connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = _paths.Database,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Pooling = false,
            DefaultTimeout = DefaultCommandTimeoutSeconds
        }.ToString();

        var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync(cancellationToken);
        await ConfigureConnectionAsync(connection, cancellationToken);
        return connection;
    }

    public static async Task ConfigureConnectionAsync(
        SqliteConnection connection,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(connection);

        var pragma = connection.CreateCommand();
        pragma.CommandText = $"""
            PRAGMA busy_timeout = {BusyTimeoutMilliseconds};
            PRAGMA journal_mode = DELETE;
            PRAGMA synchronous = NORMAL;
            """;
        await pragma.ExecuteNonQueryAsync(cancellationToken);
    }
}
