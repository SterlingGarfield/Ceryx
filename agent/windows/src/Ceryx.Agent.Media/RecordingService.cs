using Ceryx.Agent.Codex.WindowLocator;
using Ceryx.Agent.Core;
using Ceryx.Agent.Storage;

namespace Ceryx.Agent.Media;

public sealed class RecordingService : IRecordingService
{
    private const long MinFreeBytesRequired = 256L * 1024 * 1024;
    private static readonly TimeSpan MaxDuration = TimeSpan.FromMinutes(30);

    private readonly object _sync = new();
    private readonly LocalPaths _localPaths;
    private readonly IDiskSpaceProvider _diskSpaceProvider;

    private RecordingState? _active;

    public RecordingService(LocalPaths localPaths, IDiskSpaceProvider diskSpaceProvider)
    {
        _localPaths = localPaths ?? throw new ArgumentNullException(nameof(localPaths));
        _diskSpaceProvider = diskSpaceProvider ?? throw new ArgumentNullException(nameof(diskSpaceProvider));
    }

    public Task<Result<RecordingStartResponse>> StartAsync(
        CodexWindowSnapshot window,
        CancellationToken cancellationToken = default)
    {
        if (window.WindowId is null || window.Status is "not_found" or "multiple_candidates" or "permission_issue")
        {
            return Task.FromResult(Result<RecordingStartResponse>.Failure(new AgentError(
                Code: "E_CODEX_NOT_FOUND",
                Message: "Codex window is unavailable.",
                TraceId: "trace_recording_window")));
        }

        lock (_sync)
        {
            EnsureTimeoutUnlocked(DateTimeOffset.UtcNow);
            if (_active is not null)
            {
                return Task.FromResult(Result<RecordingStartResponse>.Failure(new AgentError(
                    Code: "E_RECORDING_BUSY",
                    Message: "Recording is already active.",
                    TraceId: "trace_recording_busy")));
            }

            var freeBytes = _diskSpaceProvider.GetAvailableBytes(_localPaths.Recordings);
            if (freeBytes < MinFreeBytesRequired)
            {
                return Task.FromResult(Result<RecordingStartResponse>.Failure(new AgentError(
                    Code: "E_DISK_LOW",
                    Message: "Insufficient disk space for recording.",
                    TraceId: "trace_recording_disk")));
            }

            var now = DateTimeOffset.UtcNow;
            _active = new RecordingState(
                FileName: $"recording_{now:yyyyMMdd_HHmmss}.mp4",
                StartedAt: now);

            return Task.FromResult(Result<RecordingStartResponse>.Success(new RecordingStartResponse(
                Ok: true,
                Status: "recording",
                StartedAt: now.ToString("O"))));
        }
    }

    public async Task<Result<RecordingStopResponse>> StopAsync(CancellationToken cancellationToken = default)
    {
        RecordingState? state;
        lock (_sync)
        {
            EnsureTimeoutUnlocked(DateTimeOffset.UtcNow);
            state = _active;
            _active = null;
        }

        if (state is null)
        {
            return Result<RecordingStopResponse>.Failure(new AgentError(
                Code: "E_RECORDING_BUSY",
                Message: "No active recording.",
                TraceId: "trace_recording_none"));
        }

        var path = Path.Combine(_localPaths.Recordings, state.FileName);
        var payload = System.Text.Encoding.UTF8.GetBytes("Ceryx recording placeholder");
        await File.WriteAllBytesAsync(path, payload, cancellationToken);

        return Result<RecordingStopResponse>.Success(new RecordingStopResponse(
            Ok: true,
            Status: "stopped",
            FileName: state.FileName,
            SizeBytes: payload.LongLength));
    }

    private void EnsureTimeoutUnlocked(DateTimeOffset now)
    {
        if (_active is null)
        {
            return;
        }

        if (_active.StartedAt.Add(MaxDuration) <= now)
        {
            _active = null;
        }
    }

    private sealed record RecordingState(string FileName, DateTimeOffset StartedAt);
}
