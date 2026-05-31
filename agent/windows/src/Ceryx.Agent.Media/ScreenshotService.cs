using Ceryx.Agent.Codex.WindowLocator;
using Ceryx.Agent.Core;
using Ceryx.Agent.Storage;

namespace Ceryx.Agent.Media;

public sealed class ScreenshotService : IScreenshotService
{
    private readonly LocalPaths _localPaths;
    private readonly IWindowImageCapture _windowImageCapture;

    public ScreenshotService(LocalPaths localPaths, IWindowImageCapture windowImageCapture)
    {
        _localPaths = localPaths ?? throw new ArgumentNullException(nameof(localPaths));
        _windowImageCapture = windowImageCapture ?? throw new ArgumentNullException(nameof(windowImageCapture));
    }

    public async Task<Result<ScreenshotResponse>> CaptureAsync(
        CodexWindowSnapshot window,
        CancellationToken cancellationToken = default)
    {
        var capture = await _windowImageCapture.CaptureAsync(window, WindowImageFormat.Png, cancellationToken);
        if (!capture.IsSuccess || capture.Value is null)
        {
            return Result<ScreenshotResponse>.Failure(capture.Error ?? new AgentError(
                Code: "E_CAPTURE_FAILED",
                Message: "Failed to capture screenshot.",
                TraceId: "trace_screenshot_window"));
        }

        var fileName = $"screenshot_{DateTimeOffset.UtcNow:yyyyMMdd_HHmmss_fff}.png";
        var absolutePath = Path.Combine(_localPaths.Screenshots, fileName);
        await File.WriteAllBytesAsync(absolutePath, capture.Value.Bytes, cancellationToken);

        return Result<ScreenshotResponse>.Success(new ScreenshotResponse(
            Ok: true,
            FileName: fileName,
            SizeBytes: capture.Value.Bytes.LongLength));
    }
}
