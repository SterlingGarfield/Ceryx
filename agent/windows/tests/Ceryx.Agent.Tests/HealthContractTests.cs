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
        AssertValidTraceId(response);

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
        AssertValidTraceId(response);

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

    [Fact]
    public async Task AgentPathsEndpoint_ReturnsContractPayload()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/v1/agent/paths");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertValidTraceId(response);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;

        var rootPath = root.GetProperty("root").GetString();
        Assert.False(string.IsNullOrWhiteSpace(rootPath));
        Assert.True(Path.IsPathRooted(rootPath));

        var fullRootPath = Path.GetFullPath(rootPath!);
        if (OperatingSystem.IsWindows())
        {
            Assert.False(fullRootPath.StartsWith("C:\\", StringComparison.OrdinalIgnoreCase));
        }

        var repoRoot = Environment.GetEnvironmentVariable("CERYX_REPO_ROOT");
        if (!string.IsNullOrWhiteSpace(repoRoot))
        {
            var fullRepoRoot = Path.GetFullPath(repoRoot)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                + Path.DirectorySeparatorChar;
            var normalizedRoot = fullRootPath.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                + Path.DirectorySeparatorChar;
            Assert.StartsWith(fullRepoRoot, normalizedRoot, StringComparison.OrdinalIgnoreCase);
        }

        Assert.Equal(Path.Combine(rootPath!, "Logs"), root.GetProperty("logs").GetString());
        Assert.Equal(Path.Combine(rootPath, "Uploads"), root.GetProperty("uploads").GetString());
        Assert.Equal(Path.Combine(rootPath, "Screenshots"), root.GetProperty("screenshots").GetString());
        Assert.Equal(Path.Combine(rootPath, "Recordings"), root.GetProperty("recordings").GetString());
        Assert.Equal(Path.Combine(rootPath, "ceryx.db"), root.GetProperty("database").GetString());
    }

    [Fact]
    public async Task NotFoundRoute_IncludesTraceIdHeader()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/v1/not-found");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        AssertValidTraceId(response);
    }

    private static void AssertValidTraceId(HttpResponseMessage response)
    {
        Assert.True(response.Headers.TryGetValues("X-Trace-Id", out var values));

        var traceId = Assert.Single(values);
        Assert.StartsWith("trace_", traceId);
        Assert.True(traceId.Length > "trace_".Length);
    }
}
