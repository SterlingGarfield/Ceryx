namespace Ceryx.Agent.Network.Discovery;

public static class AgentDiscoveryTxtSerializer
{
    public static IReadOnlyDictionary<string, string> Serialize(AgentDiscoveryMetadata metadata)
    {
        ArgumentNullException.ThrowIfNull(metadata);

        return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["deviceName"] = metadata.DeviceName,
            ["agentVersion"] = metadata.AgentVersion,
            ["platform"] = metadata.Platform,
            ["httpPort"] = metadata.HttpPort.ToString(System.Globalization.CultureInfo.InvariantCulture),
            ["supportsWebRTC"] = metadata.SupportsWebRTC ? "true" : "false",
            ["supportsDesktopClient"] = metadata.SupportsDesktopClient ? "true" : "false",
            ["codexStatus"] = metadata.CodexStatus
        };
    }
}
