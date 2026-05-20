using Microsoft.Data.Sqlite;

namespace Ceryx.Agent.Storage.Sqlite;

public sealed class SqliteConnectionFactory
{
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
            Pooling = false
        }.ToString();

        var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync(cancellationToken);
        return connection;
    }
}
