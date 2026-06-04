using Ceryx.Agent.Capture;
using Ceryx.Agent.Codex.WindowLocator;
using Ceryx.Agent.Core;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace Ceryx.Agent.Media;

public sealed class WindowWebRtcFrameSource : IWebRtcFrameSource
{
    private readonly ICodexWindowLocator _windowLocator;
    private readonly ICaptureLifecycleService _captureLifecycleService;
    private readonly IWindowImageCapture _windowImageCapture;

    public WindowWebRtcFrameSource(
        ICodexWindowLocator windowLocator,
        ICaptureLifecycleService captureLifecycleService,
        IWindowImageCapture windowImageCapture)
    {
        _windowLocator = windowLocator ?? throw new ArgumentNullException(nameof(windowLocator));
        _captureLifecycleService = captureLifecycleService ?? throw new ArgumentNullException(nameof(captureLifecycleService));
        _windowImageCapture = windowImageCapture ?? throw new ArgumentNullException(nameof(windowImageCapture));
    }

    public async Task<Result<WebRtcVideoFrame>> GetFrameAsync(CancellationToken cancellationToken = default)
    {
        var captureState = _captureLifecycleService.CurrentState;
        if (!captureState.Active)
        {
            return Result<WebRtcVideoFrame>.Failure(new AgentError(
                Code: "E_CAPTURE_INACTIVE",
                Message: "Capture is not active.",
                TraceId: "trace_webrtc_frame_capture_inactive",
                Hint: "Start capture and retry."));
        }

        var window = await _windowLocator.GetWindowAsync(cancellationToken);
        var capture = await _windowImageCapture.CaptureAsync(window, WindowImageFormat.Jpeg, cancellationToken);
        if (!capture.IsSuccess || capture.Value is null)
        {
            return Result<WebRtcVideoFrame>.Failure(capture.Error ?? new AgentError(
                Code: "E_CAPTURE_FAILED",
                Message: "Failed to capture frame for WebRTC.",
                TraceId: "trace_webrtc_frame_capture_failed"));
        }

        try
        {
            var bgr24 = DecodeToBgr24(capture.Value.Bytes, out var width, out var height);
            return Result<WebRtcVideoFrame>.Success(new WebRtcVideoFrame(
                Bgr24Bytes: bgr24,
                Width: width,
                Height: height,
                DurationMilliseconds: ResolveFrameDuration(captureState.FrameRate),
                CapturedAt: capture.Value.CapturedAt));
        }
        catch (Exception ex)
        {
            return Result<WebRtcVideoFrame>.Failure(new AgentError(
                Code: "E_CAPTURE_FAILED",
                Message: $"Failed to convert captured frame for WebRTC. {ex.Message}",
                TraceId: "trace_webrtc_frame_convert_failed",
                Hint: "Retry capture with the Codex window visible."));
        }
    }

    private static uint ResolveFrameDuration(int frameRate)
    {
        var normalizedFrameRate = Math.Max(1, frameRate);
        return (uint)Math.Clamp(1000 / normalizedFrameRate, 1, 1000);
    }

    private static byte[] DecodeToBgr24(byte[] encodedBytes, out int width, out int height)
    {
        using var stream = new MemoryStream(encodedBytes);
        using var source = new Bitmap(stream);
        width = source.Width;
        height = source.Height;

        using var rgb24 = source.PixelFormat == PixelFormat.Format24bppRgb
            ? (Bitmap)source.Clone()
            : source.Clone(new Rectangle(0, 0, width, height), PixelFormat.Format24bppRgb);

        var rect = new Rectangle(0, 0, width, height);
        var bitmapData = rgb24.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
        try
        {
            var rowBytes = width * 3;
            var payload = new byte[rowBytes * height];
            for (var row = 0; row < height; row++)
            {
                var sourceIndex = bitmapData.Stride > 0 ? row : (height - 1 - row);
                var sourcePtr = IntPtr.Add(bitmapData.Scan0, sourceIndex * bitmapData.Stride);
                Marshal.Copy(sourcePtr, payload, row * rowBytes, rowBytes);
            }

            return payload;
        }
        finally
        {
            rgb24.UnlockBits(bitmapData);
        }
    }
}
