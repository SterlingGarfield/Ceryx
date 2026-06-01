using System.Text;
using Ceryx.Agent.Core;

namespace Ceryx.Agent.Codex.Clipboard;

public static class ClipboardPayloadTypes
{
    public const string Text = "text";
    public const string Image = "image";
}

public sealed record ClipboardWriteRequest(
    string Type,
    string Content,
    string MimeType
);

public sealed record ClipboardPayload(
    string Type,
    string Content,
    string MimeType,
    int SizeBytes
);

public interface IClipboardService
{
    Task<Result<ClipboardPayload>> SetAsync(
        ClipboardWriteRequest request,
        CancellationToken cancellationToken = default);

    Task<Result<ClipboardPayload>> GetAsync(CancellationToken cancellationToken = default);

    Task ClearAsync(CancellationToken cancellationToken = default);

    Task SetTextAsync(string text, CancellationToken cancellationToken = default);

    Task<string?> GetTextAsync(CancellationToken cancellationToken = default);
}

public sealed class MemoryClipboardService : IClipboardService
{
    private const int MaxPayloadBytes = 10 * 1024 * 1024;
    private ClipboardPayload? _payload;

    public Task<Result<ClipboardPayload>> SetAsync(
        ClipboardWriteRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var normalizedType = request.Type.Trim().ToLowerInvariant();
        if (normalizedType is not ClipboardPayloadTypes.Text and not ClipboardPayloadTypes.Image)
        {
            return Task.FromResult(Result<ClipboardPayload>.Failure(new AgentError(
                Code: "E_CLIPBOARD_INVALID_REQUEST",
                Message: "Clipboard type must be text or image.",
                TraceId: Guid.NewGuid().ToString("N"),
                Hint: "Use type=text for plain text or type=image for base64 image payload.")));
        }

        if (string.IsNullOrWhiteSpace(request.Content))
        {
            return Task.FromResult(Result<ClipboardPayload>.Failure(new AgentError(
                Code: "E_CLIPBOARD_INVALID_REQUEST",
                Message: "Clipboard content cannot be empty.",
                TraceId: Guid.NewGuid().ToString("N"),
                Hint: "Provide non-empty content.")));
        }

        var normalizedMimeType = string.IsNullOrWhiteSpace(request.MimeType)
            ? normalizedType == ClipboardPayloadTypes.Image ? "image/png" : "text/plain"
            : request.MimeType.Trim();

        int sizeBytes;
        if (normalizedType == ClipboardPayloadTypes.Image)
        {
            if (!TryDecodeBase64Payload(request.Content, out var bytes))
            {
                return Task.FromResult(Result<ClipboardPayload>.Failure(new AgentError(
                    Code: "E_CLIPBOARD_INVALID_REQUEST",
                    Message: "Image clipboard content must be valid base64.",
                    TraceId: Guid.NewGuid().ToString("N"),
                    Hint: "Send base64 image bytes or data URL payload.")));
            }

            sizeBytes = bytes.Length;
        }
        else
        {
            sizeBytes = Encoding.UTF8.GetByteCount(request.Content);
        }

        if (sizeBytes > MaxPayloadBytes)
        {
            return Task.FromResult(Result<ClipboardPayload>.Failure(new AgentError(
                Code: "E_CLIPBOARD_TOO_LARGE",
                Message: "Clipboard payload exceeds 10 MB limit.",
                TraceId: Guid.NewGuid().ToString("N"),
                Hint: "Reduce clipboard content size and retry.")));
        }

        _payload = new ClipboardPayload(
            Type: normalizedType,
            Content: request.Content,
            MimeType: normalizedMimeType,
            SizeBytes: sizeBytes);
        return Task.FromResult(Result<ClipboardPayload>.Success(_payload));
    }

    public Task<Result<ClipboardPayload>> GetAsync(CancellationToken cancellationToken = default)
    {
        if (_payload is null)
        {
            return Task.FromResult(Result<ClipboardPayload>.Failure(new AgentError(
                Code: "E_CLIPBOARD_EMPTY",
                Message: "Clipboard is empty.",
                TraceId: Guid.NewGuid().ToString("N"),
                Hint: "Send clipboard content first.")));
        }

        return Task.FromResult(Result<ClipboardPayload>.Success(_payload));
    }

    public Task ClearAsync(CancellationToken cancellationToken = default)
    {
        _payload = null;
        return Task.CompletedTask;
    }

    public Task SetTextAsync(string text, CancellationToken cancellationToken = default)
    {
        _payload = new ClipboardPayload(
            Type: ClipboardPayloadTypes.Text,
            Content: text,
            MimeType: "text/plain",
            SizeBytes: Encoding.UTF8.GetByteCount(text));
        return Task.CompletedTask;
    }

    public Task<string?> GetTextAsync(CancellationToken cancellationToken = default)
    {
        return Task.FromResult(_payload?.Type == ClipboardPayloadTypes.Text ? _payload.Content : null);
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
}
