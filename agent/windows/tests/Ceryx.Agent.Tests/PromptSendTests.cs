using System.Net;
using System.Text;
using System.Text.Json;
using Ceryx.Agent.Core;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Ceryx.Agent.Tests;

public sealed class PromptSendTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public PromptSendTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task PromptSend_RejectsMissingPermission()
    {
        var client = await AuthTestHelper.CreateAuthorizedClientAsync(
            _factory,
            permissions: [Permission.ViewWindow]);

        var payload = new StringContent(
            JsonSerializer.Serialize(new PromptSendBody("hello", true)),
            Encoding.UTF8,
            "application/json");
        var response = await client.PostAsync("/api/v1/prompt/send", payload);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;
        Assert.Equal("E_PERMISSION_DENIED", root.GetProperty("error").GetProperty("code").GetString());
    }
}
