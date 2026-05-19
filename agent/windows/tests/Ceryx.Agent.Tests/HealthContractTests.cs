using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Ceryx.Agent.Tests;

public class HealthContractTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public HealthContractTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task HealthEndpoint_ReturnsRequiredPayload()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/v1/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;

        Assert.True(root.GetProperty("ok").GetBoolean());
        Assert.Equal("ceryx-agent", root.GetProperty("service").GetString());
        Assert.Equal("0.3.0", root.GetProperty("version").GetString());
    }

    [Fact]
    public async Task AgentStatusEndpoint_ReturnsContractPayload()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/v1/agent/status");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;

        Assert.Equal("0.3.0", root.GetProperty("agentVersion").GetString());
        Assert.Equal("Local Windows PC", root.GetProperty("deviceName").GetString());
        Assert.Equal("windows", root.GetProperty("platform").GetString());
        Assert.Equal("running", root.GetProperty("status").GetString());
        Assert.Equal(41527, root.GetProperty("httpPort").GetInt32());
        Assert.False(root.GetProperty("supportsWebRTC").GetBoolean());
        Assert.True(root.GetProperty("supportsDesktopClient").GetBoolean());
        Assert.Equal("not_found", root.GetProperty("codexStatus").GetString());
    }
}
