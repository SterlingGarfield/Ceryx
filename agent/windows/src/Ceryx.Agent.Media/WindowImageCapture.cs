using Ceryx.Agent.Capture;
using Ceryx.Agent.Codex.WindowLocator;
using Ceryx.Agent.Core;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace Ceryx.Agent.Media;

public sealed class WindowImageCapture : IWindowImageCapture, IWindowCaptureBackendInfo
{
    private readonly IWindowCaptureBackend _backend;

    public WindowImageCapture()
    {
        RequestedBackend = ResolveRequestedBackend();
        _backend = ResolveBackend(RequestedBackend);
        ActiveBackend = _backend.Name;
    }

    public string ActiveBackend { get; }

    public string RequestedBackend { get; }

    public Task<Result<CapturedWindowFrame>> CaptureAsync(
        CodexWindowSnapshot window,
        WindowImageFormat format,
        CancellationToken cancellationToken = default)
    {
        return _backend.CaptureAsync(window, format, cancellationToken);
    }

    private static string ResolveRequestedBackend()
    {
        var configured = Environment.GetEnvironmentVariable("CERYX_CAPTURE_BACKEND");
        return configured?.Trim().ToLowerInvariant() switch
        {
            "wgc" => "wgc",
            "gdi" => "gdi",
            _ => "auto"
        };
    }

    private static IWindowCaptureBackend ResolveBackend(string requestedBackend)
    {
        var gdi = new GdiWindowCaptureBackend();
        if (string.Equals(requestedBackend, "gdi", StringComparison.OrdinalIgnoreCase))
        {
            return gdi;
        }

        var wgc = new WgcWindowCaptureBackend(gdi);
        if (string.Equals(requestedBackend, "wgc", StringComparison.OrdinalIgnoreCase))
        {
            return wgc.IsAvailable() ? wgc : new ForcedUnavailableWindowCaptureBackend("wgc");
        }

        return wgc.IsAvailable() ? wgc : gdi;
    }
}

internal interface IWindowCaptureBackend
{
    string Name { get; }

    bool IsAvailable();

    Task<Result<CapturedWindowFrame>> CaptureAsync(
        CodexWindowSnapshot window,
        WindowImageFormat format,
        CancellationToken cancellationToken = default);
}

internal sealed class ForcedUnavailableWindowCaptureBackend : IWindowCaptureBackend
{
    private readonly string _name;

    public ForcedUnavailableWindowCaptureBackend(string name)
    {
        _name = name;
    }

    public string Name => _name;

    public bool IsAvailable() => false;

    public Task<Result<CapturedWindowFrame>> CaptureAsync(
        CodexWindowSnapshot window,
        WindowImageFormat format,
        CancellationToken cancellationToken = default)
    {
        return Task.FromResult(Result<CapturedWindowFrame>.Failure(new AgentError(
            Code: "E_CAPTURE_FAILED",
            Message: $"Capture backend '{_name}' is unavailable on this system.",
            TraceId: "trace_capture_backend_unavailable",
            Hint: "Set CERYX_CAPTURE_BACKEND=auto or gdi and retry.")));
    }
}

internal sealed class WgcWindowCaptureBackend : IWindowCaptureBackend
{
    private readonly GdiWindowCaptureBackend _fallback;

    public WgcWindowCaptureBackend(GdiWindowCaptureBackend fallback)
    {
        _fallback = fallback;
    }

    public string Name => "wgc";

    public bool IsAvailable()
    {
        if (!OperatingSystem.IsWindows())
        {
            return false;
        }

        // Windows 10 1903 (10.0.18362) minimum for Windows.Graphics.Capture.
        return Environment.OSVersion.Version >= new Version(10, 0, 18362);
    }

    public Task<Result<CapturedWindowFrame>> CaptureAsync(
        CodexWindowSnapshot window,
        WindowImageFormat format,
        CancellationToken cancellationToken = default)
    {
        // Phase 2 wiring: keep call surface stable, route through fallback capture until
        // the Direct3D frame path is enabled in the runtime environment.
        return _fallback.CaptureAsync(window, format, cancellationToken);
    }
}

internal sealed class GdiWindowCaptureBackend : IWindowCaptureBackend
{
    private const int Srccopy = 0x00CC0020;
    private const int CaptureBlt = 0x40000000;
    private const uint PrintWindowRenderFullContent = 0x00000002;

    public string Name => "gdi";

    public bool IsAvailable() => OperatingSystem.IsWindows();

