using Ceryx.Agent.Codex.WindowLocator;
using Ceryx.Agent.Core;

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

public interface IRecordingService
{
    Task<Result<RecordingStartResponse>> StartAsync(
        CodexWindowSnapshot window,
        CancellationToken cancellationToken = default);

    Task<Result<RecordingStopResponse>> StopAsync(CancellationToken cancellationToken = default);
}
