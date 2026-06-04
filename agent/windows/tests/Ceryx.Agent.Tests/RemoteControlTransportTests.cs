using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Ceryx.Agent.Codex.Clipboard;
using Ceryx.Agent.Codex.WindowLocator;
using Ceryx.Agent.Core;
using Ceryx.Agent.Media;
using Ceryx.Agent.Security.Pairing;
using Ceryx.Agent.Storage;
using Ceryx.Agent.Storage.Audit;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Xunit;

namespace Ceryx.Agent.Tests;

public sealed class RemoteControlTransportTests : IClassFixture<RemoteControlTransportFactory>
{
    private readonly RemoteControlTransportFactory _factory;

    public RemoteControlTransportTests(RemoteControlTransportFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task CodexWindowRoutes_ReportConfiguredSnapshot()
    {
        SetWindow(FoundWindow("w-codex-found", status: "found"));

        var viewer = await CreateClientAsync(Permission.ViewWindow);
        var getter = await viewer.GetAsync("/api/v1/codex/window");
        Assert.Equal(HttpStatusCode.OK, getter.StatusCode);

        var getRoot = await ReadJsonAsync(getter);
        Assert.Equal("found", getRoot.GetProperty("status").GetString());
        Assert.Equal("w-codex-found", getRoot.GetProperty("windowId").GetString());

        var controller = await CreateClientAsync(Permission.ControlInput);
        var focus = await controller.PostAsync("/api/v1/codex/focus", content: null);
        Assert.Equal(HttpStatusCode.OK, focus.StatusCode);

        var focusRoot = await ReadJsonAsync(focus);
        Assert.Equal("focused", focusRoot.GetProperty("status").GetString());
        Assert.Equal("w-codex-found", focusRoot.GetProperty("windowId").GetString());

        var refresh = await viewer.PostAsync("/api/v1/codex/refresh", content: null);
        Assert.Equal(HttpStatusCode.OK, refresh.StatusCode);
    }

    [Fact]
    public async Task CodexWindowRoutes_ListConfiguredWindows()
    {
        SetWindows([
            FoundWindow("w-codex-a", status: "focused", title: "Codex A"),
            FoundWindow("w-codex-b", status: "found", title: "Codex B")
        ]);

        var viewer = await CreateClientAsync(Permission.ViewWindow);
        var response = await viewer.GetAsync("/api/v1/codex/windows");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var root = await ReadJsonAsync(response);
        Assert.Equal(2, root.GetProperty("totalCount").GetInt32());
        var windows = root.GetProperty("windows");
        Assert.Equal(JsonValueKind.Array, windows.ValueKind);
        Assert.Equal(2, windows.GetArrayLength());
        Assert.Equal("w-codex-a", windows[0].GetProperty("windowId").GetString());
        Assert.Equal("focused", windows[0].GetProperty("status").GetString());
        Assert.Equal("w-codex-b", windows[1].GetProperty("windowId").GetString());
        Assert.Equal("found", windows[1].GetProperty("status").GetString());
    }

    [Fact]
    public async Task CodexSelectWindow_RejectsMissingWindowId()
    {
        SetWindow(FoundWindow("w-codex-select"));

        var client = await CreateClientAsync(Permission.ControlInput);
        var response = await client.PostAsync(
            "/api/v1/codex/select-window",
            CreateJsonContent(new CodexSelectWindowBody("")));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.True(response.Headers.TryGetValues("X-Trace-Id", out _));

        var root = await ReadJsonAsync(response);
        AssertErrorCode(root, "E_CODEX_NOT_FOUND");
    }

    [Fact]
    public async Task InputRoutes_RejectWhenCodexWindowUnavailable()
    {
        var client = await CreateClientAsync(Permission.ControlInput);

        SetWindow(NotFoundWindow());
        var textResponse = await client.PostAsync(
            "/api/v1/input/text",
            CreateJsonContent(new InputTextBody("hello")));

        Assert.Equal(HttpStatusCode.Conflict, textResponse.StatusCode);
        Assert.True(textResponse.Headers.TryGetValues("X-Trace-Id", out _));
        AssertErrorCode(await ReadJsonAsync(textResponse), "E_CODEX_NOT_FOUND");

        SetWindow(FoundWindow("w-codex-minimized", status: "minimized"));
        var hotkeyResponse = await client.PostAsync(
            "/api/v1/input/hotkey",
            CreateJsonContent(new InputHotkeyBody(["CTRL", "K"])));

        Assert.Equal(HttpStatusCode.Conflict, hotkeyResponse.StatusCode);
        Assert.True(hotkeyResponse.Headers.TryGetValues("X-Trace-Id", out _));
        AssertErrorCode(await ReadJsonAsync(hotkeyResponse), "E_CODEX_MINIMIZED");
    }

    [Fact]
    public async Task InputKey_BlocksSecondControllerForSameWindow()
    {
        SetWindow(FoundWindow("w-lock-" + Guid.NewGuid().ToString("N")));
        var first = await CreateClientAsync(Permission.ControlInput);
        var second = await CreateClientAsync(Permission.ControlInput);
        var payload = CreateJsonContent(new InputKeyBody("K", "down", ["CTRL"]));

        var firstResponse = await first.PostAsync("/api/v1/input/key", payload);
        Assert.Equal(HttpStatusCode.OK, firstResponse.StatusCode);
        var firstRoot = await ReadJsonAsync(firstResponse);
        Assert.True(firstRoot.GetProperty("ok").GetBoolean());

        var secondResponse = await second.PostAsync(
            "/api/v1/input/key",
            CreateJsonContent(new InputKeyBody("K", "down", ["CTRL"])));

        Assert.Equal(HttpStatusCode.Conflict, secondResponse.StatusCode);
        Assert.True(secondResponse.Headers.TryGetValues("X-Trace-Id", out _));
        AssertErrorCode(await ReadJsonAsync(secondResponse), "E_INPUT_BLOCKED");
    }

    [Fact]
    public async Task PromptSend_SucceedsAndRejectsWhenWindowMissing()
    {
        var client = await CreateClientAsync(Permission.SendPrompt);

        SetWindow(FoundWindow("w-prompt-ok"));
        var success = await client.PostAsync(
            "/api/v1/prompt/send",
            CreateJsonContent(new PromptSendBody("hello from remote", true)));

        Assert.Equal(HttpStatusCode.OK, success.StatusCode);
        var successRoot = await ReadJsonAsync(success);
        Assert.True(successRoot.GetProperty("ok").GetBoolean());
        Assert.Equal("sent", successRoot.GetProperty("status").GetString());
        Assert.True(successRoot.GetProperty("submitted").GetBoolean());

        SetWindow(NotFoundWindow());
        var failed = await client.PostAsync(
            "/api/v1/prompt/send",
            CreateJsonContent(new PromptSendBody("retry", false)));

        Assert.Equal(HttpStatusCode.Conflict, failed.StatusCode);
        Assert.True(failed.Headers.TryGetValues("X-Trace-Id", out _));
        AssertErrorCode(await ReadJsonAsync(failed), "E_CODEX_NOT_FOUND");
    }

    [Fact]
    public async Task ClipboardRoutes_SendReceiveAndClearPayload()
    {
        var client = await CreateClientAsync(Permission.ManageAgent);
        var auditStore = _factory.Services.GetRequiredService<IAuditLogStore>();
        var sendBefore = (await auditStore.QueryAsync(new AuditLogQuery(Page: 1, PageSize: 1, Action: "clipboard.send"))).Total;
        var receiveBefore = (await auditStore.QueryAsync(new AuditLogQuery(Page: 1, PageSize: 1, Action: "clipboard.receive"))).Total;
        var clearBefore = (await auditStore.QueryAsync(new AuditLogQuery(Page: 1, PageSize: 1, Action: "clipboard.clear"))).Total;

        var send = await client.PostAsync(
            "/api/v1/clipboard/send",
            CreateJsonContent(new ClipboardSendBody(
                Type: "text",
                Content: "sync me",
                MimeType: "text/plain")));
        Assert.Equal(HttpStatusCode.OK, send.StatusCode);

        var sendRoot = await ReadJsonAsync(send);
        Assert.True(sendRoot.GetProperty("ok").GetBoolean());
        Assert.Equal("text", sendRoot.GetProperty("type").GetString());
        Assert.Equal("text/plain", sendRoot.GetProperty("mimeType").GetString());
        Assert.True(sendRoot.GetProperty("sizeBytes").GetInt32() > 0);

        var receive = await client.GetAsync("/api/v1/clipboard/receive");
        Assert.Equal(HttpStatusCode.OK, receive.StatusCode);

        var receiveRoot = await ReadJsonAsync(receive);
        Assert.True(receiveRoot.GetProperty("ok").GetBoolean());
        Assert.Equal("text", receiveRoot.GetProperty("type").GetString());
        Assert.Equal("sync me", receiveRoot.GetProperty("content").GetString());

        var clear = await client.PostAsync("/api/v1/clipboard/clear", content: null);
        Assert.Equal(HttpStatusCode.OK, clear.StatusCode);
        var clearRoot = await ReadJsonAsync(clear);
        Assert.True(clearRoot.GetProperty("ok").GetBoolean());
        Assert.True(clearRoot.GetProperty("cleared").GetBoolean());

        var empty = await client.GetAsync("/api/v1/clipboard/receive");
        Assert.Equal(HttpStatusCode.NotFound, empty.StatusCode);
        AssertErrorCode(await ReadJsonAsync(empty), "E_CLIPBOARD_EMPTY");

        var sendAfter = (await auditStore.QueryAsync(new AuditLogQuery(Page: 1, PageSize: 1, Action: "clipboard.send"))).Total;
        var receiveAfter = (await auditStore.QueryAsync(new AuditLogQuery(Page: 1, PageSize: 1, Action: "clipboard.receive"))).Total;
        var clearAfter = (await auditStore.QueryAsync(new AuditLogQuery(Page: 1, PageSize: 1, Action: "clipboard.clear"))).Total;
        Assert.True(sendAfter >= sendBefore + 1);
        Assert.True(receiveAfter >= receiveBefore + 1);
        Assert.True(clearAfter >= clearBefore + 1);
    }

    [Fact]
    public async Task ClipboardRoutes_SendAndReceiveImagePayload()
    {
        var client = await CreateClientAsync(Permission.ManageAgent);
        var imageContent = Convert.ToBase64String(FakeWindowImageCapture.PngBytes);

        var send = await client.PostAsync(
            "/api/v1/clipboard/send",
            CreateJsonContent(new ClipboardSendBody(
                Type: "image",
                Content: imageContent,
                MimeType: "image/png")));

        Assert.Equal(HttpStatusCode.OK, send.StatusCode);

        var receive = await client.GetAsync("/api/v1/clipboard/receive");
        Assert.Equal(HttpStatusCode.OK, receive.StatusCode);

        var receiveRoot = await ReadJsonAsync(receive);
        Assert.True(receiveRoot.GetProperty("ok").GetBoolean());
        Assert.Equal("image", receiveRoot.GetProperty("type").GetString());
        Assert.Equal("image/png", receiveRoot.GetProperty("mimeType").GetString());
        Assert.Equal(imageContent, receiveRoot.GetProperty("content").GetString());
        Assert.Equal(FakeWindowImageCapture.PngBytes.Length, receiveRoot.GetProperty("sizeBytes").GetInt32());
    }

    [Fact]
    public async Task ClipboardSendRoute_RejectsPayloadAboveTenMegabytes()
    {
        var client = await CreateClientAsync(Permission.ManageAgent);
        var oversizedContent = new string('a', (10 * 1024 * 1024) + 1);
        var response = await client.PostAsync(
            "/api/v1/clipboard/send",
            CreateJsonContent(new ClipboardSendBody(
                Type: "text",
                Content: oversizedContent,
                MimeType: "text/plain")));

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        AssertErrorCode(await ReadJsonAsync(response), "E_CLIPBOARD_TOO_LARGE");
    }

    [Fact]
    public async Task CaptureRoutes_StartStateStopAndRejectUnavailableWindow()
    {
        var client = await CreateClientAsync(Permission.ViewWindow);

        SetWindow(FoundWindow("w-capture-ok", status: "focused"));
        var start = await client.PostAsync(
            "/api/v1/capture/start",
            CreateJsonContent(new CaptureStartBody("balanced", "codex_window")));

        Assert.True(start.IsSuccessStatusCode, await start.Content.ReadAsStringAsync());
        var startRoot = await ReadJsonAsync(start);
        Assert.True(startRoot.GetProperty("active").GetBoolean());
        Assert.Equal("w-capture-ok", startRoot.GetProperty("windowId").GetString());

        var signal = await client.PostAsync(
            "/api/v1/capture/webrtc/signal",
            CreateJsonContent(new CaptureSignalBody(
                SessionId: "sess-1",
                Type: "offer",
                Payload: null,
                Sdp: "{}",
                Candidate: null)));
        Assert.Equal(HttpStatusCode.OK, signal.StatusCode);

        var state = await client.GetAsync("/api/v1/capture/state");
        Assert.Equal(HttpStatusCode.OK, state.StatusCode);
        var stateRoot = await ReadJsonAsync(state);
        Assert.True(stateRoot.GetProperty("active").GetBoolean());

        var stop = await client.PostAsync("/api/v1/capture/stop", content: null);
        Assert.Equal(HttpStatusCode.OK, stop.StatusCode);
        var stopRoot = await ReadJsonAsync(stop);
        Assert.False(stopRoot.GetProperty("active").GetBoolean());

        SetWindow(NotFoundWindow());
        var unavailable = await client.PostAsync(
            "/api/v1/capture/start",
            CreateJsonContent(new CaptureStartBody("balanced", "codex_window")));

        Assert.Equal(HttpStatusCode.Conflict, unavailable.StatusCode);
        Assert.True(unavailable.Headers.TryGetValues("X-Trace-Id", out _));
        AssertErrorCode(await ReadJsonAsync(unavailable), "E_CODEX_NOT_FOUND");
    }

    [Fact]
    public async Task CaptureRoutes_StartSpecificWindowAndPreviewInactiveWindow()
    {
        SetWindows([
            FoundWindow("w-capture-a", status: "focused", title: "Codex A"),
            FoundWindow("w-capture-b", status: "found", title: "Codex B")
        ]);

        var client = await CreateClientAsync(Permission.ViewWindow);
        var start = await client.PostAsync(
            "/api/v1/capture/start",
            CreateJsonContent(new
            {
                mode = "balanced",
                target = "codex_window",
                windowId = "w-capture-b"
            }));

        Assert.True(start.IsSuccessStatusCode, await start.Content.ReadAsStringAsync());
        var startRoot = await ReadJsonAsync(start);
        Assert.Equal("w-capture-b", startRoot.GetProperty("windowId").GetString());

        var activeFrame = await client.GetAsync("/api/v1/capture/frame");
        Assert.Equal(HttpStatusCode.OK, activeFrame.StatusCode);
        Assert.Equal("w-capture-b", _factory.WindowImageCapture.LastCapturedWindowId);

        var inactiveFrame = await client.GetAsync("/api/v1/capture/frame?windowId=w-capture-a");
        Assert.Equal(HttpStatusCode.OK, inactiveFrame.StatusCode);
        Assert.Equal("w-capture-a", _factory.WindowImageCapture.LastCapturedWindowId);

        var screenshotClient = await CreateClientAsync(Permission.Screenshot);
        var screenshot = await screenshotClient.PostAsync("/api/v1/media/screenshot?windowId=w-capture-a", content: null);
        Assert.True(screenshot.IsSuccessStatusCode, await screenshot.Content.ReadAsStringAsync());
        Assert.Equal("w-capture-a", _factory.WindowImageCapture.LastCapturedWindowId);
    }

    [Fact]
    public async Task CaptureFrameRoute_ReturnsJpegAndDoesNotPersistFiles()
    {
        SetWindow(FoundWindow("w-frame-ok", status: "focused"));
        var client = await CreateClientAsync(Permission.ViewWindow);
        var screenshotsPath = _factory.Services.GetRequiredService<LocalPaths>().Screenshots;
        var filesBefore = Directory.GetFiles(screenshotsPath).Length;

        var start = await client.PostAsync(
            "/api/v1/capture/start",
            CreateJsonContent(new CaptureStartBody("balanced", "codex_window")));
        Assert.True(start.IsSuccessStatusCode, await start.Content.ReadAsStringAsync());

        var frame = await client.GetAsync("/api/v1/capture/frame");
        Assert.Equal(HttpStatusCode.OK, frame.StatusCode);
        Assert.Equal("image/jpeg", frame.Content.Headers.ContentType?.MediaType);
        Assert.Equal(FakeWindowImageCapture.JpegBytes, await frame.Content.ReadAsByteArrayAsync());
        Assert.Equal("1280", frame.Headers.GetValues("X-Ceryx-Frame-Width").Single());
        Assert.Equal("720", frame.Headers.GetValues("X-Ceryx-Frame-Height").Single());
        Assert.True(frame.Headers.Contains("X-Ceryx-Frame-Captured-At"));
        Assert.Equal(filesBefore, Directory.GetFiles(screenshotsPath).Length);

        var stop = await client.PostAsync("/api/v1/capture/stop", content: null);
        Assert.Equal(HttpStatusCode.OK, stop.StatusCode);
    }

    [Fact]
    public async Task CaptureFrameRoute_RejectsInactiveAndUnavailableStates()
    {
        SetWindow(FoundWindow("w-frame-state", status: "focused"));
        var client = await CreateClientAsync(Permission.ViewWindow);

        var reset = await client.PostAsync("/api/v1/capture/stop", content: null);
        Assert.Equal(HttpStatusCode.OK, reset.StatusCode);

        var inactive = await client.GetAsync("/api/v1/capture/frame");
        Assert.Equal(HttpStatusCode.Conflict, inactive.StatusCode);
        AssertErrorCode(await ReadJsonAsync(inactive), "E_CAPTURE_INACTIVE");

        var start = await client.PostAsync(
            "/api/v1/capture/start",
            CreateJsonContent(new CaptureStartBody("balanced", "codex_window")));
        Assert.True(start.IsSuccessStatusCode, await start.Content.ReadAsStringAsync());

        SetWindow(FoundWindow("w-frame-state", status: "minimized"));
        var minimized = await client.GetAsync("/api/v1/capture/frame");
        Assert.Equal(HttpStatusCode.Conflict, minimized.StatusCode);
        AssertErrorCode(await ReadJsonAsync(minimized), "E_CODEX_MINIMIZED");

        SetWindow(NotFoundWindow());
        var missing = await client.GetAsync("/api/v1/capture/frame");
        Assert.Equal(HttpStatusCode.Conflict, missing.StatusCode);
        AssertErrorCode(await ReadJsonAsync(missing), "E_CODEX_NOT_FOUND");
    }

    [Fact]
    public async Task PairingDesktopConfirmRoute_ReturnsGeneratedCode()
    {
        using var client = _factory.CreateClient();

        var request = await client.PostAsync(
            "/api/v1/pairing/request",
            CreateJsonContent(new PairingRequestBody("Ceryx iPad", "ipad", "ios")));

        Assert.Equal(HttpStatusCode.OK, request.StatusCode);
        var requestRoot = await ReadJsonAsync(request);
        Assert.True(requestRoot.GetProperty("ok").GetBoolean());
        var pairingId = requestRoot.GetProperty("pairingId").GetString();
        Assert.False(string.IsNullOrWhiteSpace(pairingId));

        var approval = await client.PostAsync(
            "/api/v1/pairing/desktop-confirm",
            CreateJsonContent(new PairingDesktopConfirmBody(pairingId!)));

        Assert.Equal(HttpStatusCode.OK, approval.StatusCode);
        var approvalRoot = await ReadJsonAsync(approval);
        Assert.True(approvalRoot.GetProperty("ok").GetBoolean());
        Assert.Equal("code_input", approvalRoot.GetProperty("state").GetString());
        Assert.Equal("654321", approvalRoot.GetProperty("code").GetString());
    }

    [Fact]
    public async Task UploadImageRoutes_RejectInvalidPayloads()
    {
        var client = await CreateClientAsync(Permission.UploadImage);

        var nonMultipart = await client.PostAsync(
            "/api/v1/assets/upload-image",
            CreateJsonContent(new { foo = "bar" }));
        Assert.Equal(HttpStatusCode.BadRequest, nonMultipart.StatusCode);
        Assert.True(nonMultipart.Headers.TryGetValues("X-Trace-Id", out _));
        AssertErrorCode(await ReadJsonAsync(nonMultipart), "E_PAIRING_INVALID_REQUEST");

        using var multipart = new MultipartFormDataContent();
        var payload = new ByteArrayContent(Encoding.UTF8.GetBytes("not-image"));
        payload.Headers.ContentType = new MediaTypeHeaderValue("text/plain");
        multipart.Add(payload, "file", "invalid.txt");

        var unsupported = await client.PostAsync("/api/v1/assets/upload-image", multipart);
        Assert.Equal(HttpStatusCode.Forbidden, unsupported.StatusCode);
        Assert.True(unsupported.Headers.TryGetValues("X-Trace-Id", out _));
        AssertErrorCode(await ReadJsonAsync(unsupported), "E_CAPTURE_DENIED");
    }

    [Fact]
    public async Task MediaRoutes_ScreenshotAndRecording_EndToEnd()
    {
        SetWindow(FoundWindow("w-media-ok", status: "focused"));
        var screenshotsPath = _factory.Services.GetRequiredService<LocalPaths>().Screenshots;
        var filesBefore = Directory.GetFiles(screenshotsPath).Length;

        var screenshotClient = await CreateClientAsync(Permission.Screenshot);
        var screenshot = await screenshotClient.PostAsync("/api/v1/media/screenshot", content: null);
        Assert.True(screenshot.IsSuccessStatusCode, await screenshot.Content.ReadAsStringAsync());
        var screenshotRoot = await ReadJsonAsync(screenshot);
        Assert.True(screenshotRoot.GetProperty("ok").GetBoolean());
        var screenshotFileName = screenshotRoot.GetProperty("fileName").GetString();
        Assert.EndsWith(".png", screenshotFileName, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(filesBefore + 1, Directory.GetFiles(screenshotsPath).Length);
        var screenshotPath = Path.Combine(screenshotsPath, screenshotFileName!);
        Assert.True(File.Exists(screenshotPath));
        Assert.Equal(FakeWindowImageCapture.PngBytes, await File.ReadAllBytesAsync(screenshotPath));

        var recordingClient = await CreateClientAsync(Permission.Recording);
        var start = await recordingClient.PostAsync(
            "/api/v1/media/recording/start",
            CreateJsonContent(new { confirmHighRisk = true }));
        Assert.True(start.IsSuccessStatusCode, await start.Content.ReadAsStringAsync());
        var startRoot = await ReadJsonAsync(start);
        Assert.Equal("recording", startRoot.GetProperty("status").GetString());

        var stop = await recordingClient.PostAsync("/api/v1/media/recording/stop", content: null);
        Assert.True(stop.IsSuccessStatusCode, await stop.Content.ReadAsStringAsync());
        var stopRoot = await ReadJsonAsync(stop);
        Assert.Equal("stopped", stopRoot.GetProperty("status").GetString());
        Assert.EndsWith(".mp4", stopRoot.GetProperty("fileName").GetString(), StringComparison.OrdinalIgnoreCase);

        var stopAgain = await recordingClient.PostAsync("/api/v1/media/recording/stop", content: null);
        Assert.Equal(HttpStatusCode.Conflict, stopAgain.StatusCode);
        Assert.True(stopAgain.Headers.TryGetValues("X-Trace-Id", out _));
        AssertErrorCode(await ReadJsonAsync(stopAgain), "E_RECORDING_BUSY");
    }

    private async Task<HttpClient> CreateClientAsync(Permission permission)
    {
        return await AuthTestHelper.CreateAuthorizedClientAsync(_factory, permissions: [permission]);
    }

    private void SetWindow(CodexWindowSnapshot snapshot)
    {
        _factory.Locator.SetSnapshot(snapshot);
    }

    private void SetWindows(IReadOnlyList<CodexWindowSnapshot> windows)
    {
        _factory.Locator.SetWindows(windows);
    }

    private static CodexWindowSnapshot FoundWindow(
        string windowId,
        string status = "found",
        string title = "Codex",
        string processName = "codex")
    {
        return new CodexWindowSnapshot(
            Status: status,
            WindowId: windowId,
            Title: title,
            ProcessName: processName,
            CandidateCount: 1,
            LastUpdatedAt: DateTimeOffset.UtcNow);
    }

    private static CodexWindowSnapshot NotFoundWindow()
    {
        return new CodexWindowSnapshot(
            Status: "not_found",
            WindowId: null,
            Title: null,
            ProcessName: null,
            CandidateCount: 0,
            LastUpdatedAt: DateTimeOffset.UtcNow);
    }

    private static StringContent CreateJsonContent<T>(T payload)
    {
        return new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    private static void AssertErrorCode(JsonElement root, string code)
    {
        Assert.False(root.GetProperty("ok").GetBoolean());
        Assert.Equal(code, root.GetProperty("error").GetProperty("code").GetString());
    }
}

public sealed class RemoteControlTransportFactory : WebApplicationFactory<Program>
{
    public TestCodexWindowLocator Locator { get; } = new();
    public FakeWindowImageCapture WindowImageCapture { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<ICodexWindowProbe>();
            services.RemoveAll<ICodexWindowLocator>();
            services.RemoveAll<IWindowImageCapture>();
            services.RemoveAll<IClipboardService>();
            services.RemoveAll<IPairingCodeGenerator>();
            services.AddSingleton(Locator);
            services.AddSingleton(WindowImageCapture);
            services.AddSingleton<IClipboardService, MemoryClipboardService>();
            services.AddSingleton<ICodexWindowLocator>(serviceProvider =>
                serviceProvider.GetRequiredService<TestCodexWindowLocator>());
            services.AddSingleton<IWindowImageCapture>(serviceProvider =>
                serviceProvider.GetRequiredService<FakeWindowImageCapture>());
            services.AddSingleton<IPairingCodeGenerator>(new FixedPairingCodeGenerator("654321"));
        });
    }
}

public sealed class FixedPairingCodeGenerator : IPairingCodeGenerator
{
    private readonly string _code;

