namespace Ceryx.Agent.Network.Discovery;

public interface IAgentDiscoveryPublisher
{
    Task StartAsync(CancellationToken cancellationToken = default);

    Task StopAsync(CancellationToken cancellationToken = default);
}
