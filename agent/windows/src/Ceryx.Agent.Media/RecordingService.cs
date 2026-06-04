using System.Text.Json;
using Ceryx.Agent.Codex.WindowLocator;
using Ceryx.Agent.Core;
using Ceryx.Agent.Storage;

namespace Ceryx.Agent.Media;

public sealed class RecordingService : IRecordingService
{
    private const long MinFreeBytesRequired = 1024L * 1024 * 1024;
    private const int DefaultFrameRate = 30;
    private const int DefaultMaxDurationMinutes = 30;
    private const int DefaultSegmentSizeMB = 4000;
    private const string DefaultAudioSource = "system";
    private const string AudioFormat = "pcm_s16le";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    private readonly object _sync = new();
    private readonly LocalPaths _localPaths;
    private readonly IDiskSpaceProvider _diskSpaceProvider;
    private readonly IWindowImageCapture _windowImageCapture;
    private readonly IAudioCaptureService _audioCaptureService;
    private readonly IRecordingMediaEncoder _mediaEncoder;

    private RecordingState? _active;

    public RecordingService(
        LocalPaths localPaths,
        IDiskSpaceProvider diskSpaceProvider,
        IWindowImageCapture windowImageCapture,
        IAudioCaptureService audioCaptureService,
        IRecordingMediaEncoder mediaEncoder)
    {
        _localPaths = localPaths ?? throw new ArgumentNullException(nameof(localPaths));
        _diskSpaceProvider = diskSpaceProvider ?? throw new ArgumentNullException(nameof(diskSpaceProvider));
        _windowImageCapture = windowImageCapture ?? throw new ArgumentNullException(nameof(windowImageCapture));
        _audioCaptureService = audioCaptureService ?? throw new ArgumentNullException(nameof(audioCaptureService));
        _mediaEncoder = mediaEncoder ?? throw new ArgumentNullException(nameof(mediaEncoder));
    }

    public bool IsActive
    {
        get
        {
            lock (_sync)
            {
                return _active is not null;
            }
        }
    }

    public bool IsAudioActive
    {
        get
        {
            lock (_sync)
            {
                return _active?.AudioSession is not null;
            }
        }
    }

