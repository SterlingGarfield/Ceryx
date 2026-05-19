using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Ceryx.Agent.Network.Discovery;

public sealed class AgentDiscoveryHostedService : IHostedService
{
    private readonly IAgentDiscoveryPublisher _publisher;
    private readonly ILogger<AgentDiscoveryHostedService> _logger;

    public AgentDiscoveryHostedService(
        IAgentDiscoveryPublisher publisher,
        ILogger<AgentDiscoveryHostedService> logger)
    {
        _publisher = publisher ?? throw new ArgumentNullException(nameof(publisher));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("Starting discovery publisher.");
        await _publisher.StartAsync(cancellationToken);
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("Stopping discovery publisher.");
        await _publisher.StopAsync(cancellationToken);
    }
}
