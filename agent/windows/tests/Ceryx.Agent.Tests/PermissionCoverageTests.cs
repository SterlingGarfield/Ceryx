using System.Net;
using System.Text;
using System.Text.Json;
using Ceryx.Agent.Core;
using Ceryx.Agent.Network;
using Ceryx.Agent.Storage.Sqlite;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Ceryx.Agent.Tests;

public sealed class PermissionCoverageTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public PermissionCoverageTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory;
    }

    [Fact]
    public void PermissionCoverage_AllApiRoutesHaveMatrixAndMetadata()
    {
        using var scope = _factory.Services.CreateScope();
        var dataSources = scope.ServiceProvider.GetServices<EndpointDataSource>();

        var routeEndpoints = dataSources
            .SelectMany(static source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Where(static endpoint =>
                endpoint.RoutePattern.RawText?.StartsWith("/api/v1/", StringComparison.OrdinalIgnoreCase) is true)
            .ToArray();

        var actual = new List<(string Method, string Path)>();
        foreach (var endpoint in routeEndpoints)
        {
            var path = endpoint.RoutePattern.RawText ?? string.Empty;
            var httpMethods = endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods;
            Assert.NotNull(httpMethods);
            Assert.NotEmpty(httpMethods!);

            var authMetadata = endpoint.Metadata.GetMetadata<AgentAuthorizationMetadata>();
            Assert.NotNull(authMetadata);

            foreach (var method in httpMethods!)
            {
                actual.Add((method, path));
                Assert.True(
                    AgentRoutePermissionMatrix.TryFind(method, path, out var matrixEntry),
                    $"Route missing from permission matrix: {method} {path}");

                Assert.NotNull(matrixEntry);
                Assert.Equal(authMetadata!.AllowAnonymous, matrixEntry!.AllowAnonymous);
                Assert.Equal(authMetadata.RequiredPermission, matrixEntry.RequiredPermission);

                var localOnly = endpoint.Metadata.GetMetadata<AgentLocalOnlyMetadata>()?.Enabled ?? false;
                Assert.Equal(matrixEntry.LocalOnly, localOnly);
            }
        }

        var actualKeys = actual
            .Distinct()
            .OrderBy(static item => item.Method, StringComparer.Ordinal)
            .ThenBy(static item => item.Path, StringComparer.Ordinal)
            .ToArray();
        var matrixKeys = AgentRoutePermissionMatrix.Entries
            .Select(static item => (item.Method, item.Path))
            .Distinct()
            .OrderBy(static item => item.Method, StringComparer.Ordinal)
            .ThenBy(static item => item.Path, StringComparer.Ordinal)
            .ToArray();

        Assert.Equal(matrixKeys, actualKeys);
    }

    [Theory]
    [MemberData(nameof(LocalOnlyEndpointCases))]
    public async Task PermissionCoverage_LocalOnlyEndpointsRejectRemoteRequests(
        string method,
        string path,
        bool allowAnonymous,
        Permission? requiredPermission)
    {
        var client = allowAnonymous
            ? _factory.CreateClient()
            : await AuthTestHelper.CreateAuthorizedClientAsync(
                _factory,
                permissions: [requiredPermission ?? Permission.ManageAgent]);

        using var request = new HttpRequestMessage(new HttpMethod(method), path);
        request.Headers.Add("X-Forwarded-For", "192.168.10.20");
        if (HttpMethods.IsPost(method) || HttpMethods.IsPatch(method))
        {
            request.Content = new StringContent("{}", System.Text.Encoding.UTF8, "application/json");
        }

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.True(response.Headers.TryGetValues("X-Trace-Id", out _));

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;
        Assert.False(root.GetProperty("ok").GetBoolean());
        Assert.Equal("E_PERMISSION_DENIED", root.GetProperty("error").GetProperty("code").GetString());
    }

    [Fact]
    public async Task PermissionCoverage_DeletingTrustedDeviceInvalidatesTokenAndSessions()
    {
        var manager = await AuthTestHelper.CreateAuthorizedClientContextAsync(
            _factory,
            permissions: [Permission.ManageDevices]);
        var target = await AuthTestHelper.CreateAuthorizedClientContextAsync(
            _factory,
            permissions: [Permission.ViewWindow, Permission.SendPrompt]);

        var initialStatus = await target.Client.GetAsync("/api/v1/agent/status");
        Assert.Equal(HttpStatusCode.OK, initialStatus.StatusCode);

        await InsertSessionAsync(target.DeviceId);
        Assert.Equal(1, await CountSessionsAsync(target.DeviceId));

        var deleteRequest = new HttpRequestMessage(HttpMethod.Delete, $"/api/v1/devices/{target.DeviceId}")
        {
            Content = new StringContent(
                JsonSerializer.Serialize(new { confirmHighRisk = true }),
                Encoding.UTF8,
                "application/json")
        };
        var deleteResponse = await manager.Client.SendAsync(deleteRequest);
        Assert.Equal(HttpStatusCode.OK, deleteResponse.StatusCode);

        using (var deleteDocument = JsonDocument.Parse(await deleteResponse.Content.ReadAsStringAsync()))
        {
            Assert.True(deleteDocument.RootElement.GetProperty("ok").GetBoolean());
            Assert.True(deleteDocument.RootElement.GetProperty("deleted").GetBoolean());
        }

        var postDeleteStatus = await target.Client.GetAsync("/api/v1/agent/status");
        Assert.Equal(HttpStatusCode.Unauthorized, postDeleteStatus.StatusCode);
        using (var unauthorizedDocument = JsonDocument.Parse(await postDeleteStatus.Content.ReadAsStringAsync()))
        {
            Assert.False(unauthorizedDocument.RootElement.GetProperty("ok").GetBoolean());
            Assert.Equal("E_TOKEN_INVALID", unauthorizedDocument.RootElement.GetProperty("error").GetProperty("code").GetString());
        }

        Assert.Equal(0, await CountSessionsAsync(target.DeviceId));
    }

    public static IEnumerable<object?[]> LocalOnlyEndpointCases()
    {
        foreach (var route in AgentRoutePermissionMatrix.Entries.Where(static entry => entry.LocalOnly))
        {
            yield return [route.Method, route.Path, route.AllowAnonymous, route.RequiredPermission];
        }
    }

    private async Task InsertSessionAsync(string deviceId)
    {
        using var scope = _factory.Services.CreateScope();
        var connectionFactory = scope.ServiceProvider.GetRequiredService<SqliteConnectionFactory>();
        await using var connection = await connectionFactory.OpenConnectionAsync();
        var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO remote_sessions (id, controller_device_id, started_at)
            VALUES ($id, $deviceId, $startedAt);
            """;
        command.Parameters.AddWithValue("$id", "sess_" + Guid.NewGuid().ToString("N"));
        command.Parameters.AddWithValue("$deviceId", deviceId);
        command.Parameters.AddWithValue("$startedAt", DateTimeOffset.UtcNow.ToString("O"));
        await command.ExecuteNonQueryAsync();
    }

    private async Task<long> CountSessionsAsync(string deviceId)
    {
        using var scope = _factory.Services.CreateScope();
        var connectionFactory = scope.ServiceProvider.GetRequiredService<SqliteConnectionFactory>();
        await using var connection = await connectionFactory.OpenConnectionAsync();
        var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(1) FROM remote_sessions WHERE controller_device_id = $deviceId;";
        command.Parameters.AddWithValue("$deviceId", deviceId);
        var value = await command.ExecuteScalarAsync();
        return value is long count ? count : Convert.ToInt64(value);
    }
}
