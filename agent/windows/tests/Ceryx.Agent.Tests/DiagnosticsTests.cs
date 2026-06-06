using System.IO.Compression;
using System.Text.Json;
using Ceryx.Agent.Codex.WindowLocator;
using Ceryx.Agent.Capture;
using Ceryx.Agent.Core;
using Ceryx.Agent.Media;
using Ceryx.Agent.Network;
using Ceryx.Agent.Network.Diagnostics;
using Ceryx.Agent.Security.Devices;
using Ceryx.Agent.Storage;
using Ceryx.Agent.Storage.Devices;
using Ceryx.Agent.Storage.Sqlite;
using Xunit;

namespace Ceryx.Agent.Tests;

public sealed class DiagnosticsTests
{
    [Fact]
    public void CrashCollector_WritesCrashReportWithRecentLogLines()
    {
        var tempRoot = CreateTempRoot();

        try
        {
            var paths = new LocalPaths(tempRoot);
            paths.EnsureDirectories();
            File.WriteAllText(
                Path.Combine(paths.Logs, "agent-20260606.log"),
                """
                2026-06-06 10:00:00.000 +08:00 [INF] Agent host started. urls=https://127.0.0.1:41527
                2026-06-06 10:00:01.000 +08:00 [INF] Tray shell initialized with commands: open_logs_folder
                2026-06-06 10:00:02.000 +08:00 [INF] Agent host stopped.
                """);

            var collector = new CrashCollector(
                paths,
                new AgentRuntimeState(),
                new FakeCaptureLifecycleService(active: true),
                new FakeCaptureConnectionStatsProvider(activeSessionCount: 2),
                new FakeWindowCaptureBackendInfo("wgc"));

            var report = collector.Record(new InvalidOperationException("boom"));
            Assert.Equal("InvalidOperationException", report.ExceptionType);
            Assert.Equal("boom", report.Message);
            Assert.Equal("wgc", report.CaptureBackend);

            var crashDir = Path.Combine(paths.Logs, "crashes");
            var crashFiles = Directory.GetFiles(crashDir, "crash_*.json");
            Assert.Single(crashFiles);

            using var document = JsonDocument.Parse(File.ReadAllText(crashFiles[0]));
            var root = document.RootElement;
            Assert.Equal("InvalidOperationException", root.GetProperty("exceptionType").GetString());
            Assert.Equal("boom", root.GetProperty("message").GetString());
            Assert.Equal("wgc", root.GetProperty("captureBackend").GetString());
            Assert.Equal(2, root.GetProperty("activeConnections").GetInt32());

            var logLines = root.GetProperty("last50LogLines").EnumerateArray().Select(static item => item.GetString()).ToArray();
            Assert.Contains(logLines, line => line is not null && line.Contains("Agent host started.", StringComparison.Ordinal));
        }
        finally
        {
            CleanupTempRoot(tempRoot);
        }
    }

    [Fact]
    public async Task AgentDiagnosticsService_ExportsArchiveWithManifestAndSystemInfo()
    {
        var tempRoot = CreateTempRoot();

        try
        {
            var paths = new LocalPaths(tempRoot);
            paths.EnsureDirectories();
            File.WriteAllText(
                Path.Combine(paths.Logs, "agent-20260606.log"),
                """
                2026-06-06 10:00:00.000 +08:00 [INF] Agent host started. urls=https://127.0.0.1:41527
                2026-06-06 10:02:00.000 +08:00 [INF] Agent host stopped.
                """);

            var bootstrapper = new StorageBootstrapper(paths);
            await bootstrapper.InitializeAsync();

            var store = new SqliteTrustedDeviceStore(new SqliteConnectionFactory(paths));
            await store.AddAsync(new TrustedDeviceRecord(
                DeviceId: "device-1",
                Name: "Diagnostics Test",
                Platform: "ios",
                ClientType: "ipad",
                TokenHash: "hash-1",
                Permissions: [Ceryx.Agent.Core.Permission.ViewWindow],
                CertFingerprint: "ABCDEF0123456789",
                Wol: null,
                CreatedAt: DateTimeOffset.UtcNow));

            var service = CreateDiagnosticsService(paths);
            var result = await service.ExportAsync();

            Assert.True(result.Ok);
            Assert.True(File.Exists(result.ArchivePath));
            Assert.True(result.ArchiveSizeBytes > 0);
            Assert.True(result.PairedDeviceCount >= 1);
            Assert.True(result.StartupCount >= 1);

            using var archive = ZipFile.OpenRead(result.ArchivePath);
            Assert.Contains(archive.Entries, entry => entry.FullName.Equals("manifest.json", StringComparison.OrdinalIgnoreCase));
            Assert.Contains(archive.Entries, entry => entry.FullName.StartsWith("logs/", StringComparison.OrdinalIgnoreCase));
            Assert.Contains(archive.Entries, entry => entry.FullName.StartsWith("crashes/", StringComparison.OrdinalIgnoreCase));
            Assert.Contains(archive.Entries, entry => entry.FullName.Equals("config/agent-defaults.env", StringComparison.OrdinalIgnoreCase));
            Assert.Contains(archive.Entries, entry => entry.FullName.Equals("system/system-info.json", StringComparison.OrdinalIgnoreCase));
            Assert.Contains(archive.Entries, entry => entry.FullName.Equals("sqlite/schema.sql", StringComparison.OrdinalIgnoreCase));
            Assert.Contains(archive.Entries, entry => entry.FullName.Equals("sqlite/stats.json", StringComparison.OrdinalIgnoreCase));
        }
        finally
        {
            CleanupTempRoot(tempRoot);
        }
    }

