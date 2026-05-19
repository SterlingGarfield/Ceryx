using Ceryx.Agent.Network.Discovery;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Ceryx.Agent.Tests;

public sealed class DiscoveryHostedServiceTests
{
    [Fact]
    public async Task HostedService_StartsAndStopsPublisher()
    {
        var publisher = new FakeDiscoveryPublisher();
        var service = new AgentDiscoveryHostedService(
            publisher,
            NullLogger<AgentDiscoveryHostedService>.Instance);

        await service.StartAsync(CancellationToken.None);
        await service.StopAsync(CancellationToken.None);

        Assert.True(publisher.StartCalled);
        Assert.True(publisher.StopCalled);
    }

    private sealed class FakeDiscoveryPublisher : IAgentDiscoveryPublisher
    {
        public bool StartCalled { get; private set; }
        public bool StopCalled { get; private set; }

        public Task StartAsync(CancellationToken cancellationToken = default)
        {
            StartCalled = true;
            return Task.CompletedTask;
        }

        public Task StopAsync(CancellationToken cancellationToken = default)
        {
            StopCalled = true;
            return Task.CompletedTask;
        }
    }
}
