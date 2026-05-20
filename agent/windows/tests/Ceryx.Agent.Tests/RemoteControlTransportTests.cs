using System.Net;
using System.Text;
using System.Text.Json;
using Ceryx.Agent.Core;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Ceryx.Agent.Tests;

public sealed class RemoteControlTransportTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public RemoteControlTransportTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task CaptureStart_RejectsFullDesktopByPolicy()
    {
        var client = await AuthTestHelper.CreateAuthorizedClientAsync(
            _factory,
            permissions: [Permission.ViewWindow]);

        var payload = new StringContent(
            JsonSerializer.Serialize(new CaptureStartBody("balanced", "full_desktop")),
            Encoding.UTF8,
            "application/json");
        var response = await client.PostAsync("/api/v1/capture/start", payload);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;
        Assert.Equal("E_CAPTURE_DENIED", root.GetProperty("error").GetProperty("code").GetString());
    }
}