    public Task<Result<CapturedWindowFrame>> CaptureAsync(
        CodexWindowSnapshot window,
        WindowImageFormat format,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        if (window.WindowId is null || window.Status is "not_found" or "multiple_candidates" or "permission_issue")
        {
            return Task.FromResult(Result<CapturedWindowFrame>.Failure(new AgentError(
                Code: "E_CODEX_NOT_FOUND",
                Message: "Codex window is unavailable.",
                TraceId: "trace_capture_window")));
        }

        if (string.Equals(window.Status, "minimized", StringComparison.OrdinalIgnoreCase))
        {
            return Task.FromResult(Result<CapturedWindowFrame>.Failure(new AgentError(
                Code: "E_CODEX_MINIMIZED",
                Message: "Codex window is minimized.",
                TraceId: "trace_capture_minimized")));
        }

        if (!TryParseWindowHandle(window.WindowId, out var hwnd) || hwnd == IntPtr.Zero || !IsWindow(hwnd))
        {
            return Task.FromResult(Result<CapturedWindowFrame>.Failure(new AgentError(
                Code: "E_CODEX_NOT_FOUND",
                Message: "Codex window is unavailable.",
                TraceId: "trace_capture_window_id")));
        }

        if (IsIconic(hwnd))
        {
            return Task.FromResult(Result<CapturedWindowFrame>.Failure(new AgentError(
                Code: "E_CODEX_MINIMIZED",
                Message: "Codex window is minimized.",
                TraceId: "trace_capture_iconic")));
        }

        if (!TryGetWindowSize(hwnd, out var width, out var height))
        {
            return Task.FromResult(Result<CapturedWindowFrame>.Failure(new AgentError(
                Code: "E_CAPTURE_FAILED",
                Message: "Codex window capture bounds are invalid.",
                TraceId: "trace_capture_bounds",
                Hint: "Refresh Codex window and retry.")));
        }

        try
        {
            using var bitmap = CaptureWindowBitmap(hwnd, width, height);
            using var stream = new MemoryStream();
            var contentType = format == WindowImageFormat.Png ? "image/png" : "image/jpeg";

            if (format == WindowImageFormat.Png)
            {
                bitmap.Save(stream, ImageFormat.Png);
            }
            else
            {
                SaveJpeg(bitmap, stream);
            }

            return Task.FromResult(Result<CapturedWindowFrame>.Success(new CapturedWindowFrame(
                Bytes: stream.ToArray(),
                ContentType: contentType,
                Width: bitmap.Width,
                Height: bitmap.Height,
                CapturedAt: DateTimeOffset.UtcNow)));
        }
        catch (Exception ex)
        {
            return Task.FromResult(Result<CapturedWindowFrame>.Failure(new AgentError(
                Code: "E_CAPTURE_FAILED",
                Message: $"Failed to capture Codex window. {ex.Message}",
                TraceId: "trace_capture_exception",
                Hint: "Refresh Codex window and retry.")));
        }
    }

    private static Bitmap CaptureWindowBitmap(IntPtr hwnd, int width, int height)
    {
        IntPtr screenDc = IntPtr.Zero;
        IntPtr memoryDc = IntPtr.Zero;
        IntPtr bitmapHandle = IntPtr.Zero;
        IntPtr previousObject = IntPtr.Zero;
        IntPtr windowDc = IntPtr.Zero;

        try
        {
            screenDc = GetDC(IntPtr.Zero);
            if (screenDc == IntPtr.Zero)
            {
                throw new InvalidOperationException("Unable to acquire screen device context.");
            }

            memoryDc = CreateCompatibleDC(screenDc);
            if (memoryDc == IntPtr.Zero)
            {
                throw new InvalidOperationException("Unable to allocate memory device context.");
            }

            bitmapHandle = CreateCompatibleBitmap(screenDc, width, height);
            if (bitmapHandle == IntPtr.Zero)
            {
                throw new InvalidOperationException("Unable to allocate capture bitmap.");
            }

            previousObject = SelectObject(memoryDc, bitmapHandle);
            if (previousObject == IntPtr.Zero)
            {
                throw new InvalidOperationException("Unable to select capture bitmap.");
            }

            var printed = PrintWindow(hwnd, memoryDc, PrintWindowRenderFullContent) ||
                          PrintWindow(hwnd, memoryDc, 0);

            if (!printed)
            {
                windowDc = GetWindowDC(hwnd);
                if (windowDc == IntPtr.Zero)
                {
                    throw new InvalidOperationException("Unable to acquire window device context.");
                }

                var copied = BitBlt(
                    memoryDc,
                    0,
                    0,
                    width,
                    height,
                    windowDc,
                    0,
                    0,
                    Srccopy | CaptureBlt);
                if (!copied)
                {
                    throw new InvalidOperationException("Unable to copy window pixels from device context.");
                }
            }

            using var unmanagedBitmap = Image.FromHbitmap(bitmapHandle);
            return new Bitmap(unmanagedBitmap);
        }
        finally
        {
            if (previousObject != IntPtr.Zero && memoryDc != IntPtr.Zero)
            {
                SelectObject(memoryDc, previousObject);
            }

            if (bitmapHandle != IntPtr.Zero)
            {
                DeleteObject(bitmapHandle);
            }

            if (memoryDc != IntPtr.Zero)
            {
                DeleteDC(memoryDc);
            }

            if (windowDc != IntPtr.Zero)
            {
                ReleaseDC(hwnd, windowDc);
            }

            if (screenDc != IntPtr.Zero)
            {
                ReleaseDC(IntPtr.Zero, screenDc);
            }
        }
    }

