using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using Ceryx.Agent.Core;

namespace Ceryx.Agent.Codex.Clipboard;

public sealed record ClipboardImageData(byte[] Bytes, string MimeType);

public interface IClipboardBackend
{
    void Clear();

    void SetText(string text);

    string? GetText();

    void SetImage(byte[] imageBytes, string mimeType);

    ClipboardImageData? GetImage();
}

public sealed class ClipboardBackendException : Exception
{
    public ClipboardBackendException(string message)
        : base(message)
    {
    }

    public ClipboardBackendException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}

public sealed class WindowsClipboardService : IClipboardService
{
    private const int MaxPayloadBytes = 10 * 1024 * 1024;
    private readonly IClipboardBackend _backend;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public WindowsClipboardService()
        : this(new Win32ClipboardBackend())
    {
    }

    public WindowsClipboardService(IClipboardBackend backend)
    {
        _backend = backend ?? throw new ArgumentNullException(nameof(backend));
    }

    public async Task<Result<ClipboardPayload>> SetAsync(
        ClipboardWriteRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        cancellationToken.ThrowIfCancellationRequested();

        var normalizedType = NormalizeClipboardType(request.Type);
        if (normalizedType is null)
        {
            return Result<ClipboardPayload>.Failure(CreateInvalidRequestError(
                "Clipboard type must be text or image.",
                "Use type=text for plain text or type=image for base64 image payload."));
        }

        if (string.IsNullOrWhiteSpace(request.Content))
        {
            return Result<ClipboardPayload>.Failure(CreateInvalidRequestError(
                "Clipboard content cannot be empty.",
                "Provide non-empty content."));
        }

        var normalizedMimeType = NormalizeMimeType(normalizedType, request.MimeType);
        if (normalizedType == ClipboardPayloadTypes.Text)
        {
            var sizeBytes = Encoding.UTF8.GetByteCount(request.Content);
            if (sizeBytes > MaxPayloadBytes)
            {
                return Result<ClipboardPayload>.Failure(CreatePayloadTooLargeError());
            }

            await _gate.WaitAsync(cancellationToken);
            try
            {
                _backend.SetText(request.Content);
                return Result<ClipboardPayload>.Success(new ClipboardPayload(
                    Type: ClipboardPayloadTypes.Text,
                    Content: request.Content,
                    MimeType: normalizedMimeType,
                    SizeBytes: sizeBytes));
            }
            catch (ClipboardBackendException ex)
            {
                return Result<ClipboardPayload>.Failure(CreateUnavailableError(ex.Message));
            }
            finally
            {
                _gate.Release();
            }
        }

        if (!TryDecodeBase64Payload(request.Content, out var bytes))
        {
            return Result<ClipboardPayload>.Failure(CreateInvalidRequestError(
                "Image clipboard content must be valid base64.",
                "Send base64 image bytes or a data URL payload."));
        }

        if (bytes.Length > MaxPayloadBytes)
        {
            return Result<ClipboardPayload>.Failure(CreatePayloadTooLargeError());
        }

        try
        {
            using var stream = new MemoryStream(bytes);
            using var _ = Image.FromStream(stream);
        }
        catch (ArgumentException)
        {
            return Result<ClipboardPayload>.Failure(CreateInvalidRequestError(
                "Image clipboard content must be a valid image.",
                "Send PNG, JPEG, or BMP bytes encoded as base64."));
        }
        catch (OutOfMemoryException)
        {
            return Result<ClipboardPayload>.Failure(CreateInvalidRequestError(
                "Image clipboard content must be a valid image.",
                "Send PNG, JPEG, or BMP bytes encoded as base64."));
        }
        catch (ExternalException)
        {
            return Result<ClipboardPayload>.Failure(CreateInvalidRequestError(
                "Image clipboard content must be a valid image.",
                "Send PNG, JPEG, or BMP bytes encoded as base64."));
        }

        await _gate.WaitAsync(cancellationToken);
        try
        {
            _backend.SetImage(bytes, normalizedMimeType);
            return Result<ClipboardPayload>.Success(new ClipboardPayload(
                Type: ClipboardPayloadTypes.Image,
                Content: request.Content,
                MimeType: normalizedMimeType,
                SizeBytes: bytes.Length));
        }
        catch (ClipboardBackendException ex)
        {
            return Result<ClipboardPayload>.Failure(CreateUnavailableError(ex.Message));
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<Result<ClipboardPayload>> GetAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        await _gate.WaitAsync(cancellationToken);
        try
        {
            var text = _backend.GetText();
            if (text is not null)
            {
                return Result<ClipboardPayload>.Success(new ClipboardPayload(
                    Type: ClipboardPayloadTypes.Text,
                    Content: text,
                    MimeType: "text/plain",
                    SizeBytes: Encoding.UTF8.GetByteCount(text)));
            }

            var image = _backend.GetImage();
            if (image is not null)
            {
                var mimeType = NormalizeMimeType(ClipboardPayloadTypes.Image, image.MimeType);
                return Result<ClipboardPayload>.Success(new ClipboardPayload(
                    Type: ClipboardPayloadTypes.Image,
                    Content: Convert.ToBase64String(image.Bytes),
                    MimeType: mimeType,
                    SizeBytes: image.Bytes.Length));
            }

            return Result<ClipboardPayload>.Failure(CreateEmptyError());
        }
        catch (ClipboardBackendException ex)
        {
            return Result<ClipboardPayload>.Failure(CreateUnavailableError(ex.Message));
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task ClearAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        await _gate.WaitAsync(cancellationToken);
        try
        {
            _backend.Clear();
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task SetTextAsync(string text, CancellationToken cancellationToken = default)
    {
        var result = await SetAsync(
            new ClipboardWriteRequest(
                Type: ClipboardPayloadTypes.Text,
                Content: text,
                MimeType: "text/plain"),
            cancellationToken);

        if (!result.IsSuccess)
        {
            throw new ClipboardBackendException(result.Error?.Message ?? "Failed to write clipboard text.");
        }
    }

    public async Task<string?> GetTextAsync(CancellationToken cancellationToken = default)
    {
        var result = await GetAsync(cancellationToken);
        return result.IsSuccess && result.Value?.Type == ClipboardPayloadTypes.Text
            ? result.Value.Content
            : null;
    }

    private static string? NormalizeClipboardType(string type)
    {
        var normalized = type.Trim().ToLowerInvariant();
        return normalized is ClipboardPayloadTypes.Text or ClipboardPayloadTypes.Image
            ? normalized
            : null;
    }

    private static string NormalizeMimeType(string normalizedType, string? mimeType)
    {
        return string.IsNullOrWhiteSpace(mimeType)
            ? normalizedType == ClipboardPayloadTypes.Image ? "image/png" : "text/plain"
            : mimeType.Trim();
    }

    private static bool TryDecodeBase64Payload(string content, out byte[] bytes)
    {
        var payload = content.Trim();
        var markerIndex = payload.IndexOf("base64,", StringComparison.OrdinalIgnoreCase);
        if (markerIndex >= 0)
        {
            payload = payload[(markerIndex + "base64,".Length)..];
        }

        try
        {
            bytes = Convert.FromBase64String(payload);
            return true;
        }
        catch (FormatException)
        {
            bytes = [];
            return false;
        }
    }

    private static AgentError CreateInvalidRequestError(string message, string hint)
    {
        return new AgentError(
            Code: "E_CLIPBOARD_INVALID_REQUEST",
            Message: message,
            TraceId: Guid.NewGuid().ToString("N"),
            Hint: hint);
    }

    private static AgentError CreatePayloadTooLargeError()
    {
        return new AgentError(
            Code: "E_CLIPBOARD_TOO_LARGE",
            Message: "Clipboard payload exceeds 10 MB limit.",
            TraceId: Guid.NewGuid().ToString("N"),
            Hint: "Reduce clipboard content size and retry.");
    }

    private static AgentError CreateEmptyError()
    {
        return new AgentError(
            Code: "E_CLIPBOARD_EMPTY",
            Message: "Clipboard is empty.",
            TraceId: Guid.NewGuid().ToString("N"),
            Hint: "Send clipboard content first.");
    }

    private static AgentError CreateUnavailableError(string message)
    {
        return new AgentError(
            Code: "E_CLIPBOARD_UNAVAILABLE",
            Message: message,
            TraceId: Guid.NewGuid().ToString("N"),
            Hint: "Try again once the clipboard is available.");
    }
}