    public FixedPairingCodeGenerator(string code)
    {
        _code = code;
    }

    public string GenerateSixDigitCode() => _code;
}

public sealed class TestCodexWindowLocator : ICodexWindowLocator
{
    private readonly object _sync = new();

    private IReadOnlyList<CodexWindowSnapshot>? _windows;
    private CodexWindowSnapshot _snapshot = new(
        Status: "not_found",
        WindowId: null,
        Title: null,
        ProcessName: null,
        CandidateCount: 0,
        LastUpdatedAt: DateTimeOffset.UtcNow);

    public void SetSnapshot(CodexWindowSnapshot snapshot)
    {
        lock (_sync)
        {
            _snapshot = snapshot;
            _windows = null;
        }
    }

    public void SetWindows(IReadOnlyList<CodexWindowSnapshot> windows)
    {
        lock (_sync)
        {
            _windows = windows;
            _snapshot = windows.FirstOrDefault(window => window.Status is "focused") ?? windows.FirstOrDefault() ?? new CodexWindowSnapshot(
                Status: "not_found",
                WindowId: null,
                Title: null,
                ProcessName: null,
                CandidateCount: 0,
                LastUpdatedAt: DateTimeOffset.UtcNow);
        }
    }

    public Task<CodexWindowSnapshot> GetWindowAsync(CancellationToken cancellationToken = default)
    {
        lock (_sync)
        {
            return Task.FromResult(_snapshot);
        }
    }

