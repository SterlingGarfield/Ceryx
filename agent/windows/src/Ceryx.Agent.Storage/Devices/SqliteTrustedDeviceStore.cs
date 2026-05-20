using Ceryx.Agent.Core;
using Ceryx.Agent.Security.Devices;
using Ceryx.Agent.Storage.Sqlite;
using Microsoft.Data.Sqlite;

namespace Ceryx.Agent.Storage.Devices;

public sealed class SqliteTrustedDeviceStore : ITrustedDeviceStore
{
    private readonly SqliteConnectionFactory _connectionFactory;

    public SqliteTrustedDeviceStore(SqliteConnectionFactory connectionFactory)
    {
        _connectionFactory = connectionFactory ?? throw new ArgumentNullException(nameof(connectionFactory));
    }

    public async Task AddAsync(TrustedDeviceRecord device, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(device);

        await using var connection = await _connectionFactory.OpenConnectionAsync(cancellationToken);
        var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO paired_devices (
                id,
                name,
                platform,
                client_type,
                token_hash,
                permissions_json,
                created_at
            )
            VALUES (
                $id,
                $name,
                $platform,
                $clientType,
                $tokenHash,
                $permissionsJson,
                $createdAt
            );
            """;
        command.Parameters.AddWithValue("$id", device.DeviceId);
        command.Parameters.AddWithValue("$name", device.Name);
        command.Parameters.AddWithValue("$platform", device.Platform);
        command.Parameters.AddWithValue("$clientType", device.ClientType);
        command.Parameters.AddWithValue("$tokenHash", device.TokenHash);
        command.Parameters.AddWithValue("$permissionsJson", SerializePermissions(device.Permissions));
        command.Parameters.AddWithValue("$createdAt", device.CreatedAt.ToString("O"));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<TrustedDeviceRecord>> ListAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = await _connectionFactory.OpenConnectionAsync(cancellationToken);
        var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, name, platform, client_type, token_hash, permissions_json, created_at
            FROM paired_devices
            ORDER BY created_at DESC;
            """;

        var devices = new List<TrustedDeviceRecord>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            devices.Add(new TrustedDeviceRecord(
                DeviceId: reader.GetString(0),
                Name: reader.GetString(1),
                Platform: reader.GetString(2),
                ClientType: reader.GetString(3),
                TokenHash: reader.GetString(4),
                Permissions: DeserializePermissions(reader.GetString(5)),
                CreatedAt: DateTimeOffset.Parse(reader.GetString(6), null, System.Globalization.DateTimeStyles.RoundtripKind)));
        }

        return devices;
    }

    public async Task<TrustedDeviceRecord?> FindByTokenHashAsync(string tokenHash, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(tokenHash);

        await using var connection = await _connectionFactory.OpenConnectionAsync(cancellationToken);
        var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, name, platform, client_type, token_hash, permissions_json, created_at
            FROM paired_devices
            WHERE token_hash = $tokenHash
            LIMIT 1;
            """;
        command.Parameters.AddWithValue("$tokenHash", tokenHash);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return new TrustedDeviceRecord(
            DeviceId: reader.GetString(0),
            Name: reader.GetString(1),
            Platform: reader.GetString(2),
            ClientType: reader.GetString(3),
            TokenHash: reader.GetString(4),
            Permissions: DeserializePermissions(reader.GetString(5)),
            CreatedAt: DateTimeOffset.Parse(reader.GetString(6), null, System.Globalization.DateTimeStyles.RoundtripKind));
    }

    public async Task<bool> DeleteAsync(string deviceId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(deviceId);

        await using var connection = await _connectionFactory.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        var deleteDevice = connection.CreateCommand();
        deleteDevice.Transaction = (SqliteTransaction)transaction;
        deleteDevice.CommandText = "DELETE FROM paired_devices WHERE id = $id;";
        deleteDevice.Parameters.AddWithValue("$id", deviceId);
        var deleted = await deleteDevice.ExecuteNonQueryAsync(cancellationToken);

        var deleteSessions = connection.CreateCommand();
        deleteSessions.Transaction = (SqliteTransaction)transaction;
        deleteSessions.CommandText = "DELETE FROM remote_sessions WHERE controller_device_id = $id;";
        deleteSessions.Parameters.AddWithValue("$id", deviceId);
        await deleteSessions.ExecuteNonQueryAsync(cancellationToken);

        await transaction.CommitAsync(cancellationToken);
        return deleted > 0;
    }

    private static string SerializePermissions(IReadOnlyList<Permission> permissions)
    {
        var values = permissions.Select(static permission => permission.ToWireValue()).ToArray();
        return System.Text.Json.JsonSerializer.Serialize(values);
    }

    private static IReadOnlyList<Permission> DeserializePermissions(string permissionsJson)
    {
        var values = System.Text.Json.JsonSerializer.Deserialize<string[]>(permissionsJson) ?? [];
        var result = new List<Permission>(values.Length);

        foreach (var value in values)
        {
            if (TryParsePermission(value, out var permission))
            {
                result.Add(permission);
            }
        }

        return result;
    }

    private static bool TryParsePermission(string value, out Permission permission)
    {
        permission = value switch
        {
            "view_window" => Permission.ViewWindow,
            "control_input" => Permission.ControlInput,
            "send_prompt" => Permission.SendPrompt,
            "upload_image" => Permission.UploadImage,
            "read_diff" => Permission.ReadDiff,
            "run_test" => Permission.RunTest,
            "screenshot" => Permission.Screenshot,
            "recording" => Permission.Recording,
            "copy_output" => Permission.CopyOutput,
            "manage_agent" => Permission.ManageAgent,
            "manage_devices" => Permission.ManageDevices,
            _ => default
        };

        return value is
            "view_window" or
            "control_input" or
            "send_prompt" or
            "upload_image" or
            "read_diff" or
            "run_test" or
            "screenshot" or
            "recording" or
            "copy_output" or
            "manage_agent" or
            "manage_devices";
    }
}
