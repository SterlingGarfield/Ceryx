using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Ceryx.Agent.Codex.WindowLocator;
using Ceryx.Agent.Core;
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
            CreateJsonContent(new CaptureSignalBody("sess-1", "offer", "{}")));
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

        var screenshotClient = await CreateClientAsync(Permission.Screenshot);
        var screenshot = await screenshotClient.PostAsync("/api/v1/media/screenshot", content: null);
        Assert.True(screenshot.IsSuccessStatusCode, await screenshot.Content.ReadAsStringAsync());
        var screenshotRoot = await ReadJsonAsync(screenshot);
        Assert.True(screenshotRoot.GetProperty("ok").GetBoolean());
        Assert.EndsWith(".png", screenshotRoot.GetProperty("fileName").GetString(), StringComparison.OrdinalIgnoreCase);

        var recordingClient = await CreateClientAsync(Permission.Recording);
        var start = await recordingClient.PostAsync("/api/v1/media/recording/start", content: null);
        Assert.Equal(HttpStatusCode.OK, start.StatusCode);
        var startRoot = await ReadJsonAsync(start);
        Assert.Equal("recording", startRoot.GetProperty("status").GetString());

        var stop = await recordingClient.PostAsync("/api/v1/media/recording/stop", content: null);
        Assert.Equal(HttpStatusCode.OK, stop.StatusCode);
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

    private static CodexWindowSnapshot FoundWindow(string windowId, string status = "found")
    {
        return new CodexWindowSnapshot(
            Status: status,
            WindowId: windowId,
            Title: "Codex",
            ProcessName: "codex",
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

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<ICodexWindowProbe>();
            services.RemoveAll<ICodexWindowLocator>();
            services.AddSingleton(Locator);
            services.AddSingleton<ICodexWindowLocator>(serviceProvider =>
                serviceProvider.GetRequiredService<TestCodexWindowLocator>());
        });
    }
}

public sealed class TestCodexWindowLocator : ICodexWindowLocator
{
    private readonly object _sync = new();

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
            if (string.Equals(_snapshot.WindowId, windowId, StringComparison.OrdinalIgnoreCase))
            {
                _snapshot = _snapshot with
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

    private static bool IsUnavailable(string status)
    {
        return status is "not_found" or "multiple_candidates" or "permission_issue";
    }
}
