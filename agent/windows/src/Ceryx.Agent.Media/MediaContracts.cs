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
    Task<Result<RecordingStartResponse>> StartAsync(
        CodexWindowSnapshot window,
        CancellationToken cancellationToken = default);

    Task<Result<RecordingStopResponse>> StopAsync(CancellationToken cancellationToken = default);
}