    public async Task<Result<RecordingStartResponse>> StartAsync(
        CodexWindowSnapshot window,
        RecordingStartBody? request = null,
        CancellationToken cancellationToken = default)
    {
        if (window.WindowId is null || window.Status is "not_found" or "multiple_candidates" or "permission_issue")
        {
            return Result<RecordingStartResponse>.Failure(new AgentError(
                Code: "E_CODEX_NOT_FOUND",
                Message: "Codex window is unavailable.",
                TraceId: "trace_recording_window"));
        }

        var includeAudio = request?.IncludeAudio ?? false;
        var audioSource = NormalizeAudioSource(request?.AudioSource);
        if (includeAudio && !string.Equals(audioSource, DefaultAudioSource, StringComparison.OrdinalIgnoreCase))
        {
            return Result<RecordingStartResponse>.Failure(new AgentError(
                Code: "E_AUDIO_SOURCE_UNSUPPORTED",
                Message: $"Audio source '{audioSource}' is not supported yet.",
                TraceId: "trace_recording_audio_source"));
        }

        var maxDurationMinutes = ClampPositive(request?.MaxDurationMinutes, DefaultMaxDurationMinutes, 600);
        var segmentSizeMB = ClampPositive(request?.SegmentSizeMB, DefaultSegmentSizeMB, 16384);
        var frameRate = DefaultFrameRate;

        lock (_sync)
        {
            EnsureTimeoutUnlocked(DateTimeOffset.UtcNow);
            if (_active is not null)
            {
                return Result<RecordingStartResponse>.Failure(new AgentError(
                    Code: "E_RECORDING_BUSY",
                    Message: "Recording is already active.",
                    TraceId: "trace_recording_busy"));
            }

            var freeBytes = _diskSpaceProvider.GetAvailableBytes(_localPaths.Recordings);
            if (freeBytes < MinFreeBytesRequired)
            {
                return Result<RecordingStartResponse>.Failure(new AgentError(
                    Code: "E_DISK_LOW",
                    Message: "Insufficient disk space for recording.",
                    TraceId: "trace_recording_disk"));
            }
        }

        var now = DateTimeOffset.UtcNow;
        var recordingId = $"rec_{now:yyyyMMdd_HHmmss}_{Guid.NewGuid().ToString("N")[..8]}";
        var sessionDirectory = Path.Combine(_localPaths.Recordings, recordingId);
        var framesDirectory = Path.Combine(sessionDirectory, "frames");
        Directory.CreateDirectory(sessionDirectory);
        Directory.CreateDirectory(framesDirectory);

        var frameCaptureResult = await CaptureFrameAsync(window, Path.Combine(sessionDirectory, "thumbnail.jpg"), Path.Combine(framesDirectory, "frame_000001.jpg"), cancellationToken);
        if (!frameCaptureResult.IsSuccess)
        {
            SafeDeleteDirectory(sessionDirectory);
            return Result<RecordingStartResponse>.Failure(frameCaptureResult.Error ?? new AgentError(
                Code: "E_RECORDING_FAILED",
                Message: "Failed to capture initial recording frame.",
                TraceId: "trace_recording_initial_frame"));
        }

        RecordingAudioSession? audioSession = null;
        if (includeAudio)
        {
            var audioPath = Path.Combine(sessionDirectory, "audio.wav");
            var audioStart = await _audioCaptureService.StartAsync(audioPath, cancellationToken);
            if (!audioStart.IsSuccess || audioStart.Value is null)
            {
                SafeDeleteDirectory(sessionDirectory);
                return Result<RecordingStartResponse>.Failure(audioStart.Error ?? new AgentError(
                    Code: "E_RECORDING_FAILED",
                    Message: "Failed to start audio capture.",
                    TraceId: "trace_recording_audio_start"));
            }

            audioSession = audioStart.Value;
        }

        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var state = new RecordingState(
            RecordingId: recordingId,
            SessionDirectory: sessionDirectory,
            FramesDirectory: framesDirectory,
            ThumbnailFileName: "thumbnail.jpg",
            StartedAt: now,
            IncludeAudio: includeAudio,
            AudioSource: audioSource,
            AudioFormat: includeAudio ? AudioFormat : "none",
            MaxDurationMinutes: maxDurationMinutes,
            SegmentSizeMB: segmentSizeMB,
            FrameRate: frameRate,
            CancellationTokenSource: cts,
            AudioSession: audioSession);
        state.FrameCount = 1;

        state.FrameLoopTask = Task.Run(() => CaptureFramesLoopAsync(state, window, cts.Token), CancellationToken.None);

        lock (_sync)
        {
            _active = state;
        }

        return Result<RecordingStartResponse>.Success(new RecordingStartResponse(
            Ok: true,
            Status: "recording",
            StartedAt: now.ToString("O"),
            AudioEnabled: includeAudio,
            AudioFormat: includeAudio ? AudioFormat : "none"));
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

        state.CancellationTokenSource.Cancel();

        try
        {
            await state.FrameLoopTask.ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            state.LastError ??= ex.Message;
        }

        RecordingAudioStopResult? audioStopResult = null;
        if (state.AudioSession is not null)
        {
            var audioStop = await _audioCaptureService.StopAsync(cancellationToken);
            if (!audioStop.IsSuccess || audioStop.Value is null)
            {
                SafeDeleteDirectory(state.SessionDirectory);
                return Result<RecordingStopResponse>.Failure(audioStop.Error ?? new AgentError(
                    Code: "E_RECORDING_FAILED",
                    Message: "Failed to stop audio capture.",
                    TraceId: "trace_recording_audio_stop"));
            }

            audioStopResult = audioStop.Value;
        }

        var duration = DateTimeOffset.UtcNow - state.StartedAt;
        var encodeRequest = new RecordingEncodeRequest(
            FramesDirectory: state.FramesDirectory,
            AudioPath: state.AudioSession?.OutputPath,
            OutputDirectory: state.SessionDirectory,
            OutputBaseName: state.RecordingId,
            FrameRate: state.FrameRate,
            SegmentSizeMB: state.SegmentSizeMB,
            Duration: duration);

        var encodeResult = await _mediaEncoder.EncodeAsync(encodeRequest, cancellationToken);
        if (!encodeResult.IsSuccess || encodeResult.Value is null)
        {
            SafeDeleteDirectory(state.SessionDirectory);
            return Result<RecordingStopResponse>.Failure(encodeResult.Error ?? new AgentError(
                Code: "E_RECORDING_FAILED",
                Message: "Failed to encode recording.",
                TraceId: "trace_recording_encode"));
        }

        var outputPaths = encodeResult.Value.OutputPaths.ToArray();
        var primaryOutputPath = outputPaths.FirstOrDefault() ?? Path.Combine(state.SessionDirectory, $"{state.RecordingId}.mp4");
        var sizeBytes = encodeResult.Value.SizeBytes;
        var stoppedAt = DateTimeOffset.UtcNow;
        var manifest = new RecordingManifest(
            RecordingId: state.RecordingId,
            FileName: Path.GetFileName(primaryOutputPath),
            SizeBytes: sizeBytes,
            DurationSeconds: Math.Max(0.0, duration.TotalSeconds),
            AudioEnabled: state.IncludeAudio,
            AudioFormat: state.AudioFormat,
            ThumbnailFileName: state.ThumbnailFileName,
            OutputPaths: outputPaths,
            StartedAt: state.StartedAt.ToString("O"),
            StoppedAt: stoppedAt.ToString("O"),
            AudioSource: state.AudioSource,
            FrameRate: state.FrameRate,
            SegmentSizeMB: state.SegmentSizeMB,
            FrameCount: state.FrameCount,
            AudioSizeBytes: audioStopResult?.SizeBytes ?? 0,
            LastError: state.LastError);

        await WriteManifestAsync(state.SessionDirectory, manifest, cancellationToken);

        return Result<RecordingStopResponse>.Success(new RecordingStopResponse(
            Ok: true,
            Status: "stopped",
            FileName: Path.GetFileName(primaryOutputPath),
            SizeBytes: sizeBytes,
            DurationSeconds: manifest.DurationSeconds,
            OutputPaths: outputPaths,
            AudioEnabled: state.IncludeAudio,
            AudioFormat: state.AudioFormat));
    }

