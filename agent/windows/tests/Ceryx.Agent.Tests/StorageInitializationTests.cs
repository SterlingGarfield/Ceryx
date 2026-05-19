using Ceryx.Agent.Storage;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Ceryx.Agent.Tests;

public sealed class StorageInitializationTests
{
    [Fact]
    public async Task InitializeAsync_CreatesDatabaseAndPlaceholderTables()
    {
        var tempRoot = Path.Combine(Path.GetTempPath(), "ceryx-storage-" + Guid.NewGuid().ToString("N"));

        try
        {
            var paths = new LocalPaths(tempRoot);
            var bootstrapper = new StorageBootstrapper(paths);

            await bootstrapper.InitializeAsync();

            Assert.True(File.Exists(paths.Database));

            var connectionString = new SqliteConnectionStringBuilder
            {
                DataSource = paths.Database,
                Pooling = false
            }.ToString();
            await using var connection = new SqliteConnection(connectionString);
            await connection.OpenAsync();

            var expectedTables = new HashSet<string>(StringComparer.Ordinal)
            {
                "paired_devices",
                "remote_sessions",
                "audit_logs",
                "project_configs",
                "media_assets"
            };

            var command = connection.CreateCommand();
            command.CommandText = """
                SELECT name
                FROM sqlite_master
                WHERE type = 'table'
                  AND name IN (
                    'paired_devices',
                    'remote_sessions',
                    'audit_logs',
                    'project_configs',
                    'media_assets'
                  );
                """;

            var foundTables = new HashSet<string>(StringComparer.Ordinal);
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                foundTables.Add(reader.GetString(0));
            }

            Assert.Subset(foundTables, expectedTables);
            Assert.Equal(expectedTables.Count, foundTables.Count);
        }
        finally
        {
            if (Directory.Exists(tempRoot))
            {
                Directory.Delete(tempRoot, recursive: true);
            }
        }
    }
}