    public Task<CodexWindowSnapshot> RefreshAsync(CancellationToken cancellationToken = default)
    {
        lock (_sync)
        {
            _snapshot = _snapshot with { LastUpdatedAt = DateTimeOffset.UtcNow };
            return Task.FromResult(_snapshot);
        }
    }

    public Task<CodexWindowSnapshot> FocusAsync(CancellationToken cancellationToken = default)
    {
        lock (_sync)
        {
            if (_snapshot.WindowId is null || IsUnavailable(_snapshot.Status))
            {
                return Task.FromResult(_snapshot);
            }

            _snapshot = _snapshot with
            {
                Status = "focused",
                LastUpdatedAt = DateTimeOffset.UtcNow
            };
            return Task.FromResult(_snapshot);
        }
    }

    public Task<CodexWindowSnapshot> SelectWindowAsync(string windowId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(windowId);

        lock (_sync)
        {
            var selected = _windows?.FirstOrDefault(window => string.Equals(window.WindowId, windowId, StringComparison.OrdinalIgnoreCase));
            if (selected is not null)
            {
                _snapshot = selected with
                {
                    Status = "focused",
                    LastUpdatedAt = DateTimeOffset.UtcNow
                };
            }
            else
            {
                _snapshot = _snapshot with
                {
                    Status = "not_found",
                    WindowId = null,
                    Title = null,
                    ProcessName = null,
                    CandidateCount = 0,
                    LastUpdatedAt = DateTimeOffset.UtcNow
                };
            }

            return Task.FromResult(_snapshot);
        }
    }

