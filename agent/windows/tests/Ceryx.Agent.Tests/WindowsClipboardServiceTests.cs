using Ceryx.Agent.Codex.Clipboard;
using Ceryx.Agent.Core;
using Xunit;

namespace Ceryx.Agent.Tests;

public sealed class WindowsClipboardServiceTests
{
    [Fact]
    public async Task SetAndGetTextPayloadRoundTripsThroughBackend()
    {
        var backend = new FakeClipboardBackend();
        var service = new WindowsClipboardService(backend);

        var send = await service.SetAsync(new ClipboardWriteRequest(
            Type: "text",
            Content: "sync me",
            MimeType: "text/plain"));

        Assert.True(send.IsSuccess);
        Assert.Equal("text", send.Value?.Type);
        Assert.Equal("text/plain", send.Value?.MimeType);
        Assert.Equal(7, send.Value?.SizeBytes);
        Assert.Equal("sync me", backend.Text);

        var receive = await service.GetAsync();

        Assert.True(receive.IsSuccess);
        Assert.Equal("text", receive.Value?.Type);
        Assert.Equal("sync me", receive.Value?.Content);
        Assert.Equal("text/plain", receive.Value?.MimeType);
        Assert.Equal(7, receive.Value?.SizeBytes);
    }

    [Fact]
    public async Task SetAndGetImagePayloadRoundTripsThroughBackend()
    {
        var backend = new FakeClipboardBackend();
        var service = new WindowsClipboardService(backend);
        var imageContent = Convert.ToBase64String(FakeWindowImageCapture.PngBytes);

        var send = await service.SetAsync(new ClipboardWriteRequest(
            Type: "image",
            Content: imageContent,
            MimeType: "image/png"));

        Assert.True(send.IsSuccess);
        Assert.Equal("image", send.Value?.Type);
        Assert.Equal("image/png", send.Value?.MimeType);
        Assert.Equal(FakeWindowImageCapture.PngBytes.Length, send.Value?.SizeBytes);
        Assert.Equal(FakeWindowImageCapture.PngBytes, backend.ImageBytes);
        Assert.Equal("image/png", backend.ImageMimeType);

        var receive = await service.GetAsync();

        Assert.True(receive.IsSuccess);
        Assert.Equal("image", receive.Value?.Type);
        Assert.Equal(imageContent, receive.Value?.Content);
        Assert.Equal("image/png", receive.Value?.MimeType);
        Assert.Equal(FakeWindowImageCapture.PngBytes.Length, receive.Value?.SizeBytes);
    }

    [Fact]
    public async Task GetAsync_ReturnsEmptyWhenBackendHasNoPayload()
    {
        var service = new WindowsClipboardService(new FakeClipboardBackend());

        var result = await service.GetAsync();

        Assert.False(result.IsSuccess);
        Assert.Equal("E_CLIPBOARD_EMPTY", result.Error?.Code);
    }

    [Fact]
    public async Task SetAsync_RejectsPayloadAboveTenMegabytes()
    {
        var service = new WindowsClipboardService(new FakeClipboardBackend());
        var oversizedContent = new string('a', (10 * 1024 * 1024) + 1);

        var result = await service.SetAsync(new ClipboardWriteRequest(
            Type: "text",
            Content: oversizedContent,
            MimeType: "text/plain"));

        Assert.False(result.IsSuccess);
        Assert.Equal("E_CLIPBOARD_TOO_LARGE", result.Error?.Code);
    }

    [Fact]
    public async Task ClearAsync_RemovesAnyStoredPayload()
    {
        var backend = new FakeClipboardBackend();
        var service = new WindowsClipboardService(backend);

        await service.SetTextAsync("clear me");
        await service.ClearAsync();

        Assert.Null(backend.Text);
        Assert.Null(backend.ImageBytes);
        Assert.Null(backend.ImageMimeType);

        var result = await service.GetAsync();
        Assert.False(result.IsSuccess);
        Assert.Equal("E_CLIPBOARD_EMPTY", result.Error?.Code);
    }

    private sealed class FakeClipboardBackend : IClipboardBackend
    {
        public string? Text { get; private set; }

        public byte[]? ImageBytes { get; private set; }

        public string? ImageMimeType { get; private set; }

        public void Clear()
        {
            Text = null;
            ImageBytes = null;
            ImageMimeType = null;
        }

        public void SetText(string text)
        {
            Text = text;
            ImageBytes = null;
            ImageMimeType = null;
        }

        public string? GetText()
        {
            return Text;
        }

        public void SetImage(byte[] imageBytes, string mimeType)
        {
            ImageBytes = imageBytes;
            ImageMimeType = mimeType;
            Text = null;
        }

        public ClipboardImageData? GetImage()
        {
            return ImageBytes is null
                ? null
                : new ClipboardImageData(ImageBytes, ImageMimeType ?? "image/png");
        }
    }
}
