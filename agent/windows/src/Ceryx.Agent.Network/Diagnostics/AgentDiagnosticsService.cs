using System.Diagnostics;
using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Ceryx.Agent.Capture;
using Ceryx.Agent.Core;
using Ceryx.Agent.Media;
using Ceryx.Agent.Security.Devices;
using Ceryx.Agent.Storage;
using Ceryx.Agent.Storage.Sqlite;

namespace Ceryx.Agent.Network.Diagnostics;

public sealed class AgentDiagnosticsService : IAgentDiagnosticsService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true
    };

    private readonly LocalPaths _paths;
    private readonly SqliteConnectionFactory _connectionFactory;
    private readonly ITrustedDeviceStore _trustedDeviceStore;
    private readonly AgentRuntimeState _runtimeState;
    private readonly ICaptureLifecycleService _captureLifecycleService;
    private readonly ICaptureConnectionStatsProvider _connectionStatsProvider;
    private readonly IWindowCaptureBackendInfo _backendInfo;
    private readonly AgentTlsCertificateManager _tlsCertificateManager;
    private readonly AgentTlsSettings _tlsSettings;

    public AgentDiagnosticsService(
        LocalPaths paths,
        SqliteConnectionFactory connectionFactory,
        ITrustedDeviceStore trustedDeviceStore,
        AgentRuntimeState runtimeState,
        ICaptureLifecycleService captureLifecycleService,
        ICaptureConnectionStatsProvider connectionStatsProvider,
        IWindowCaptureBackendInfo backendInfo,
        AgentTlsCertificateManager tlsCertificateManager,
        AgentTlsSettings tlsSettings)
    {
        _paths = paths ?? throw new ArgumentNullException(nameof(paths));
        _connectionFactory = connectionFactory ?? throw new ArgumentNullException(nameof(connectionFactory));
        _trustedDeviceStore = trustedDeviceStore ?? throw new ArgumentNullException(nameof(trustedDeviceStore));
        _runtimeState = runtimeState ?? throw new ArgumentNullException(nameof(runtimeState));
        _captureLifecycleService = captureLifecycleService ?? throw new ArgumentNullException(nameof(captureLifecycleService));
        _connectionStatsProvider = connectionStatsProvider ?? throw new ArgumentNullException(nameof(connectionStatsProvider));
        _backendInfo = backendInfo ?? throw new ArgumentNullException(nameof(backendInfo));
        _tlsCertificateManager = tlsCertificateManager ?? throw new ArgumentNullException(nameof(tlsCertificateManager));
        _tlsSettings = tlsSettings ?? throw new ArgumentNullException(nameof(tlsSettings));
    }

    public async Task<AgentDiagnosticsExportResult> ExportAsync(CancellationToken cancellationToken = default)
    {
        _paths.EnsureDirectories();

        var generatedAt = DateTimeOffset.UtcNow;
        var exportRoot = Path.Combine(_paths.Root, "DiagnosticsExports");
        Directory.CreateDirectory(exportRoot);

        var pairedDeviceCount = (await _trustedDeviceStore.ListAsync(cancellationToken)).Count;
        var startupCount = CountStartupMarkers();
        var crashDirectory = GetCrashDirectory();
        var logFiles = EnumerateFilesUnder(_paths.Logs, excludeDirectoryNames: ["crashes"]).ToArray();
        var crashFiles = Directory.Exists(crashDirectory)
            ? Directory.GetFiles(crashDirectory, "*.json", SearchOption.AllDirectories)
            : [];

        var archivePath = Path.Combine(exportRoot, $"diagnostics_{generatedAt:yyyyMMddHHmmssfff}.zip");
        await using (var archiveStream = File.Create(archivePath))
        await using (var archive = new ZipArchive(archiveStream, ZipArchiveMode.Create))
        {
            AddJsonEntry(
                archive,
                "manifest.json",
                new
                {
                    ok = true,
                    generatedAt = generatedAt.ToString("O"),
                    archiveName = Path.GetFileName(archivePath),
                    root = _paths.Root,
                    logFileCount = logFiles.Length,
                    crashFileCount = crashFiles.Length,
                    pairedDeviceCount,
                    startupCount,
                    captureBackend = ResolveCaptureBackend(),
                    runtimeStatus = _runtimeState.GetStatus().ToWireValue()
                });

            AddJsonEntry(
                archive,
                "logs/summary.json",
                new
                {
                    ok = true,
                    generatedAt = generatedAt.ToString("O"),
                    logFileCount = logFiles.Length,
                    startupCount
                });

            foreach (var filePath in logFiles)
            {
                var relativePath = Path.GetRelativePath(_paths.Logs, filePath);
                AddFileEntry(archive, Path.Combine("logs", relativePath), filePath);
            }

            AddJsonEntry(
                archive,
                "crashes/summary.json",
                new
                {
                    ok = true,
                    generatedAt = generatedAt.ToString("O"),
                    crashFileCount = crashFiles.Length
                });

            foreach (var filePath in crashFiles)
            {
                var relativePath = Path.GetRelativePath(crashDirectory, filePath);
                AddFileEntry(archive, Path.Combine("crashes", relativePath), filePath);
            }

            AddTextEntry(archive, "config/agent-defaults.env", BuildAgentDefaultsEnv(generatedAt, pairedDeviceCount, startupCount));
            AddJsonEntry(archive, "system/system-info.json", BuildSystemInfo(generatedAt, pairedDeviceCount));
            AddTextEntry(archive, "sqlite/schema.sql", AgentSchema.Sql);
            AddJsonEntry(archive, "sqlite/stats.json", await BuildSqliteStatsAsync(cancellationToken));
        }

        var archiveSizeBytes = new FileInfo(archivePath).Length;
        return new AgentDiagnosticsExportResult(
            Ok: true,
            ArchivePath: archivePath,
            ArchiveSizeBytes: archiveSizeBytes,
            PairedDeviceCount: pairedDeviceCount,
            StartupCount: startupCount,
            GeneratedAt: generatedAt.ToString("O"));
    }

    public async Task<AgentDiagnosticsSelfTestReport> RunSelfTestAsync(CancellationToken cancellationToken = default)
    {
        var generatedAt = DateTimeOffset.UtcNow;
        var checks = new List<AgentDiagnosticsCheckResult>
        {
            BuildNetworkBindCheck(),
            await BuildStorageWriteCheckAsync(cancellationToken),
            BuildCertificateCheck(),
            BuildCaptureBackendCheck()
        };

        var passed = checks.Count(static check => check.Passed);
        var failed = checks.Count - passed;
        return new AgentDiagnosticsSelfTestReport(
            Ok: failed == 0,
            Passed: passed,
            Failed: failed,
            GeneratedAt: generatedAt.ToString("O"),
            Checks: checks);
    }

    private AgentDiagnosticsCheckResult BuildNetworkBindCheck()
    {
        var urls = AgentNetworkBindingResolver.ResolveUrls(_tlsSettings.HttpsPort, _tlsSettings.HttpFallbackPort)
            .ToArray();
        var hasHttps = urls.Any(static url => url.StartsWith("https://", StringComparison.OrdinalIgnoreCase));
        var hasLoopbackFallback = urls.Any(static url => url.StartsWith("http://127.0.0.1:", StringComparison.OrdinalIgnoreCase));
        var passed = hasHttps && hasLoopbackFallback;
        return new AgentDiagnosticsCheckResult(
            Name: "network.bind",
            Passed: passed,
            Message: passed
                ? string.Join(", ", urls)
                : "Expected both HTTPS and local HTTP fallback bindings.");
    }

    private async Task<AgentDiagnosticsCheckResult> BuildStorageWriteCheckAsync(CancellationToken cancellationToken)
    {
        try
        {
            await using var connection = await _connectionFactory.OpenConnectionAsync(cancellationToken);
            await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
            var command = connection.CreateCommand();
            command.Transaction = (Microsoft.Data.Sqlite.SqliteTransaction)transaction;
            command.CommandText = """
                INSERT INTO audit_logs (id, action, details, severity, session_id, created_at)
                VALUES ($id, $action, $details, $severity, $sessionId, $createdAt);
                """;
            command.Parameters.AddWithValue("$id", "diag_" + Guid.NewGuid().ToString("N"));
            command.Parameters.AddWithValue("$action", "diagnostics.self-test");
            command.Parameters.AddWithValue("$details", "storage_write_probe");
            command.Parameters.AddWithValue("$severity", "info");
            command.Parameters.AddWithValue("$sessionId", "diagnostics");
            command.Parameters.AddWithValue("$createdAt", DateTimeOffset.UtcNow.ToString("O"));
            await command.ExecuteNonQueryAsync(cancellationToken);
            await transaction.RollbackAsync(cancellationToken);

            return new AgentDiagnosticsCheckResult(
                Name: "storage.write",
                Passed: true,
                Message: "SQLite write probe completed successfully.");
        }
        catch (Exception ex)
        {
            return new AgentDiagnosticsCheckResult(
                Name: "storage.write",
                Passed: false,
                Message: ex.Message);
        }
    }

    private AgentDiagnosticsCheckResult BuildCertificateCheck()
    {
        var snapshot = _tlsCertificateManager.GetCurrentCertificate();
        var certificate = snapshot.Certificate;
        var passed = certificate.NotAfter.ToUniversalTime() > DateTime.UtcNow &&
                     !string.IsNullOrWhiteSpace(snapshot.Fingerprint);
        return new AgentDiagnosticsCheckResult(
            Name: "certificate.valid",
            Passed: passed,
            Message: passed
                ? $"fingerprint={snapshot.Fingerprint}"
                : "TLS certificate is missing or expired.");
    }

    private AgentDiagnosticsCheckResult BuildCaptureBackendCheck()
    {
        var backend = ResolveCaptureBackend();
        var captureState = _captureLifecycleService.CurrentState;
        var passed = !string.IsNullOrWhiteSpace(backend) && !string.Equals(backend, "unknown", StringComparison.OrdinalIgnoreCase);
        var details = $"backend={backend};active={captureState.Active};windowId={captureState.WindowId ?? string.Empty}";
        return new AgentDiagnosticsCheckResult(
            Name: "capture.backend",
            Passed: passed,
            Message: passed ? details : "Capture backend is unavailable.");
    }

    private string ResolveCaptureBackend()
    {
        var activeBackend = _backendInfo.ActiveBackend;
        if (!string.IsNullOrWhiteSpace(activeBackend))
        {
            return activeBackend.Trim();
        }

        var requestedBackend = _backendInfo.RequestedBackend;
        if (!string.IsNullOrWhiteSpace(requestedBackend))
        {
            return requestedBackend.Trim();
        }

        return "unknown";
    }

    private async Task<object> BuildSqliteStatsAsync(CancellationToken cancellationToken)
    {
        await using var connection = await _connectionFactory.OpenConnectionAsync(cancellationToken);
        var pageCount = await ReadLongScalarAsync(connection, "PRAGMA page_count;", cancellationToken);
        var pageSize = await ReadLongScalarAsync(connection, "PRAGMA page_size;", cancellationToken);
        var freelistCount = await ReadLongScalarAsync(connection, "PRAGMA freelist_count;", cancellationToken);

        return new
        {
            databasePath = _paths.Database,
            exists = File.Exists(_paths.Database),
            sizeBytes = File.Exists(_paths.Database) ? new FileInfo(_paths.Database).Length : 0,
            pageCount,
            pageSize,
            freelistCount,
            tables = new
            {
                pairedDevices = await CountRowsAsync(connection, "paired_devices", cancellationToken),
                remoteSessions = await CountRowsAsync(connection, "remote_sessions", cancellationToken),
                auditLogs = await CountRowsAsync(connection, "audit_logs", cancellationToken),
                projectConfigs = await CountRowsAsync(connection, "project_configs", cancellationToken),
                mediaAssets = await CountRowsAsync(connection, "media_assets", cancellationToken),
                agentSettings = await CountRowsAsync(connection, "agent_settings", cancellationToken),
                notificationReads = await CountRowsAsync(connection, "notification_reads", cancellationToken),
                notificationState = await CountRowsAsync(connection, "notification_state", cancellationToken)
            }
        };
    }

    private static async Task<long> ReadLongScalarAsync(
        Microsoft.Data.Sqlite.SqliteConnection connection,
        string commandText,
        CancellationToken cancellationToken)
    {
        var command = connection.CreateCommand();
        command.CommandText = commandText;
        var result = await command.ExecuteScalarAsync(cancellationToken);
        return Convert.ToInt64(result, System.Globalization.CultureInfo.InvariantCulture);
    }

    private static async Task<long> CountRowsAsync(
        Microsoft.Data.Sqlite.SqliteConnection connection,
        string tableName,
        CancellationToken cancellationToken)
    {
        var command = connection.CreateCommand();
        command.CommandText = $"SELECT COUNT(1) FROM {tableName};";
        var result = await command.ExecuteScalarAsync(cancellationToken);
        return Convert.ToInt64(result, System.Globalization.CultureInfo.InvariantCulture);
    }

    private object BuildSystemInfo(DateTimeOffset generatedAt, int pairedDeviceCount)
    {
        using var process = Process.GetCurrentProcess();
        var uptime = DateTimeOffset.UtcNow - _runtimeState.StartedAt;

        return new
        {
            ok = true,
            generatedAt = generatedAt.ToString("O"),
            machineName = Environment.MachineName,
            userName = Environment.UserName,
            osDescription = RuntimeInformation.OSDescription,
            osArchitecture = RuntimeInformation.OSArchitecture.ToString(),
            frameworkDescription = RuntimeInformation.FrameworkDescription,
            processId = process.Id,
            processName = process.ProcessName,
            workingSetBytes = process.WorkingSet64,
            threadCount = process.Threads.Count,
            uptimeSeconds = Math.Max(0d, uptime.TotalSeconds),
            runtimeStatus = _runtimeState.GetStatus().ToWireValue(),
            captureBackend = ResolveCaptureBackend(),
            requestedCaptureBackend = _backendInfo.RequestedBackend,
            activeConnections = _connectionStatsProvider.ActiveSessionCount,
            connectedSince = _connectionStatsProvider.ConnectedSince?.ToString("O"),
            pairedDeviceCount,
            capture = new
            {
                active = _captureLifecycleService.CurrentState.Active,
                paused = _captureLifecycleService.CurrentState.Paused,
                mode = _captureLifecycleService.CurrentState.Mode,
                windowId = _captureLifecycleService.CurrentState.WindowId,
                width = _captureLifecycleService.CurrentState.Width,
                height = _captureLifecycleService.CurrentState.Height,
                frameRate = _captureLifecycleService.CurrentState.FrameRate,
                quality = _captureLifecycleService.CurrentState.Quality
            },
            tls = new
            {
                fingerprint = _tlsCertificateManager.GetCurrentFingerprint(),
                httpsPort = _tlsSettings.HttpsPort,
                httpFallbackPort = _tlsSettings.HttpFallbackPort
            }
        };
    }

    private string BuildAgentDefaultsEnv(
        DateTimeOffset generatedAt,
        int pairedDeviceCount,
        int startupCount)
    {
        var captureState = _captureLifecycleService.CurrentState;
        return string.Join(
            Environment.NewLine,
            [
                "# Ceryx diagnostics export snapshot",
                $"CERYX_GENERATED_AT={generatedAt:O}",
                $"CERYX_AGENT_ROOT={_paths.Root}",
                $"CERYX_DATABASE={_paths.Database}",
                $"CERYX_HTTP_PORT={_tlsSettings.HttpFallbackPort}",
                $"CERYX_HTTPS_PORT={_tlsSettings.HttpsPort}",
                $"CERYX_CAPTURE_BACKEND={ResolveCaptureBackend()}",
                $"CERYX_RUNTIME_STATUS={_runtimeState.GetStatus().ToWireValue()}",
                $"CERYX_CAPTURE_ACTIVE={captureState.Active}",
                $"CERYX_CAPTURE_PAUSED={captureState.Paused}",
                $"CERYX_CAPTURE_MODE={captureState.Mode}",
                $"CERYX_CAPTURE_WINDOW_ID={captureState.WindowId ?? string.Empty}",
                $"CERYX_CAPTURE_FRAME_RATE={captureState.FrameRate}",
                $"CERYX_CAPTURE_QUALITY={captureState.Quality}",
                $"CERYX_ACTIVE_CONNECTIONS={_connectionStatsProvider.ActiveSessionCount}",
                $"CERYX_PAIRED_DEVICE_COUNT={pairedDeviceCount}",
                $"CERYX_STARTUP_COUNT={startupCount}",
                $"CERYX_CERT_FINGERPRINT={_tlsCertificateManager.GetCurrentFingerprint()}"
            ]);
    }

    private static IEnumerable<string> EnumerateFilesUnder(string root, IEnumerable<string>? excludeDirectoryNames = null)
    {
        if (!Directory.Exists(root))
        {
            yield break;
        }

        var excludes = new HashSet<string>(
            excludeDirectoryNames?.Select(static name => name.Trim()) ?? [],
            StringComparer.OrdinalIgnoreCase);

        foreach (var filePath in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
        {
            var relativePath = Path.GetRelativePath(root, filePath);
            var firstSegment = relativePath.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)[0];
            if (excludes.Contains(firstSegment))
            {
                continue;
            }

            yield return filePath;
        }
    }

    private int CountStartupMarkers()
    {
        var count = 0;
        foreach (var filePath in EnumerateFilesUnder(_paths.Logs, excludeDirectoryNames: ["crashes"]))
        {
            foreach (var line in File.ReadLines(filePath))
            {
                if (line.Contains("Agent host started.", StringComparison.Ordinal))
                {
                    count += 1;
                }
            }
        }

        return count;
    }

    private string GetCrashDirectory()
    {
        return Path.Combine(_paths.Logs, "crashes");
    }

    private static void AddFileEntry(ZipArchive archive, string entryName, string sourcePath)
    {
        var entry = archive.CreateEntry(entryName.Replace(Path.DirectorySeparatorChar, '/'));
        using var entryStream = entry.Open();
        using var fileStream = File.OpenRead(sourcePath);
        fileStream.CopyTo(entryStream);
    }

    private static void AddTextEntry(ZipArchive archive, string entryName, string content)
    {
        var entry = archive.CreateEntry(entryName.Replace(Path.DirectorySeparatorChar, '/'));
        using var entryStream = entry.Open();
        using var writer = new StreamWriter(entryStream, Encoding.UTF8);
        writer.Write(content);
    }

    private static void AddJsonEntry(ZipArchive archive, string entryName, object value)
    {
        var entry = archive.CreateEntry(entryName.Replace(Path.DirectorySeparatorChar, '/'));
        using var entryStream = entry.Open();
        JsonSerializer.Serialize(entryStream, value, JsonOptions);
    }
}
