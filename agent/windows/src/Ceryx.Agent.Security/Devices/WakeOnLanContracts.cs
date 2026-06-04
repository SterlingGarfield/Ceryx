using System.Net;
using System.Net.NetworkInformation;
using WakeOnLanInfo = Ceryx.Agent.Core.WakeOnLanInfo;

namespace Ceryx.Agent.Security.Devices;

public sealed record WakeOnLanSubnetSnapshot(
    string Address,
    string SubnetMask);

public sealed record WakeOnLanCandidate(
    string Name,
    bool IsPhysical,
    bool IsUp,
    bool IsWireless,
    string MacAddress,
    IReadOnlyList<WakeOnLanSubnetSnapshot> Subnets);

public sealed record WakeOnLanSettings(
    bool Enabled,
    int Port);

public interface IWakeOnLanInfoProvider
{
    WakeOnLanInfo GetWakeOnLanInfo();
}

public static class WakeOnLanInfoResolver
{
    public static WakeOnLanInfo Resolve(
        IReadOnlyList<WakeOnLanCandidate> candidates,
        int port)
    {
        if (candidates is null)
        {
            throw new ArgumentNullException(nameof(candidates));
        }

        if (port <= 0 || port > 65535)
        {
            throw new ArgumentOutOfRangeException(nameof(port), "Port must be between 1 and 65535.");
        }

        var supportedCandidates = candidates
            .Where(static candidate =>
                candidate.IsPhysical &&
                candidate.IsUp &&
                !string.IsNullOrWhiteSpace(candidate.MacAddress) &&
                candidate.Subnets.Count > 0)
            .Select(candidate => new
            {
                Candidate = candidate,
                MacAddress = NormalizeMacAddress(candidate.MacAddress)
            })
            .Where(static item => !string.IsNullOrWhiteSpace(item.MacAddress))
            .ToArray();

        if (supportedCandidates.Length == 0)
        {
            return new WakeOnLanInfo(false, Array.Empty<string>(), string.Empty, port);
        }

        var orderedCandidates = supportedCandidates
            .OrderBy(static item => item.Candidate.IsWireless ? 1 : 0)
            .ThenBy(static item => item.Candidate.Name, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        var macAddresses = orderedCandidates
            .Select(static item => item.MacAddress)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        var primaryCandidate = orderedCandidates[0].Candidate;
        var primarySubnet = primaryCandidate.Subnets[0];
        var broadcastAddress = ComputeBroadcastAddress(primarySubnet.Address, primarySubnet.SubnetMask);

        return new WakeOnLanInfo(
            Supported: macAddresses.Length > 0 && !string.IsNullOrWhiteSpace(broadcastAddress),
            MacAddresses: macAddresses,
            BroadcastAddress: broadcastAddress,
            Port: port);
    }

    public static string NormalizeMacAddress(string macAddress)
    {
        if (string.IsNullOrWhiteSpace(macAddress))
        {
            return string.Empty;
        }

        var hex = new string(macAddress.Where(static character => char.IsLetterOrDigit(character)).ToArray());
        if (hex.Length != 12)
        {
            return string.Empty;
        }

        var bytes = new List<string>(6);
        for (var index = 0; index < hex.Length; index += 2)
        {
            bytes.Add(hex.Substring(index, 2).ToUpperInvariant());
        }

        return string.Join(":", bytes);
    }

    public static string ComputeBroadcastAddress(string address, string subnetMask)
    {
        if (!IPAddress.TryParse(address, out var ipAddress) ||
            !IPAddress.TryParse(subnetMask, out var mask) ||
            ipAddress.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork ||
            mask.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork)
        {
            return string.Empty;
        }

        var addressBytes = ipAddress.GetAddressBytes();
        var maskBytes = mask.GetAddressBytes();
        var broadcastBytes = new byte[addressBytes.Length];

        for (var index = 0; index < addressBytes.Length; index += 1)
        {
            broadcastBytes[index] = (byte)(addressBytes[index] | ~maskBytes[index]);
        }

        return new IPAddress(broadcastBytes).ToString();
    }
}