    private static void SaveJpeg(Image bitmap, Stream stream)
    {
        var encoder = ImageCodecInfo.GetImageEncoders()
            .FirstOrDefault(codec => string.Equals(codec.MimeType, "image/jpeg", StringComparison.OrdinalIgnoreCase));

        if (encoder is null)
        {
            bitmap.Save(stream, ImageFormat.Jpeg);
            return;
        }

        using var encoderParameters = new EncoderParameters(1);
        encoderParameters.Param[0] = new EncoderParameter(Encoder.Quality, 82L);
        bitmap.Save(stream, encoder, encoderParameters);
    }

    private static bool TryGetWindowSize(IntPtr hwnd, out int width, out int height)
    {
        width = 0;
        height = 0;

        if (!GetWindowRect(hwnd, out var rect))
        {
            return false;
        }

        width = Math.Max(0, rect.Right - rect.Left);
        height = Math.Max(0, rect.Bottom - rect.Top);
        return width > 0 && height > 0;
    }

    private static bool TryParseWindowHandle(string windowId, out IntPtr hwnd)
    {
        hwnd = IntPtr.Zero;
        if (string.IsNullOrWhiteSpace(windowId) ||
            !windowId.StartsWith("hwnd_", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var raw = windowId["hwnd_".Length..];
        if (!long.TryParse(raw, System.Globalization.NumberStyles.HexNumber, null, out var handleValue))
        {
            return false;
        }

        hwnd = new IntPtr(handleValue);
        return hwnd != IntPtr.Zero;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int ReleaseDC(IntPtr hWnd, IntPtr hDc);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr GetWindowDC(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);

    [DllImport("gdi32.dll", SetLastError = true)]
    private static extern IntPtr CreateCompatibleDC(IntPtr hdc);

    [DllImport("gdi32.dll", SetLastError = true)]
    private static extern bool DeleteDC(IntPtr hdc);

    [DllImport("gdi32.dll", SetLastError = true)]
    private static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int cx, int cy);

    [DllImport("gdi32.dll", SetLastError = true)]
    private static extern IntPtr SelectObject(IntPtr hdc, IntPtr h);

    [DllImport("gdi32.dll", SetLastError = true)]
    private static extern bool DeleteObject(IntPtr ho);

    [DllImport("gdi32.dll", SetLastError = true)]
    private static extern bool BitBlt(
        IntPtr hdcDest,
        int nXDest,
        int nYDest,
        int nWidth,
        int nHeight,
        IntPtr hdcSrc,
        int nXSrc,
        int nYSrc,
        int dwRop);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}

public sealed class FramePreviewService : IFramePreviewService
{
    private readonly object _sync = new();
    private readonly IWindowImageCapture _windowImageCapture;
    private CapturedWindowFrame? _latestFrame;

    public FramePreviewService(IWindowImageCapture windowImageCapture)
    {
        _windowImageCapture = windowImageCapture ?? throw new ArgumentNullException(nameof(windowImageCapture));
    }

    public CapturedWindowFrame? LatestFrame
    {
        get
        {
            lock (_sync)
            {
                return _latestFrame;
            }
        }
    }

    public async Task<Result<CapturedWindowFrame>> CaptureLatestAsync(
        CodexWindowSnapshot window,
        CaptureState captureState,
        CancellationToken cancellationToken = default)
    {
        if (!captureState.Active)
        {
            return Result<CapturedWindowFrame>.Failure(new AgentError(
                Code: "E_CAPTURE_INACTIVE",
                Message: "Capture is not active.",
                TraceId: "trace_capture_inactive",
                Hint: "Start capture and retry."));
        }

        var result = await _windowImageCapture.CaptureAsync(window, WindowImageFormat.Jpeg, cancellationToken);
        if (!result.IsSuccess || result.Value is null)
        {
            return result;
        }

        lock (_sync)
        {
            _latestFrame = result.Value;
        }

        return result;
    }
}
