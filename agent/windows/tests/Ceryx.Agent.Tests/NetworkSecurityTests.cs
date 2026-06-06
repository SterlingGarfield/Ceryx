using System.Net;
using System.Text;
using System.Text.Json;
using Ceryx.Agent.Network;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Xunit;

namespace Ceryx.Agent.Tests;

public sealed class NetworkSecurityTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public NetworkSecurityTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task NetworkSecurity_RejectsUnknownOriginByDefault()
    {
        var client = await AuthTestHelper.CreateAuthorizedClientAsync(
            _factory,
            permissions: [Ceryx.Agent.Core.Permission.ViewWindow]);
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/agent/status");
        request.Headers.Authorization = client.DefaultRequestHeaders.Authorization;
        request.Headers.Add("Origin", "https://evil.example.com");

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.True(response.Headers.TryGetValues("X-Trace-Id", out _));
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("E_ORIGIN_DENIED", document.RootElement.GetProperty("error").GetProperty("code").GetString());
    }

    [Fact]
    public async Task NetworkSecurity_AllowsLanOrigin()
    {
        var client = await AuthTestHelper.CreateAuthorizedClientAsync(
            _factory,
            permissions: [Ceryx.Agent.Core.Permission.ViewWindow]);
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/agent/status");
        request.Headers.Authorization = client.DefaultRequestHeaders.Authorization;
        request.Headers.Add("Origin", "http://192.168.1.22:5173");

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task NetworkSecurity_RejectsPublicSourceAddress()
    {
        var client = await AuthTestHelper.CreateAuthorizedClientAsync(
            _factory,
            permissions: [Ceryx.Agent.Core.Permission.ViewWindow]);
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/agent/status");
        request.Headers.Authorization = client.DefaultRequestHeaders.Authorization;
        request.Headers.Add("X-Forwarded-For", "203.0.113.10");

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.True(response.Headers.TryGetValues("X-Trace-Id", out _));
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("E_NETWORK_DENIED", document.RootElement.GetProperty("error").GetProperty("code").GetString());
    }

    [Fact]
    public async Task NetworkSecurity_WebSocketUpgradeRequiresToken()
    {
        var client = _factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/capture/state");
        request.Headers.Add("Connection", "Upgrade");
        request.Headers.Add("Upgrade", "websocket");

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.True(response.Headers.TryGetValues("X-Trace-Id", out _));
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("E_NOT_PAIRED", document.RootElement.GetProperty("error").GetProperty("code").GetString());
    }

    [Fact]
    public async Task NetworkSecurity_PairingRateLimiterBlocksSecondAttemptPerKey()
    {
        var limiter = new InMemoryPairingRateLimiterForTests(limit: 1, window: TimeSpan.FromMinutes(1));
        var key = "192.168.10.99";
        var now = DateTimeOffset.UtcNow;

        var first = limiter.TryAcquire(key, now, out var firstRetryAfter);
        var second = limiter.TryAcquire(key, now.AddSeconds(1), out var secondRetryAfter);

        Assert.True(first);
        Assert.Equal(TimeSpan.Zero, firstRetryAfter);
        Assert.False(second);
        Assert.True(secondRetryAfter > TimeSpan.Zero);
    }

    [Fact]
    public async Task NetworkSecurity_PairingEndpointReturns429WhenRateLimiterDenies()
    {
        using var deniedFactory = _factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IPairingRateLimiter>();
                services.AddSingleton<IPairingRateLimiter>(new AlwaysDenyPairingRateLimiter(TimeSpan.FromSeconds(9)));
            });
        });

        var client = deniedFactory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/pairing/request");
        request.Headers.Add("X-Forwarded-For", "192.168.10.99");
        request.Content = new StringContent(
            "{\"clientName\":\"ipad-test\",\"clientType\":\"ipad\",\"platform\":\"ios\"}",
            Encoding.UTF8,
            "application/json");

        var response = await client.SendAsync(request);
        var raw = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
        Assert.True(response.Headers.TryGetValues("Retry-After", out var retryAfterValues));
        Assert.True(int.TryParse(retryAfterValues.Single(), out var retryAfterSeconds));
        Assert.True(retryAfterSeconds >= 1);
        Assert.True(response.Headers.TryGetValues("X-Trace-Id", out _));
        using var document = JsonDocument.Parse(raw);
        Assert.Equal("E_PAIRING_RATE_LIMITED", document.RootElement.GetProperty("error").GetProperty("code").GetString());
    }

    [Fact]
    public async Task NetworkSecurity_CertificateFingerprintEndpointReturnsSha256Fingerprint()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/api/v1/agent/cert-fingerprint");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var fingerprint = document.RootElement.GetProperty("fingerprint").GetString();
        Assert.NotNull(fingerprint);
        Assert.Matches("^[A-F0-9]{64}$", fingerprint!);
    }

    [Fact]
    public async Task NetworkSecurity_RegenerateCertificateEndpointRotatesFingerprint()
    {
        var client = await AuthTestHelper.CreateAuthorizedClientAsync(
            _factory,
            permissions: [Ceryx.Agent.Core.Permission.ManageAgent]);

        var beforeResponse = await client.GetAsync("/api/v1/agent/cert-fingerprint");
        Assert.Equal(HttpStatusCode.OK, beforeResponse.StatusCode);
        using var beforeDocument = JsonDocument.Parse(await beforeResponse.Content.ReadAsStringAsync());
        var beforeFingerprint = beforeDocument.RootElement.GetProperty("fingerprint").GetString();

        var regenerateResponse = await client.PostAsync(
            "/api/v1/agent/regenerate-cert",
            CreateJsonContent(new { }));

        Assert.Equal(HttpStatusCode.OK, regenerateResponse.StatusCode);

        var afterResponse = await client.GetAsync("/api/v1/agent/cert-fingerprint");
        Assert.Equal(HttpStatusCode.OK, afterResponse.StatusCode);
        using var afterDocument = JsonDocument.Parse(await afterResponse.Content.ReadAsStringAsync());
        var afterFingerprint = afterDocument.RootElement.GetProperty("fingerprint").GetString();

        Assert.NotEqual(beforeFingerprint, afterFingerprint);
    }

    [Fact]
    public async Task NetworkSecurity_PairingRequestReturnsCertificateFingerprint()
    {
        var client = _factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/pairing/request");
        request.Content = new StringContent(
            "{\"clientName\":\"ipad-test\",\"clientType\":\"ipad\",\"platform\":\"ios\"}",
            Encoding.UTF8,
            "application/json");

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var fingerprint = document.RootElement.GetProperty("certFingerprint").GetString();
        Assert.NotNull(fingerprint);
        Assert.Matches("^[A-F0-9]{64}$", fingerprint!);
    }

    private sealed class InMemoryPairingRateLimiterForTests : IPairingRateLimiter
    {
        private readonly int _limit;
        private readonly TimeSpan _window;
        private readonly Dictionary<string, Queue<DateTimeOffset>> _entries = new(StringComparer.Ordinal);

        public InMemoryPairingRateLimiterForTests(int limit, TimeSpan window)
        {
            _limit = limit;
            _window = window;
        }

        public bool TryAcquire(string key, DateTimeOffset now, out TimeSpan retryAfter)
        {
            if (!_entries.TryGetValue(key, out var queue))
            {
                queue = new Queue<DateTimeOffset>();
                _entries[key] = queue;
            }

            while (queue.Count > 0 && now - queue.Peek() >= _window)
            {
                queue.Dequeue();
            }

            if (queue.Count >= _limit)
            {
                retryAfter = queue.Peek().Add(_window) - now;
                if (retryAfter <= TimeSpan.Zero)
                {
                    retryAfter = TimeSpan.FromSeconds(1);
                }

                return false;
            }

            queue.Enqueue(now);
            retryAfter = TimeSpan.Zero;
            return true;
        }
    }

    private sealed class AlwaysDenyPairingRateLimiter : IPairingRateLimiter
    {
        private readonly TimeSpan _retryAfter;

        public AlwaysDenyPairingRateLimiter(TimeSpan retryAfter)
        {
            _retryAfter = retryAfter;
        }

        public bool TryAcquire(string key, DateTimeOffset now, out TimeSpan retryAfter)
        {
            retryAfter = _retryAfter;
            return false;
        }
    }

    private static StringContent CreateJsonContent<T>(T payload)
    {
        return new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
    }
}