    public Task<CodexWindowListSnapshot> ListWindowsAsync(CancellationToken cancellationToken = default)
    {
        lock (_sync)
        {
            if (_windows is not null)
            {
                return Task.FromResult(new CodexWindowListSnapshot(
                    Windows: _windows,
                    ActiveWindowId: _snapshot.WindowId,
                    TotalCount: _windows.Count,
                    LastUpdatedAt: _snapshot.LastUpdatedAt));
            }

            if (_snapshot.WindowId is null)
            {
                return Task.FromResult(new CodexWindowListSnapshot(
                    Windows: [],
                    ActiveWindowId: null,
                    TotalCount: 0,
                    LastUpdatedAt: _snapshot.LastUpdatedAt));
            }

            return Task.FromResult(new CodexWindowListSnapshot(
                Windows: [_snapshot],
                ActiveWindowId: _snapshot.WindowId,
                TotalCount: 1,
                LastUpdatedAt: _snapshot.LastUpdatedAt));
        }
    }

    private static bool IsUnavailable(string status)
    {
        return status is "not_found" or "multiple_candidates" or "permission_issue";
    }
}

public sealed class FakeWindowImageCapture : IWindowImageCapture
{
    public string? LastCapturedWindowId { get; private set; }

    public static readonly byte[] JpegBytes = Convert.FromBase64String(
        "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD50ooor8MP9Uz/2Q==");

