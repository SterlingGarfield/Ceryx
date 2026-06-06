using Ceryx.Agent.Core;
using Ceryx.Agent.Security.Devices;
using Ceryx.Agent.Security.Pairing;
using Ceryx.Agent.Security.Tokens;
using Ceryx.Agent.Storage;
using Ceryx.Agent.Storage.Devices;
using Ceryx.Agent.Storage.Sqlite;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Ceryx.Agent.Tests;

public sealed class TokenServicesTests
{
    [Fact]
    public void TokenHasher_ComputesSha256AndVerifies()
    {
        var generator = new DeviceTokenGenerator();
        var hasher = new DeviceTokenHasher();

        var token = generator.GenerateToken();
        var hash = hasher.Hash(token);

        Assert.StartsWith("dt_", token, StringComparison.Ordinal);
        Assert.Equal(64, hash.Length);
        Assert.True(hasher.Verify(token, hash));
        Assert.False(hasher.Verify(token + "_x", hash));
    }
}

public sealed class TrustedDevicesStoreTests
{
    [Fact]
    public async Task TrustedDevicesStore_DeleteAlsoRemovesSessions()
    {
        var tempRoot = Path.Combine(Path.GetTempPath(), "ceryx-trust-" + Guid.NewGuid().ToString("N"));

        try
        {
            var paths = new LocalPaths(tempRoot);
            var bootstrapper = new StorageBootstrapper(paths);
            await bootstrapper.InitializeAsync();

            var connectionFactory = new SqliteConnectionFactory(paths);
            var store = new SqliteTrustedDeviceStore(connectionFactory);
            var tokenHasher = new DeviceTokenHasher();
            var token = "dt_local_token_123";
            var tokenHash = tokenHasher.Hash(token);

            var device = new TrustedDeviceRecord(
                DeviceId: "dev_test_001",
                Name: "iPad Pro",
                Platform: "ios",
                ClientType: "ipad",
                TokenHash: tokenHash,
                Permissions: [Permission.ViewWindow, Permission.SendPrompt],
                CertFingerprint: "ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890",
                Wol: new WakeOnLanInfo(
                    Supported: true,
                    MacAddresses: ["AA:BB:CC:DD:EE:FF"],
                    BroadcastAddress: "192.168.1.255",
                    Port: 9),
                CreatedAt: DateTimeOffset.UtcNow);

            await store.AddAsync(device);

            var found = await store.FindByTokenHashAsync(tokenHash);
            Assert.NotNull(found);
            Assert.Equal(device.DeviceId, found!.DeviceId);
            Assert.Equal(device.CertFingerprint, found.CertFingerprint);
            Assert.NotNull(found.Wol);
            Assert.Equal("192.168.1.255", found.Wol!.BroadcastAddress);
            Assert.Contains("AA:BB:CC:DD:EE:FF", found.Wol.MacAddresses);

            var listed = await store.ListAsync();
            Assert.Contains(listed, item => item.DeviceId == device.DeviceId);

            await InsertSessionAsync(paths.Database, device.DeviceId);
            var deleted = await store.DeleteAsync(device.DeviceId);

            Assert.True(deleted);
            Assert.Null(await store.FindByTokenHashAsync(tokenHash));
            Assert.Equal(0, await CountSessionsForDeviceAsync(paths.Database, device.DeviceId));
        }
        finally
        {
            if (Directory.Exists(tempRoot))
            {
                Directory.Delete(tempRoot, recursive: true);
            }
        }
    }

    private static async Task InsertSessionAsync(string databasePath, string deviceId)
    {
        var connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Pooling = false
        }.ToString();

        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();

