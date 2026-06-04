using Ceryx.Agent.Core;
using Ceryx.Agent.Security.Devices;
using Ceryx.Agent.Security.Tokens;

namespace Ceryx.Agent.Security.Pairing;

public sealed record PairingCompletionSuccess(
    string DeviceId,
    string DeviceToken,
    IReadOnlyList<Permission> Permissions,
    WakeOnLanInfo? Wol
);

public sealed record PairingCompletionResult(
    bool IsSuccess,
    string State,
    bool IsLocked,
    int FailedAttempts,
    string? RejectedReason = null,
    PairingCompletionSuccess? Success = null
);

public sealed class PairingCompletionService
{
    private readonly PairingStateMachine _stateMachine;
    private readonly ITrustedDeviceStore _trustedDeviceStore;
    private readonly IDeviceTokenGenerator _tokenGenerator;
    private readonly IDeviceTokenHasher _tokenHasher;
    private readonly IDefaultPermissionPolicy _permissionPolicy;
    private readonly IWakeOnLanInfoProvider _wakeOnLanInfoProvider;

    public PairingCompletionService(
        PairingStateMachine stateMachine,
        ITrustedDeviceStore trustedDeviceStore,
        IDeviceTokenGenerator tokenGenerator,
        IDeviceTokenHasher tokenHasher,
        IDefaultPermissionPolicy permissionPolicy,
        IWakeOnLanInfoProvider wakeOnLanInfoProvider)
    {
        _stateMachine = stateMachine ?? throw new ArgumentNullException(nameof(stateMachine));
        _trustedDeviceStore = trustedDeviceStore ?? throw new ArgumentNullException(nameof(trustedDeviceStore));
        _tokenGenerator = tokenGenerator ?? throw new ArgumentNullException(nameof(tokenGenerator));
        _tokenHasher = tokenHasher ?? throw new ArgumentNullException(nameof(tokenHasher));
        _permissionPolicy = permissionPolicy ?? throw new ArgumentNullException(nameof(permissionPolicy));
        _wakeOnLanInfoProvider = wakeOnLanInfoProvider ?? throw new ArgumentNullException(nameof(wakeOnLanInfoProvider));
    }

    public async Task<PairingCompletionResult> ConfirmAsync(
        string pairingId,
        string code,
        CancellationToken cancellationToken = default)
    {
        var confirm = await _stateMachine.ConfirmAsync(pairingId, code, cancellationToken);
        if (!confirm.IsSuccess)
        {
            return new PairingCompletionResult(
                IsSuccess: false,
                State: confirm.State,
                IsLocked: confirm.IsLocked,
                FailedAttempts: confirm.FailedAttempts,
                RejectedReason: confirm.RejectedReason);
        }

        var clientType = string.IsNullOrWhiteSpace(confirm.ClientType) ? "ipad" : confirm.ClientType;
        var platform = string.IsNullOrWhiteSpace(confirm.Platform) ? "unknown" : confirm.Platform;
        var deviceName = string.IsNullOrWhiteSpace(confirm.ClientName)
            ? $"{clientType}-device"
            : confirm.ClientName;

        var permissions = _permissionPolicy.ResolveForClient(clientType);
        var deviceToken = _tokenGenerator.GenerateToken();
        var tokenHash = _tokenHasher.Hash(deviceToken);
        var deviceId = "dev_" + Guid.NewGuid().ToString("N");
        var wol = _wakeOnLanInfoProvider.GetWakeOnLanInfo();

        var trustedDevice = new TrustedDeviceRecord(
            DeviceId: deviceId,
            Name: deviceName,
            Platform: platform,
            ClientType: clientType,
            TokenHash: tokenHash,
            Permissions: permissions,
            Wol: wol,
            CreatedAt: DateTimeOffset.UtcNow);

        await _trustedDeviceStore.AddAsync(trustedDevice, cancellationToken);

        return new PairingCompletionResult(
            IsSuccess: true,
            State: "success",
            IsLocked: false,
            FailedAttempts: 0,
            Success: new PairingCompletionSuccess(
                DeviceId: deviceId,
                DeviceToken: deviceToken,
                Permissions: permissions,
                Wol: wol));
    }
}
