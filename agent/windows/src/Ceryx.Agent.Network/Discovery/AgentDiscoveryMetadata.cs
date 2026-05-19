namespace Ceryx.Agent.Network.Discovery;

public sealed record AgentDiscoveryMetadata(
    string DeviceName,
    string AgentVersion,
    string Platform,
    int HttpPort,
    bool SupportsWebRTC,
    bool SupportsDesktopClient,
    string CodexStatus
);
