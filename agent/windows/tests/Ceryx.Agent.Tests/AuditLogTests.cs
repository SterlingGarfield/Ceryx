using System.Net;
using System.Text.Json;
using Ceryx.Agent.Core;
using Ceryx.Agent.Storage.Audit;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Ceryx.Agent.Tests;

public sealed class AuditLogTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public AuditLogTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task QueryAsync_AppliesSeverityActionSessionFiltersAndPagination()
    {
        var sessionId = "session_" + Guid.NewGuid().ToString("N");

        using var scope = _factory.Services.CreateScope();
        var store = scope.ServiceProvider.GetRequiredService<IAuditLogStore>();
        await store.WriteAsync("prompt.send.accepted", "submitted=true", "info", sessionId);
        await store.WriteAsync("input.rejected", "reason=minimized", "warning", sessionId);
        await store.WriteAsync("input.rejected", "reason=blocked", "warning", sessionId);

        var page1 = await store.QueryAsync(new AuditLogQuery(
            Page: 1,
            PageSize: 1,
            Severity: "warning",
            Action: "input.rejected",
            SessionId: sessionId));

        Assert.Equal(1, page1.Page);
        Assert.Equal(1, page1.PageSize);
        Assert.True(page1.HasMore);
        Assert.Equal(2, page1.Total);
        Assert.Single(page1.Items);
        Assert.All(page1.Items, item =>
        {
            Assert.Equal("warning", item.Severity);
            Assert.Equal("input.rejected", item.Action);
            Assert.Equal(sessionId, item.SessionId);
        });

        var page2 = await store.QueryAsync(new AuditLogQuery(
            Page: 2,
            PageSize: 1,
            Severity: "warning",
            Action: "input.rejected",
            SessionId: sessionId));

        Assert.Equal(2, page2.Page);
        Assert.Single(page2.Items);
        Assert.False(page2.HasMore);
    }

    [Fact]
    public async Task GetLogsRoute_ReturnsFilteredPagedItems()
    {
        var sessionId = "session_" + Guid.NewGuid().ToString("N");
        var marker = "audit-marker-" + Guid.NewGuid().ToString("N");

        using (var scope = _factory.Services.CreateScope())
        {
            var store = scope.ServiceProvider.GetRequiredService<IAuditLogStore>();
            await store.WriteAsync("prompt.send.accepted", marker, "info", sessionId);
            await store.WriteAsync("input.rejected", marker, "warning", sessionId);
        }

        var client = await AuthTestHelper.CreateAuthorizedClientAsync(
            _factory,
            permissions: [Permission.ViewWindow]);

        var response = await client.GetAsync(
            $"/api/v1/logs?page=1&pageSize=20&severity=warning&action=input.rejected&sessionId={sessionId}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.TryGetValues("X-Trace-Id", out _));

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;
        Assert.True(root.GetProperty("ok").GetBoolean());
        Assert.Equal(1, root.GetProperty("page").GetInt32());
        Assert.Equal(20, root.GetProperty("pageSize").GetInt32());

        var items = root.GetProperty("items").EnumerateArray().ToArray();
        Assert.NotEmpty(items);
        Assert.All(items, item =>
        {
            Assert.Equal("warning", item.GetProperty("severity").GetString());
            Assert.Equal("input.rejected", item.GetProperty("action").GetString());
            Assert.Equal(sessionId, item.GetProperty("sessionId").GetString());
        });
        Assert.Contains(items, item => item.GetProperty("details").GetString() == marker);
    }

    [Fact]
    public async Task GetLogsRoute_ReturnsBadRequestForInvalidSeverity()
    {
        var client = await AuthTestHelper.CreateAuthorizedClientAsync(
            _factory,
            permissions: [Permission.ViewWindow]);

        var response = await client.GetAsync("/api/v1/logs?severity=fatal");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;
        Assert.False(root.GetProperty("ok").GetBoolean());
        Assert.Equal(
            "E_LOGS_INVALID_REQUEST",
            root.GetProperty("error").GetProperty("code").GetString());
    }

    [Fact]
    public async Task PerformancePolicy_GetLogsRoute_RejectsInvalidPageBounds()
    {
        var client = await AuthTestHelper.CreateAuthorizedClientAsync(
            _factory,
            permissions: [Permission.ViewWindow]);

        var response = await client.GetAsync("/api/v1/logs?page=0&pageSize=500");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;
        Assert.False(root.GetProperty("ok").GetBoolean());
        Assert.Equal(
            "E_LOGS_INVALID_REQUEST",
            root.GetProperty("error").GetProperty("code").GetString());
    }
}