    [Fact]
    public async Task AgentDiagnosticsService_RunSelfTestReportsCoreChecks()
    {
        var tempRoot = CreateTempRoot();

        try
        {
            var paths = new LocalPaths(tempRoot);
            paths.EnsureDirectories();

            var bootstrapper = new StorageBootstrapper(paths);
            await bootstrapper.InitializeAsync();

            var service = CreateDiagnosticsService(paths, captureBackend: "wgc");
            var report = await service.RunSelfTestAsync();

            Assert.True(report.Ok);
            Assert.Equal(0, report.Failed);
            Assert.True(report.Passed > 0);
            Assert.Contains(report.Checks, check => check.Name == "network.bind");
            Assert.Contains(report.Checks, check => check.Name == "storage.write");
            Assert.Contains(report.Checks, check => check.Name == "certificate.valid");
            Assert.Contains(report.Checks, check => check.Name == "capture.backend");
        }
        finally
        {
            CleanupTempRoot(tempRoot);
        }
    }

    private static AgentDiagnosticsService CreateDiagnosticsService(LocalPaths paths, string captureBackend = "wgc")
    {
        var runtimeState = new AgentRuntimeState();
        var captureLifecycleService = new FakeCaptureLifecycleService(active: true);
        var connectionStatsProvider = new FakeCaptureConnectionStatsProvider(activeSessionCount: 1);
        var backendInfo = new FakeWindowCaptureBackendInfo(captureBackend);
        var tlsSettings = new AgentTlsSettings(41527, 41528, 365);
        var tlsManager = new AgentTlsCertificateManager(
            paths,
            tlsSettings,
            ["127.0.0.1", "192.168.1.25"]);

        return new AgentDiagnosticsService(
            paths,
            new SqliteConnectionFactory(paths),
            new SqliteTrustedDeviceStore(new SqliteConnectionFactory(paths)),
            runtimeState,
            captureLifecycleService,
            connectionStatsProvider,
            backendInfo,
            tlsManager,
            tlsSettings);
    }

    private static string CreateTempRoot()
    {
        return Path.Combine(Path.GetTempPath(), "ceryx-diagnostics-" + Guid.NewGuid().ToString("N"));
    }

    private static void CleanupTempRoot(string tempRoot)
    {
        if (!Directory.Exists(tempRoot))
        {
            return;
        }

        try
        {
            Directory.Delete(tempRoot, recursive: true);
        }
        catch
        {
            // Best-effort cleanup for test temp directories.
        }
    }

    private sealed class FakeCaptureLifecycleService : ICaptureLifecycleService
    {
        public FakeCaptureLifecycleService(bool active)
        {
            CurrentState = new CaptureState(
                Active: active,
                Paused: false,
                Mode: "balanced",
                WindowId: active ? "w-diagnostics" : null,
                Width: 1280,
                Height: 720);
        }

        public CaptureState CurrentState { get; }

        public CaptureConnectionStatsSnapshot GetConnectionStatsSnapshot()
        {
            return new CaptureConnectionStatsSnapshot(
                CurrentTier: "medium",
                Resolution: "1280x720",
                FrameRate: 30,
                BitrateKbps: 0,
                PacketsLost: 0,
                PacketsSent: 0,
                PacketLossPercent: 0,
                RoundTripTimeMs: 0,
                JitterMs: 0);
        }

        public Task<Result<CaptureState>> StartAsync(
            CaptureStartBody body,
            CodexWindowSnapshot window,
            CancellationToken cancellationToken = default)
        {
            return Task.FromResult(Result<CaptureState>.Success(CurrentState));
        }

        public Task<CaptureState> StopAsync(CancellationToken cancellationToken = default)
        {
            return Task.FromResult(CurrentState);
        }

        public Task<CapturePolicyResult> ApplyPerformanceSignalAsync(
            CapturePerformanceSignal signal,
            CancellationToken cancellationToken = default)
        {
            return Task.FromResult(new CapturePolicyResult(CurrentState, false));
        }
    }

    private sealed class FakeCaptureConnectionStatsProvider : ICaptureConnectionStatsProvider
    {
        public FakeCaptureConnectionStatsProvider(int activeSessionCount)
        {
            ActiveSessionCount = activeSessionCount;
            ConnectedSince = DateTimeOffset.UtcNow.AddMinutes(-5);
        }

        public int ActiveSessionCount { get; }

        public DateTimeOffset? ConnectedSince { get; }
    }

    private sealed class FakeWindowCaptureBackendInfo : IWindowCaptureBackendInfo
    {
        public FakeWindowCaptureBackendInfo(string activeBackend)
        {
            ActiveBackend = activeBackend;
            RequestedBackend = activeBackend;
        }

        public string ActiveBackend { get; }

        public string RequestedBackend { get; }
    }
}
