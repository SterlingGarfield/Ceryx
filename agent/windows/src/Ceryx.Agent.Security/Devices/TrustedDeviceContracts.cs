using Ceryx.Agent.Core;

namespace Ceryx.Agent.Security.Devices;

public sealed record TrustedDeviceRecord(
    string DeviceId,
    string Name,
    string Platform,
    string ClientType,
    string TokenHash,
    IReadOnlyList<Permission> Permissions,
    WakeOnLanInfo? Wol,
    DateTimeOffset CreatedAt
);

public interface ITrustedDeviceStore
{
    Task AddAsync(TrustedDeviceRecord device, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<TrustedDeviceRecord>> ListAsync(CancellationToken cancellationToken = default);

    Task<TrustedDeviceRecord?> FindByTokenHashAsync(string tokenHash, CancellationToken cancellationToken = default);

    Task<bool> DeleteAsync(string deviceId, CancellationToken cancellationToken = default);
}
