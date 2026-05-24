using System.Net;
using System.Text;
using System.Text.Json;
using Ceryx.Agent.Core;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Ceryx.Agent.Tests;

public sealed class HighRiskActionsTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public HighRiskActionsTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task HighRiskActions_RecordingStart_RequiresConfirmAndWritesAudit()
    {
        var context = await AuthTestHelper.CreateAuthorizedClientContextAsync(
            _factory,
            permissions: [Permission.Recording]);

        var start = await context.Client.PostAsync("/api/v1/media/recording/start", content: null);
        Assert.Equal(HttpStatusCode.Conflict, start.StatusCode);
        var startRoot = await ReadJsonAsync(start);
        AssertErrorCode(startRoot, "E_CONFIRM_REQUIRED");

        var logs = await context.Client.GetAsync(
            $"/api/v1/logs?page=1&pageSize=20&severity=warning&action=media.recording.start.rejected&sessionId={context.DeviceId}");
        Assert.Equal(HttpStatusCode.OK, logs.StatusCode);
        var logsRoot = await ReadJsonAsync(logs);
        var items = logsRoot.GetProperty("items");
        Assert.True(items.GetArrayLength() >= 1);
        var latest = items[0];
        Assert.Equal("media.recording.start.rejected", latest.GetProperty("action").GetString());
        Assert.Equal("warning", latest.GetProperty("severity").GetString());
        Assert.Equal(context.DeviceId, latest.GetProperty("sessionId").GetString());
        Assert.Contains("result=rejected", latest.GetProperty("details").GetString());
    }

    [Fact]
    public async Task HighRiskActions_PauseControl_RequiresConfirmAndWritesAudit()
    {
        var context = await AuthTestHelper.CreateAuthorizedClientContextAsync(
            _factory,
            permissions: [Permission.ManageAgent]);

        var pause = await context.Client.PostAsync("/api/v1/agent/pause-control", content: null);
        Assert.Equal(HttpStatusCode.Conflict, pause.StatusCode);
        var pauseRoot = await ReadJsonAsync(pause);
        AssertErrorCode(pauseRoot, "E_CONFIRM_REQUIRED");

        var logs = await context.Client.GetAsync(
            $"/api/v1/logs?page=1&pageSize=20&severity=warning&action=agent.pause-control.rejected&sessionId={context.DeviceId}");
        Assert.Equal(HttpStatusCode.OK, logs.StatusCode);
        var logsRoot = await ReadJsonAsync(logs);
        var items = logsRoot.GetProperty("items");
        Assert.True(items.GetArrayLength() >= 1);
        var latest = items[0];
        Assert.Equal("agent.pause-control.rejected", latest.GetProperty("action").GetString());
        Assert.Equal("warning", latest.GetProperty("severity").GetString());
        Assert.Equal(context.DeviceId, latest.GetProperty("sessionId").GetString());
        Assert.Contains("result=rejected", latest.GetProperty("details").GetString());
    }

    [Fact]
    public async Task HighRiskActions_DeleteDevice_RequiresConfirmAndAllowsConfirmedDelete()
    {
        var manager = await AuthTestHelper.CreateAuthorizedClientContextAsync(
            _factory,
            permissions: [Permission.ManageDevices]);
        var target = await AuthTestHelper.CreateAuthorizedClientContextAsync(
            _factory,
            permissions: [Permission.ViewWindow]);

        var rejected = await manager.Client.DeleteAsync($"/api/v1/devices/{target.DeviceId}");
        Assert.Equal(HttpStatusCode.Conflict, rejected.StatusCode);
        var rejectedRoot = await ReadJsonAsync(rejected);
        AssertErrorCode(rejectedRoot, "E_CONFIRM_REQUIRED");

        var approved = await manager.Client.SendAsync(new HttpRequestMessage(
            HttpMethod.Delete,
            $"/api/v1/devices/{target.DeviceId}")
        {
            Content = CreateJsonContent(new { confirmHighRisk = true })
        });
        Assert.Equal(HttpStatusCode.OK, approved.StatusCode);
        using (var approvedDocument = JsonDocument.Parse(await approved.Content.ReadAsStringAsync()))
        {
            Assert.True(approvedDocument.RootElement.GetProperty("ok").GetBoolean());
            Assert.True(approvedDocument.RootElement.GetProperty("deleted").GetBoolean());
        }

        var logs = await manager.Client.GetAsync(
            $"/api/v1/logs?page=1&pageSize=20&action=device.delete.completed&sessionId={manager.DeviceId}");
        Assert.Equal(HttpStatusCode.OK, logs.StatusCode);
        var logsRoot = await ReadJsonAsync(logs);
        var items = logsRoot.GetProperty("items");
        Assert.True(items.GetArrayLength() >= 1);
        var latest = items[0];
        Assert.Equal("device.delete.completed", latest.GetProperty("action").GetString());
        Assert.Equal(manager.DeviceId, latest.GetProperty("sessionId").GetString());
        var details = latest.GetProperty("details").GetString() ?? string.Empty;
        Assert.Contains($"target={target.DeviceId}", details);
        Assert.Contains("result=deleted", details);
    }

    [Fact]
    public async Task HighRiskActions_SettingsPatch_RequiresConfirmAndWritesAudit()
    {
        var context = await AuthTestHelper.CreateAuthorizedClientContextAsync(
            _factory,
            permissions: [Permission.ManageAgent]);
        var currentSettings = await context.Client.GetAsync("/api/v1/settings");
        Assert.Equal(HttpStatusCode.OK, currentSettings.StatusCode);
        var currentRoot = await ReadJsonAsync(currentSettings);
        var currentPort = currentRoot.GetProperty("agentSettings").GetProperty("httpPort").GetInt32();
        var nextPort = currentPort == 65535 ? 65534 : currentPort + 1;

        var rejected = await context.Client.PatchAsync(
            "/api/v1/settings",
            CreateJsonContent(new
            {
                agentSettings = new
                {
                    httpPort = nextPort
                },
                confirmHighRisk = false
            }));
        Assert.Equal(HttpStatusCode.Conflict, rejected.StatusCode);
        AssertErrorCode(await ReadJsonAsync(rejected), "E_SETTINGS_CONFIRM_REQUIRED");

        var applied = await context.Client.PatchAsync(
            "/api/v1/settings",
            CreateJsonContent(new
            {
                agentSettings = new
                {
                    httpPort = nextPort
                },
                confirmHighRisk = true
            }));
        Assert.Equal(HttpStatusCode.OK, applied.StatusCode);

        var rejectedLogs = await context.Client.GetAsync(
            $"/api/v1/logs?page=1&pageSize=20&severity=warning&action=settings.patch.rejected&sessionId={context.DeviceId}");
        Assert.Equal(HttpStatusCode.OK, rejectedLogs.StatusCode);
        var rejectedLogRoot = await ReadJsonAsync(rejectedLogs);
        Assert.True(rejectedLogRoot.GetProperty("items").GetArrayLength() >= 1);
        Assert.Contains(
            "result=rejected",
            rejectedLogRoot.GetProperty("items")[0].GetProperty("details").GetString());

        var appliedLogs = await context.Client.GetAsync(
            $"/api/v1/logs?page=1&pageSize=20&action=settings.patch.applied&sessionId={context.DeviceId}");
        Assert.Equal(HttpStatusCode.OK, appliedLogs.StatusCode);
        var appliedLogRoot = await ReadJsonAsync(appliedLogs);
        Assert.True(appliedLogRoot.GetProperty("items").GetArrayLength() >= 1);
        Assert.Contains(
            "result=applied",
            appliedLogRoot.GetProperty("items")[0].GetProperty("details").GetString());
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
