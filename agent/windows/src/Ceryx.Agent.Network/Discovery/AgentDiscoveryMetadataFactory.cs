using Ceryx.Agent.Core;

namespace Ceryx.Agent.Network.Discovery;

public sealed class AgentDiscoveryMetadataFactory
{
    public AgentDiscoveryMetadata Create()
    {
        return new AgentDiscoveryMetadata(
            DeviceName: Environment.MachineName,
            AgentVersion: "0.3.0",
            Platform: "windows",
            HttpPort: 41527,
            SupportsWebRTC: false,
            SupportsDesktopClient: true,
            CodexStatus: CodexWindowStatus.NotFound.ToWireValue());
    }
}
