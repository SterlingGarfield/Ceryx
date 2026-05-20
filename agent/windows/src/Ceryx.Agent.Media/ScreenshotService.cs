using Ceryx.Agent.Codex.WindowLocator;
using Ceryx.Agent.Core;
using Ceryx.Agent.Storage;

namespace Ceryx.Agent.Media;

public sealed class ScreenshotService : IScreenshotService
{
    private static readonly byte[] PngPlaceholder =
    [
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
        0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
        0x54, 0x08, 0x99, 0x63, 0x60, 0x60, 0x60, 0x00,
        0x00, 0x00, 0x04, 0x00, 0x01, 0xF6, 0x17, 0x38,
        0x55, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
        0x44, 0xAE, 0x42, 0x60, 0x82
    ];

    private readonly LocalPaths _localPaths;

    public ScreenshotService(LocalPaths localPaths)
    {
        _localPaths = localPaths ?? throw new ArgumentNullException(nameof(localPaths));
    }

    public async Task<Result<ScreenshotResponse>> CaptureAsync(
        CodexWindowSnapshot window,
        CancellationToken cancellationToken = default)
    {
        if (window.WindowId is null || window.Status is "not_found" or "multiple_candidates" or "permission_issue")
        {
            return Result<ScreenshotResponse>.Failure(new AgentError(
                Code: "E_CODEX_NOT_FOUND",
                Message: "Codex window is unavailable.",
                TraceId: "trace_screenshot_window"));
        }

        var fileName = $"screenshot_{DateTimeOffset.UtcNow:yyyyMMdd_HHmmss_fff}.png";
        var absolutePath = Path.Combine(_localPaths.Screenshots, fileName);
        await File.WriteAllBytesAsync(absolutePath, PngPlaceholder, cancellationToken);

        return Result<ScreenshotResponse>.Success(new ScreenshotResponse(
            Ok: true,
            FileName: fileName,
            SizeBytes: PngPlaceholder.Length));
    }
}
