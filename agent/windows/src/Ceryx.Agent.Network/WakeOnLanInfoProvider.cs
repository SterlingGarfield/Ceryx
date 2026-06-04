using Ceryx.Agent.Core;
using System.Net.NetworkInformation;
using Ceryx.Agent.Security.Devices;

namespace Ceryx.Agent.Network;

public sealed class SystemWakeOnLanInfoProvider : IWakeOnLanInfoProvider
{
    private readonly WakeOnLanSettings _settings;

    public SystemWakeOnLanInfoProvider(WakeOnLanSettings settings)
    {
        _settings = settings ?? throw new ArgumentNullException(nameof(settings));
    }

    public WakeOnLanInfo GetWakeOnLanInfo()
    {
        if (!_settings.Enabled)
        {
            return new WakeOnLanInfo(false, Array.Empty<string>(), string.Empty, _settings.Port);
        }

        var candidates = new List<WakeOnLanCandidate>();
        foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (nic.OperationalStatus != OperationalStatus.Up ||
                nic.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel)
            {
                continue;
            }

            PhysicalAddress physicalAddress;
            try
            {
                physicalAddress = nic.GetPhysicalAddress();
            }
            catch
            {
                continue;
            }

            var macBytes = physicalAddress.GetAddressBytes();
            if (macBytes.Length == 0 || macBytes.All(static item => item == 0))
            {
                continue;
            }

            IPInterfaceProperties properties;
            try
            {
                properties = nic.GetIPProperties();
            }
            catch
            {
                continue;
            }

            var subnets = new List<WakeOnLanSubnetSnapshot>();
            foreach (var unicast in properties.UnicastAddresses)
            {
                if (unicast.Address.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork ||
                    unicast.IPv4Mask is null)
                {
                    continue;
                }

                subnets.Add(new WakeOnLanSubnetSnapshot(
                    Address: unicast.Address.ToString(),
                    SubnetMask: unicast.IPv4Mask.ToString()));
            }

            if (subnets.Count == 0)
            {
                continue;
            }

            candidates.Add(new WakeOnLanCandidate(
                Name: nic.Name,
                IsPhysical: true,
                IsUp: true,
                IsWireless: nic.NetworkInterfaceType == NetworkInterfaceType.Wireless80211,
                MacAddress: FormatMacAddress(macBytes),
                Subnets: subnets));
        }

        return WakeOnLanInfoResolver.Resolve(candidates, _settings.Port);
    }

    private static string FormatMacAddress(byte[] macBytes)
    {
        return string.Join(":", macBytes.Select(static item => item.ToString("X2")));
    }
}
