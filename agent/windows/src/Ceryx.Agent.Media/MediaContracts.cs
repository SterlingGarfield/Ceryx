using Ceryx.Agent.Codex.WindowLocator;
using Ceryx.Agent.Core;
using Ceryx.Agent.Capture;

namespace Ceryx.Agent.Media;

public interface IDiskSpaceProvider
{
    long GetAvailableBytes(string absolutePath);
}

public sealed class DriveDiskSpaceProvider : IDiskSpaceProvider
{
    public long GetAvailableBytes(string absolutePath)
    {
        var root = Path.GetPathRoot(Path.GetFullPath(absolutePath));
        if (string.IsNullOrWhiteSpace(root))
        {
            return long.MaxValue;
        }

        var drive = new DriveInfo(root);
        return drive.AvailableFreeSpace;
    }
}

public interface IUploadImageService
{
    Task<Result<UploadImageResponse>> UploadImageAsync(
        string fileName,
        Stream content,
        CancellationToken cancellationToken = default);
}

public interface IScreenshotService
{
    Task<Result<ScreenshotResponse>> CaptureAsync(
        CodexWindowSnapshot window,
        CancellationToken cancellationToken = default);
}

public enum WindowImageFormat
{
    Jpeg,
    Png
}

public sealed record CapturedWindowFrame(
    byte[] Bytes,
    string ContentType,
    int Width,
    int Height,
    DateTimeOffset CapturedAt
);

public interface IWindowCaptureBackendInfo
{
    string ActiveBackend { get; }

    string RequestedBackend { get; }
}

public interface IWindowImageCapture
{
    Task<Result<CapturedWindowFrame>> CaptureAsync(
        CodexWindowSnapshot window,
        WindowImageFormat format,
        CancellationToken cancellationToken = default);
}

public interface IFramePreviewService
{
    CapturedWindowFrame? LatestFrame { get; }

    Task<Result<CapturedWindowFrame>> CaptureLatestAsync(
        CodexWindowSnapshot window,
        CaptureState captureState,
        CancellationToken cancellationToken = default);
}

public interface IRecordingService
{
    bool IsActive { get; }

    bool IsAudioActive { get; }

    Task<Result<RecordingStartResponse>> StartAsync(
        CodexWindowSnapshot window,
        RecordingStartBody? request = null,
        CancellationToken cancellationToken = default);

    Task<Result<RecordingStopResponse>> StopAsync(CancellationToken cancellationToken = default);
}

public sealed record RecordingAudioSession(
    string OutputPath,
    string AudioFormat,
    DateTimeOffset StartedAt
);

public sealed record RecordingAudioStopResult(
    string OutputPath,
    long SizeBytes,
    DateTimeOffset StartedAt,
    DateTimeOffset StoppedAt,
    string AudioFormat
);

public interface IAudioCaptureService
{
    bool IsActive { get; }

    Task<Result<RecordingAudioSession>> StartAsync(
        string outputPath,
        CancellationToken cancellationToken = default);

    Task<Result<RecordingAudioStopResult>> StopAsync(
        CancellationToken cancellationToken = default);
}

public sealed record RecordingEncodeRequest(
    string FramesDirectory,
    string? AudioPath,
    string OutputDirectory,
    string OutputBaseName,
    int FrameRate,
    int SegmentSizeMB,
    TimeSpan Duration
);

public sealed record RecordingEncodeResult(
    IReadOnlyList<string> OutputPaths,
    long SizeBytes
);

public interface IRecordingMediaEncoder
{
    Task<Result<RecordingEncodeResult>> EncodeAsync(
        RecordingEncodeRequest request,
        CancellationToken cancellationToken = default);
}

public sealed record RecordingCatalogEntry(
    string RecordingId,
    string FileName,
    long SizeBytes,
    double DurationSeconds,
    bool AudioEnabled,
    string AudioFormat,
    string? ThumbnailFileName,
    IReadOnlyList<string> OutputPaths,
    string StartedAt,
    string StoppedAt
);

public interface IRecordingCatalogService
{
    Task<Result<IReadOnlyList<RecordingCatalogEntry>>> ListAsync(
        int limit,
        CancellationToken cancellationToken = default);

    Task<Result<RecordingCatalogEntry>> GetByFileNameAsync(
        string fileName,
        CancellationToken cancellationToken = default);

    Task<Result<Stream>> OpenFileAsync(
        string fileName,
        CancellationToken cancellationToken = default);
}