    public static readonly byte[] PngBytes = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+Z94AAAAASUVORK5CYII=");

    public Task<Result<CapturedWindowFrame>> CaptureAsync(
        CodexWindowSnapshot window,
        WindowImageFormat format,
        CancellationToken cancellationToken = default)
    {
        LastCapturedWindowId = window.WindowId;
        if (string.IsNullOrWhiteSpace(window.WindowId) ||
            string.Equals(window.Status, "not_found", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(window.Status, "unavailable", StringComparison.OrdinalIgnoreCase))
        {
            return Task.FromResult(Result<CapturedWindowFrame>.Failure(
                new AgentError("E_CODEX_NOT_FOUND", "Codex window not found.", Guid.NewGuid().ToString("N"))));
        }

        if (string.Equals(window.Status, "minimized", StringComparison.OrdinalIgnoreCase))
        {
            return Task.FromResult(Result<CapturedWindowFrame>.Failure(
                new AgentError("E_CODEX_MINIMIZED", "Codex window is minimized.", Guid.NewGuid().ToString("N"))));
        }

        var bytes = format == WindowImageFormat.Png ? PngBytes : JpegBytes;
        var contentType = format == WindowImageFormat.Png ? "image/png" : "image/jpeg";
        return Task.FromResult(Result<CapturedWindowFrame>.Success(
            new CapturedWindowFrame(bytes, contentType, 1280, 720, DateTimeOffset.UtcNow)));
    }
}
