using System.Net;
using System.Text;
using System.Text.Json;
using Ceryx.Agent.Core;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Ceryx.Agent.Tests;

public sealed class SettingsTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public SettingsTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task GetSettings_ReturnsAgentAndClientSections()
    {
        var client = await AuthTestHelper.CreateAuthorizedClientAsync(
            _factory,
            permissions: [Permission.ViewWindow]);

        var response = await client.GetAsync("/api/v1/settings");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;
        Assert.True(root.GetProperty("ok").GetBoolean());
        Assert.True(root.TryGetProperty("agentSettings", out _));
        Assert.True(root.TryGetProperty("clientSettings", out _));
    }

    [Fact]
    public async Task PatchSettings_RequiresConfirmForHighRiskKeys()
    {
        var client = await AuthTestHelper.CreateAuthorizedClientAsync(
            _factory,
            permissions: [Permission.ManageAgent]);
        var uniqueCommand = $"dotnet test --filter confirm-required-{Guid.NewGuid():N}";

        var payload = new StringContent(
            JsonSerializer.Serialize(new SettingsPatchBody(
                AgentSettings: new AgentSettingsPatchBody(
                    HttpPort: null,
                    DirectTestCommand: uniqueCommand,
                    AllowFullscreenCapture: null,
                    AllowClearLogs: null,
                    DefaultCaptureMode: null),
                ConfirmHighRisk: false)),
            Encoding.UTF8,
            "application/json");

        var response = await client.PatchAsync("/api/v1/settings", payload);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;
        Assert.False(root.GetProperty("ok").GetBoolean());
        Assert.Equal(
            "E_SETTINGS_CONFIRM_REQUIRED",
            root.GetProperty("error").GetProperty("code").GetString());
    }

    [Fact]
    public async Task PatchSettings_AppliesWhenHighRiskIsConfirmed()
    {
        var client = await AuthTestHelper.CreateAuthorizedClientAsync(
            _factory,
            permissions: [Permission.ManageAgent]);

        var payload = new StringContent(
            JsonSerializer.Serialize(new SettingsPatchBody(
                AgentSettings: new AgentSettingsPatchBody(
                    HttpPort: 41528,
                    DirectTestCommand: "dotnet test agent/windows/Ceryx.Agent.Windows.sln --filter Settings",
                    AllowFullscreenCapture: true,
                    AllowClearLogs: true,
                    DefaultCaptureMode: "high_quality"),
                ConfirmHighRisk: true)),
            Encoding.UTF8,
            "application/json");

        var response = await client.PatchAsync("/api/v1/settings", payload);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;
        Assert.True(root.GetProperty("ok").GetBoolean());

        var agentSettings = root.GetProperty("agentSettings");
        Assert.Equal(41528, agentSettings.GetProperty("httpPort").GetInt32());
        Assert.True(agentSettings.GetProperty("allowFullscreenCapture").GetBoolean());
        Assert.True(agentSettings.GetProperty("allowClearLogs").GetBoolean());
        Assert.Equal(
            "dotnet test agent/windows/Ceryx.Agent.Windows.sln --filter Settings",
            agentSettings.GetProperty("directTestCommand").GetString());
    }

    [Fact]
    public async Task PatchSettings_RejectsWithoutManageAgentPermission()
    {
        var client = await AuthTestHelper.CreateAuthorizedClientAsync(
            _factory,
            permissions: [Permission.ViewWindow]);

        var payload = new StringContent(
            JsonSerializer.Serialize(new SettingsPatchBody(
                AgentSettings: new AgentSettingsPatchBody(
                    HttpPort: null,
                    DirectTestCommand: null,
                    AllowFullscreenCapture: true,
                    AllowClearLogs: null,
                    DefaultCaptureMode: null),
                ConfirmHighRisk: true)),
            Encoding.UTF8,
            "application/json");

        var response = await client.PatchAsync("/api/v1/settings", payload);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;
        Assert.Equal(
            "E_PERMISSION_DENIED",
            root.GetProperty("error").GetProperty("code").GetString());
    }
}