    private async Task CaptureFramesLoopAsync(
        RecordingState state,
        CodexWindowSnapshot window,
        CancellationToken cancellationToken)
    {
        var nextFrameIndex = 2;
        var delay = TimeSpan.FromMilliseconds(Math.Clamp(1000.0 / Math.Max(1, state.FrameRate), 15, 1000));
        var deadline = state.StartedAt.AddMinutes(state.MaxDurationMinutes);

        while (!cancellationToken.IsCancellationRequested)
        {
            if (DateTimeOffset.UtcNow >= deadline)
            {
                break;
            }

            var framePath = Path.Combine(state.FramesDirectory, $"frame_{nextFrameIndex:000000}.jpg");
            var result = await CaptureFrameAsync(window, null, framePath, cancellationToken);
            if (result.IsSuccess)
            {
                Interlocked.Increment(ref state.FrameCount);
                nextFrameIndex++;
            }

            try
            {
                await Task.Delay(delay, cancellationToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task<Result<bool>> CaptureFrameAsync(
        CodexWindowSnapshot window,
        string? thumbnailPath,
        string framePath,
        CancellationToken cancellationToken)
    {
        var capture = await _windowImageCapture.CaptureAsync(window, WindowImageFormat.Jpeg, cancellationToken);
        if (!capture.IsSuccess || capture.Value is null)
        {
            return Result<bool>.Failure(capture.Error ?? new AgentError(
                Code: "E_RECORDING_FAILED",
                Message: "Failed to capture recording frame.",
                TraceId: "trace_recording_frame"));
        }

        Directory.CreateDirectory(Path.GetDirectoryName(framePath) ?? _localPaths.Recordings);
        await File.WriteAllBytesAsync(framePath, capture.Value.Bytes, cancellationToken);
        if (!string.IsNullOrWhiteSpace(thumbnailPath))
        {
            await File.WriteAllBytesAsync(thumbnailPath, capture.Value.Bytes, cancellationToken);
        }

        return Result<bool>.Success(true);
    }

    private static string NormalizeAudioSource(string? audioSource)
    {
        if (string.IsNullOrWhiteSpace(audioSource))
        {
            return DefaultAudioSource;
        }

        return audioSource.Trim().ToLowerInvariant();
    }

    private static int ClampPositive(int? value, int defaultValue, int maxValue)
    {
        if (value is null || value <= 0)
        {
            return defaultValue;
        }

        return Math.Clamp(value.Value, 1, maxValue);
    }

    private async Task WriteManifestAsync(
        string sessionDirectory,
        RecordingManifest manifest,
        CancellationToken cancellationToken)
    {
        var manifestPath = Path.Combine(sessionDirectory, "metadata.json");
        var json = JsonSerializer.Serialize(manifest, JsonOptions);
        await File.WriteAllTextAsync(manifestPath, json, cancellationToken);
    }

    private void EnsureTimeoutUnlocked(DateTimeOffset now)
    {
        if (_active is null)
        {
            return;
        }

        if (_active.StartedAt.AddMinutes(_active.MaxDurationMinutes) <= now)
        {
            _active.CancellationTokenSource.Cancel();
            _active = null;
        }
    }

    private static void SafeDeleteDirectory(string directory)
    {
        try
        {
            if (Directory.Exists(directory))
            {
                Directory.Delete(directory, recursive: true);
            }
        }
        catch
        {
        }
    }

    private sealed class RecordingState
    {
        public RecordingState(
            string RecordingId,
            string SessionDirectory,
            string FramesDirectory,
            string ThumbnailFileName,
            DateTimeOffset StartedAt,
            bool IncludeAudio,
            string AudioSource,
            string AudioFormat,
            int MaxDurationMinutes,
            int SegmentSizeMB,
            int FrameRate,
            CancellationTokenSource CancellationTokenSource,
            RecordingAudioSession? AudioSession)
        {
            this.RecordingId = RecordingId;
            this.SessionDirectory = SessionDirectory;
            this.FramesDirectory = FramesDirectory;
            this.ThumbnailFileName = ThumbnailFileName;
            this.StartedAt = StartedAt;
            this.IncludeAudio = IncludeAudio;
            this.AudioSource = AudioSource;
            this.AudioFormat = AudioFormat;
            this.MaxDurationMinutes = MaxDurationMinutes;
            this.SegmentSizeMB = SegmentSizeMB;
            this.FrameRate = FrameRate;
            this.CancellationTokenSource = CancellationTokenSource;
            this.AudioSession = AudioSession;
        }

        public string RecordingId { get; }

        public string SessionDirectory { get; }

        public string FramesDirectory { get; }

        public string ThumbnailFileName { get; }

        public DateTimeOffset StartedAt { get; }

        public bool IncludeAudio { get; }

        public string AudioSource { get; }

        public string AudioFormat { get; }

        public int MaxDurationMinutes { get; }

        public int SegmentSizeMB { get; }

        public int FrameRate { get; }

        public CancellationTokenSource CancellationTokenSource { get; }

        public Task FrameLoopTask { get; set; } = Task.CompletedTask;

        public RecordingAudioSession? AudioSession { get; set; }

        public int FrameCount;

        public string? LastError { get; set; }
    }

    private sealed record RecordingManifest(
        string RecordingId,
        string FileName,
        long SizeBytes,
        double DurationSeconds,
        bool AudioEnabled,
        string AudioFormat,
        string? ThumbnailFileName,
        IReadOnlyList<string> OutputPaths,
        string StartedAt,
        string StoppedAt,
        string AudioSource,
        int FrameRate,
        int SegmentSizeMB,
        int FrameCount,
        long AudioSizeBytes,
        string? LastError);
}
