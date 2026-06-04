using Ceryx.Agent.Security.Devices;
using Xunit;

namespace Ceryx.Agent.Tests;

public sealed class WakeOnLanInfoResolverTests
{
    [Fact]
    public void Resolve_PrefersWiredAdapterAndFormatsBroadcastAddress()
    {
        var result = WakeOnLanInfoResolver.Resolve(
            [
                new WakeOnLanCandidate(
                    Name: "Wi-Fi",
                    IsPhysical: true,
                    IsUp: true,
                    IsWireless: true,
                    MacAddress: "11-22-33-44-55-66",
                    Subnets:
                    [
                        new WakeOnLanSubnetSnapshot("192.168.1.25", "255.255.255.0")
                    ]),
                new WakeOnLanCandidate(
                    Name: "Ethernet",
                    IsPhysical: true,
                    IsUp: true,
                    IsWireless: false,
                    MacAddress: "AA-BB-CC-DD-EE-FF",
                    Subnets:
                    [
                        new WakeOnLanSubnetSnapshot("192.168.10.42", "255.255.255.0")
                    ])
            ],
            port: 9);

        Assert.True(result.Supported);
        Assert.Equal(9, result.Port);
        Assert.Equal("192.168.10.255", result.BroadcastAddress);
        Assert.Equal(
            ["AA:BB:CC:DD:EE:FF", "11:22:33:44:55:66"],
            result.MacAddresses);
    }

    [Fact]
    public void Resolve_ReturnsUnsupportedWhenNoCandidateQualifies()
    {
        var result = WakeOnLanInfoResolver.Resolve(
            [
                new WakeOnLanCandidate(
                    Name: "Loopback",
                    IsPhysical: false,
                    IsUp: true,
                    IsWireless: false,
                    MacAddress: "00-00-00-00-00-00",
                    Subnets: [])
            ],
            port: 9);

        Assert.False(result.Supported);
        Assert.Empty(result.MacAddresses);
        Assert.Equal(string.Empty, result.BroadcastAddress);
    }
}
