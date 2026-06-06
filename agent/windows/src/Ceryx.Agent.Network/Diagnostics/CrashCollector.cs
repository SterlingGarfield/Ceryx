using System.Diagnostics;
using System.Text.Json;
using Ceryx.Agent.Capture;
using Ceryx.Agent.Core;
using Ceryx.Agent.Media;
using Ceryx.Agent.Storage;

namespace Ceryx.Agent.Network.Diagnostics;

public sealed class CrashCollector
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true
    };

    private readonly LocalPaths _paths;
    private readonly AgentRuntimeState _runtimeState;
    private readonly ICaptureLifecycleService _captureLifecycleService;
    private readonly ICaptureConnectionStatsProvider _connectionStatsProvider;
    private readonly IWindowCaptureBackendInfo _backendInfo;
    private readonly object _sync = new();

    public CrashCollector(
        LocalPaths paths,
        AgentRuntimeState runtimeState,
        ICaptureLifecycleService captureLifecycleService,
        ICaptureConnectionStatsProvider connectionStatsProvider,
        IWindowCaptureBackendInfo backendInfo)
    {
        _paths = paths ?? throw new ArgumentNullException(nameof(paths));
        _runtimeState = runtimeState ?? throw new ArgumentNullException(nameof(runtimeState));
        _captureLifecycleService = captureLifecycleService ?? throw new ArgumentNullException(nameof(captureLifecycleService));
        _connectionStatsProvider = connectionStatsProvider ?? throw new ArgumentNullException(nameof(connectionStatsProvider));
        _backendInfo = backendInfo ?? throw new ArgumentNullException(nameof(backendInfo));
    }

    public CrashReport Record(Exception exception)
    {
        ArgumentNullException.ThrowIfNull(exception);

        lock (_sync)
        {
            Directory.CreateDirectory(GetCrashDirectory());

            var recordedAt = DateTimeOffset.UtcNow;
            var report = new CrashReport(
                Id: "crash_" + Guid.NewGuid().ToString("N"),
                RecordedAt: recordedAt.ToString("O"),
                ExceptionType: exception.GetType().Name,
                Message: exception.Message,
                StackTrace: exception.StackTrace,
                CaptureBackend: ResolveCaptureBackend(),
                ActiveConnections: Math.Max(0, _connectionStatsProvider.ActiveSessionCount),
                RuntimeStatus: _runtimeState.GetStatus().ToWireValue(),
                WindowId: _captureLifecycleService.CurrentState.WindowId,
                Last50LogLines: ReadRecentLogLines(50));

            var crashPath = Path.Combine(
                GetCrashDirectory(),
                $"crash_{recordedAt:yyyyMMddHHmmssfff}_{Guid.NewGuid():N}.json");
            File.WriteAllText(crashPath, JsonSerializer.Serialize(report, JsonOptions));
            return report;
        }
    }

    private string GetCrashDirectory()
    {
        return Path.Combine(_paths.Logs, "crashes");
    }

    private string ResolveCaptureBackend()
    {
        var activeBackend = _backendInfo.ActiveBackend;
        if (!string.IsNullOrWhiteSpace(activeBackend))
        {
            return activeBackend.Trim();
        }

        return _backendInfo.RequestedBackend.Trim();
    }

    private IReadOnlyList<string> ReadRecentLogLines(int take)
    {
        var logs = Directory.Exists(_paths.Logs)
            ? Directory.GetFiles(_paths.Logs, "agent-*.log", SearchOption.TopDirectoryOnly)
                .OrderBy(static item => item, StringComparer.OrdinalIgnoreCase)
                .ToArray()
            : [];

        if (logs.Length == 0)
        {
            return [];
        }

        var lines = new List<string>(capacity: take * 2);
        foreach (var file in logs)
        {
            foreach (var line in File.ReadLines(file))
            {
                lines.Add(line);
            }
        }

        if (lines.Count <= take)
        {
            return lines;
        }

        return lines.Skip(Math.Max(0, lines.Count - take)).ToArray();
    }
}
