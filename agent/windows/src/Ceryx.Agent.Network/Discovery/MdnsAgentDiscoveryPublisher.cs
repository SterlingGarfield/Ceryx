using Makaretu.Dns;
using Microsoft.Extensions.Logging;

namespace Ceryx.Agent.Network.Discovery;

public sealed class MdnsAgentDiscoveryPublisher : IAgentDiscoveryPublisher, IDisposable
{
    private readonly AgentDiscoveryMetadataFactory _metadataFactory;
    private readonly ILogger<MdnsAgentDiscoveryPublisher> _logger;
    private readonly object _sync = new();

    private ServiceDiscovery? _serviceDiscovery;
    private ServiceProfile? _serviceProfile;
    private bool _started;

    public MdnsAgentDiscoveryPublisher(
        AgentDiscoveryMetadataFactory metadataFactory,
        ILogger<MdnsAgentDiscoveryPublisher> logger)
    {
        _metadataFactory = metadataFactory ?? throw new ArgumentNullException(nameof(metadataFactory));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public Task StartAsync(CancellationToken cancellationToken = default)
    {
        lock (_sync)
        {
            if (_started)
            {
                return Task.CompletedTask;
            }

            var metadata = _metadataFactory.Create();
            var txt = AgentDiscoveryTxtSerializer.Serialize(metadata);

            var profile = new ServiceProfile(
                instanceName: metadata.DeviceName,
                serviceName: "_ceryx-agent._tcp",
                port: checked((ushort)metadata.HttpPort));

            foreach (var item in txt)
            {
                profile.AddProperty(item.Key, item.Value);
            }

            var discovery = new ServiceDiscovery();
            discovery.Advertise(profile);
            discovery.Announce(profile);

            _serviceProfile = profile;
            _serviceDiscovery = discovery;
            _started = true;

            _logger.LogInformation(
                "mDNS discovery started: service={ServiceName} instance={Instance} port={Port}",
                "_ceryx-agent._tcp.local",
                metadata.DeviceName,
                metadata.HttpPort);
        }

        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken = default)
    {
        lock (_sync)
        {
            if (!_started)
            {
                return Task.CompletedTask;
            }

            try
            {
                if (_serviceDiscovery is not null)
                {
                    if (_serviceProfile is not null)
                    {
                        _serviceDiscovery.Unadvertise(_serviceProfile);
                    }
                    else
                    {
                        _serviceDiscovery.Unadvertise();
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to unadvertise mDNS discovery profile cleanly.");
            }
            finally
            {
                _serviceDiscovery?.Dispose();
                _serviceDiscovery = null;
                _serviceProfile = null;
                _started = false;
            }

            _logger.LogInformation("mDNS discovery stopped.");
        }

        return Task.CompletedTask;
    }

    public void Dispose()
    {
        _ = StopAsync();
    }
}
