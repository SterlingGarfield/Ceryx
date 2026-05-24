using System.Net.Http.Headers;
using Ceryx.Agent.Core;
using Ceryx.Agent.Security.Devices;
using Ceryx.Agent.Security.Tokens;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace Ceryx.Agent.Tests;

internal static class AuthTestHelper
{
    internal sealed record AuthorizedClientContext(HttpClient Client, string DeviceId, string Token);

    public static async Task<HttpClient> CreateAuthorizedClientAsync(
        WebApplicationFactory<Program> factory,
        IReadOnlyList<Permission> permissions,
        string clientType = "desktop",
        string platform = "windows",
        string? tokenOverride = null)
    {
        var context = await CreateAuthorizedClientContextAsync(
            factory,
            permissions,
            clientType,
            platform,
            tokenOverride);
        return context.Client;
    }

    public static async Task<AuthorizedClientContext> CreateAuthorizedClientContextAsync(
        WebApplicationFactory<Program> factory,
        IReadOnlyList<Permission> permissions,
        string clientType = "desktop",
        string platform = "windows",
        string? tokenOverride = null)
    {
        var token = tokenOverride ?? $"dt_test_{Guid.NewGuid():N}";
        var deviceId = $"dev_test_{Guid.NewGuid():N}";

        using var scope = factory.Services.CreateScope();
        var store = scope.ServiceProvider.GetRequiredService<ITrustedDeviceStore>();
        var hasher = scope.ServiceProvider.GetRequiredService<IDeviceTokenHasher>();

        await store.AddAsync(new TrustedDeviceRecord(
            DeviceId: deviceId,
            Name: "test-device",
            Platform: platform,
            ClientType: clientType,
            TokenHash: hasher.Hash(token),
            Permissions: permissions,
            CreatedAt: DateTimeOffset.UtcNow));

        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return new AuthorizedClientContext(client, deviceId, token);
    }
}
