using System.Net;
using System.Text;
using System.Text.Json;
using Ceryx.Agent.Core;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Ceryx.Agent.Tests;

public sealed class ProjectWorkspaceApiTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public ProjectWorkspaceApiTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task ProjectFilesEndpoint_ReturnsLiteFileIndex()
    {
        var client = await AuthTestHelper.CreateAuthorizedClientAsync(
            _factory,
            permissions: [Permission.ReadDiff]);

        var response = await client.GetAsync("/api/v1/project/files?projectId=workspace-default&limit=80");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;
        Assert.True(root.GetProperty("ok").GetBoolean());
        Assert.Equal("workspace-default", root.GetProperty("projectId").GetString());
        Assert.True(root.TryGetProperty("files", out var files));
        Assert.Equal(JsonValueKind.Array, files.ValueKind);
    }

    [Fact]
    public async Task ProjectFilesEndpoint_RequiresReadDiffPermission()
    {
        var client = await AuthTestHelper.CreateAuthorizedClientAsync(
            _factory,
            permissions: [Permission.ViewWindow]);

        var response = await client.GetAsync("/api/v1/project/files?projectId=workspace-default");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(
            "E_PERMISSION_DENIED",
            document.RootElement.GetProperty("error").GetProperty("code").GetString());
    }

    [Fact]
    public async Task ProjectTasksEndpoint_TracksLatestTestRequestFromAudit()
    {
        var client = await AuthTestHelper.CreateAuthorizedClientAsync(
            _factory,
            permissions: [Permission.RunTest, Permission.SendPrompt]);

        var payload = new StringContent(
            JsonSerializer.Serialize(new ProjectTestRequestBody("changed-modules")),
            Encoding.UTF8,
            "application/json");
        var requestResponse = await client.PostAsync("/api/v1/project/test-request", payload);
        Assert.Equal(HttpStatusCode.OK, requestResponse.StatusCode);

        var tasksResponse = await client.GetAsync("/api/v1/project/tasks?promptLimit=6");
        Assert.Equal(HttpStatusCode.OK, tasksResponse.StatusCode);
        using var document = JsonDocument.Parse(await tasksResponse.Content.ReadAsStringAsync());
        var root = document.RootElement;
        Assert.True(root.GetProperty("ok").GetBoolean());
        Assert.Equal("accepted", root.GetProperty("testRequest").GetProperty("status").GetString());
        Assert.False(string.IsNullOrWhiteSpace(
            root.GetProperty("testRequest").GetProperty("requestId").GetString()));
    }

    [Fact]
    public async Task NotificationsEndpoints_SupportReadAndClearFlow()
    {
        var client = await AuthTestHelper.CreateAuthorizedClientAsync(
            _factory,
            permissions: [Permission.RunTest]);

        var payload = new StringContent(
            JsonSerializer.Serialize(new ProjectTestRequestBody("changed-modules")),
            Encoding.UTF8,
            "application/json");
        _ = await client.PostAsync("/api/v1/project/test-request", payload);

        var listResponse = await client.GetAsync("/api/v1/notifications?limit=30");
        Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);

        using var listDocument = JsonDocument.Parse(await listResponse.Content.ReadAsStringAsync());
        var items = listDocument.RootElement.GetProperty("items");
        Assert.True(items.GetArrayLength() > 0);
        var firstId = items[0].GetProperty("id").GetString();
        Assert.False(string.IsNullOrWhiteSpace(firstId));

        var readResponse = await client.PostAsync($"/api/v1/notifications/{firstId}/read", content: null);
        Assert.Equal(HttpStatusCode.OK, readResponse.StatusCode);

        var clearResponse = await client.PostAsync("/api/v1/notifications/clear", content: null);
        Assert.Equal(HttpStatusCode.OK, clearResponse.StatusCode);

        var afterClearResponse = await client.GetAsync("/api/v1/notifications?limit=30");
        Assert.Equal(HttpStatusCode.OK, afterClearResponse.StatusCode);
        using var afterClearDocument = JsonDocument.Parse(await afterClearResponse.Content.ReadAsStringAsync());
        Assert.Equal(0, afterClearDocument.RootElement.GetProperty("unread").GetInt32());
    }
}
