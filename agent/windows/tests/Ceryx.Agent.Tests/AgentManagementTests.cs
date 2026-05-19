using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Ceryx.Agent.Tests;

public class AgentManagementTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public AgentManagementTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task PauseAndResumeControl_UpdatesAgentStatus()
    {
        var client = _factory.CreateClient();

        var pauseResponse = await client.PostAsync("/api/v1/agent/pause-control", content: null);
        Assert.Equal(HttpStatusCode.OK, pauseResponse.StatusCode);

        using (var pauseDocument = JsonDocument.Parse(await pauseResponse.Content.ReadAsStringAsync()))
        {
            var pauseRoot = pauseDocument.RootElement;
            Assert.True(pauseRoot.GetProperty("ok").GetBoolean());
            Assert.Equal("pause-control", pauseRoot.GetProperty("action").GetString());
            Assert.Equal("applied", pauseRoot.GetProperty("status").GetString());
            Assert.True(pauseRoot.GetProperty("executed").GetBoolean());
        }

        var pausedStatusResponse = await client.GetAsync("/api/v1/agent/status");
        Assert.Equal(HttpStatusCode.OK, pausedStatusResponse.StatusCode);
        using (var pausedStatusDocument = JsonDocument.Parse(await pausedStatusResponse.Content.ReadAsStringAsync()))
        {
            Assert.Equal("paused", pausedStatusDocument.RootElement.GetProperty("status").GetString());
        }

        var resumeResponse = await client.PostAsync("/api/v1/agent/resume-control", content: null);
        Assert.Equal(HttpStatusCode.OK, resumeResponse.StatusCode);

        var runningStatusResponse = await client.GetAsync("/api/v1/agent/status");
        Assert.Equal(HttpStatusCode.OK, runningStatusResponse.StatusCode);
        using var runningStatusDocument = JsonDocument.Parse(await runningStatusResponse.Content.ReadAsStringAsync());
        Assert.Equal("running", runningStatusDocument.RootElement.GetProperty("status").GetString());
    }

    [Fact]
    public async Task RestartRequest_ReturnsAcceptedButNotExecuted()
    {
        var client = _factory.CreateClient();
        var response = await client.PostAsync("/api/v1/agent/restart-request", content: null);

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.True(response.Headers.TryGetValues("X-Trace-Id", out _));

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;

        Assert.True(root.GetProperty("ok").GetBoolean());
        Assert.Equal("restart-request", root.GetProperty("action").GetString());
        Assert.Equal("accepted", root.GetProperty("status").GetString());
        Assert.False(root.GetProperty("executed").GetBoolean());
    }

    [Fact]
    public async Task OpenLogsFolder_AllowsLocalRequest()
    {
        var client = _factory.CreateClient();
        var response = await client.PostAsync("/api/v1/agent/open-logs-folder", content: null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.TryGetValues("X-Trace-Id", out _));

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;
        Assert.True(root.GetProperty("ok").GetBoolean());
        Assert.Equal("open-logs-folder", root.GetProperty("action").GetString());
        Assert.True(root.GetProperty("executed").GetBoolean());
    }

    [Fact]
    public async Task LocalManagementEndpoints_RejectRemoteOriginRequests()
    {
        var client = _factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/agent/pause-control");
        request.Headers.Add("X-Forwarded-For", "203.0.113.10");

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.True(response.Headers.TryGetValues("X-Trace-Id", out _));

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;
        Assert.False(root.GetProperty("ok").GetBoolean());
        Assert.Equal("E_PERMISSION_DENIED", root.GetProperty("error").GetProperty("code").GetString());
        Assert.False(string.IsNullOrWhiteSpace(root.GetProperty("error").GetProperty("traceId").GetString()));
    }
}