        var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO remote_sessions (id, controller_device_id, started_at)
            VALUES ($id, $deviceId, $startedAt);
            """;
        command.Parameters.AddWithValue("$id", "sess_" + Guid.NewGuid().ToString("N"));
        command.Parameters.AddWithValue("$deviceId", deviceId);
        command.Parameters.AddWithValue("$startedAt", DateTimeOffset.UtcNow.ToString("O"));
        await command.ExecuteNonQueryAsync();
    }

    private static async Task<long> CountSessionsForDeviceAsync(string databasePath, string deviceId)
    {
        var connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Pooling = false
        }.ToString();

        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();

        var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(1) FROM remote_sessions WHERE controller_device_id = $deviceId;";
        command.Parameters.AddWithValue("$deviceId", deviceId);

        var count = await command.ExecuteScalarAsync();
        return count is long longCount ? longCount : Convert.ToInt64(count);
    }
}

public sealed class PairingTrustedDevicesFlowTests
{
    [Fact]
    public async Task PairingCompletionService_PersistsTokenHashAndReturnsPlainToken()
    {
        var tempRoot = Path.Combine(Path.GetTempPath(), "ceryx-pairing-" + Guid.NewGuid().ToString("N"));

        try
        {
            var paths = new LocalPaths(tempRoot);
            var bootstrapper = new StorageBootstrapper(paths);
            await bootstrapper.InitializeAsync();

            var connectionFactory = new SqliteConnectionFactory(paths);
            var store = new SqliteTrustedDeviceStore(connectionFactory);
            var tokenHasher = new DeviceTokenHasher();
            var stateMachine = new PairingStateMachine(
                new SystemPairingClock(),
                new FixedCodeGenerator("654321"),
                new NoOpPairingAuditSink());
            var completionService = new PairingCompletionService(
                stateMachine,
                store,
                new DeviceTokenGenerator(),
                tokenHasher,
                new DefaultPermissionPolicy(),
                new FixedWakeOnLanInfoProvider(),
                new FixedCertificateFingerprintProvider());

            var request = await stateMachine.RequestAsync(new PairingRequestContext("My iPad", "ipad", "ios"));
            Assert.True(request.IsAccepted);
            Assert.NotNull(request.PairingId);
            var approved = await stateMachine.ApproveOnDesktopAsync(request.PairingId!);
            Assert.True(approved.IsApproved);

            var completion = await completionService.ConfirmAsync(request.PairingId!, "654321");
            Assert.True(completion.IsSuccess);
            Assert.NotNull(completion.Success);

            var success = completion.Success!;
            Assert.StartsWith("dev_", success.DeviceId, StringComparison.Ordinal);
            Assert.StartsWith("dt_", success.DeviceToken, StringComparison.Ordinal);
            Assert.Contains(Permission.ViewWindow, success.Permissions);
            Assert.Matches("^[A-F0-9]{64}$", success.CertFingerprint);
            Assert.NotNull(success.Wol);
            Assert.Equal("192.168.1.255", success.Wol!.BroadcastAddress);

            var stored = await store.FindByTokenHashAsync(tokenHasher.Hash(success.DeviceToken));
            Assert.NotNull(stored);
            Assert.Equal(success.DeviceId, stored!.DeviceId);
            Assert.NotEqual(success.DeviceToken, stored.TokenHash);
            Assert.Equal(success.CertFingerprint, stored.CertFingerprint);
            Assert.NotNull(stored.Wol);
            Assert.Equal(success.Wol.BroadcastAddress, stored.Wol!.BroadcastAddress);
        }
        finally
        {
            if (Directory.Exists(tempRoot))
            {
                Directory.Delete(tempRoot, recursive: true);
            }
        }
    }

    private sealed class FixedCodeGenerator : IPairingCodeGenerator
    {
        private readonly string _code;

        public FixedCodeGenerator(string code)
        {
            _code = code;
        }

        public string GenerateSixDigitCode()
        {
            return _code;
        }
    }

    private sealed class FixedWakeOnLanInfoProvider : IWakeOnLanInfoProvider
    {
        public WakeOnLanInfo GetWakeOnLanInfo()
        {
            return new WakeOnLanInfo(
                Supported: true,
                MacAddresses: ["AA:BB:CC:DD:EE:FF"],
                BroadcastAddress: "192.168.1.255",
                Port: 9);
        }
    }

    private sealed class FixedCertificateFingerprintProvider : IAgentCertificateFingerprintProvider
    {
        public string GetCurrentFingerprint()
        {
            return "ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890";
        }
    }
}
