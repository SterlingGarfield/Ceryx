using Ceryx.Agent.Network.Discovery;
using Xunit;

namespace Ceryx.Agent.Tests;

public sealed class DiscoveryMetadataTests
{
    [Fact]
    public void DiscoveryMetadataSerialization_ContainsRequiredFields()
    {
        var metadata = new AgentDiscoveryMetadata(
            DeviceName: "Local Windows PC",
            AgentVersion: "0.3.0",
            Platform: "windows",
            HttpPort: 41527,
            SupportsWebRTC: false,
            SupportsDesktopClient: true,
            CodexStatus: "not_found");

        var txt = AgentDiscoveryTxtSerializer.Serialize(metadata);

        Assert.Equal("Local Windows PC", txt["deviceName"]);
        Assert.Equal("0.3.0", txt["agentVersion"]);
        Assert.Equal("windows", txt["platform"]);
        Assert.Equal("41527", txt["httpPort"]);
        Assert.Equal("false", txt["supportsWebRTC"]);
        Assert.Equal("true", txt["supportsDesktopClient"]);
        Assert.Equal("not_found", txt["codexStatus"]);
    }

    [Fact]
    public void DiscoveryMetadataFactory_ProvidesProtocolCompatibleDefaults()
    {
        var factory = new AgentDiscoveryMetadataFactory();
        var metadata = factory.Create();

        Assert.False(string.IsNullOrWhiteSpace(metadata.DeviceName));
        Assert.Equal("0.3.0", metadata.AgentVersion);
        Assert.Equal("windows", metadata.Platform);
        Assert.Equal(41527, metadata.HttpPort);
        Assert.False(metadata.SupportsWebRTC);
        Assert.True(metadata.SupportsDesktopClient);
        Assert.Equal("not_found", metadata.CodexStatus);
    }
}
