namespace Ceryx.Agent.Security.Pairing;

public sealed record PairingRequestContext(
    string ClientName,
    string ClientType,
    string Platform
);

public sealed record PairingRequestResult(
    bool IsAccepted,
    string State,
    string? PairingId = null,
    string? ExpiresAt = null,
    string? Code = null,
    string? RejectedReason = null
);

public sealed record PairingDesktopApprovalResult(
    bool IsApproved,
    string State,
    string? Code = null
);

public sealed record PairingConfirmResult(
    bool IsSuccess,
    string State,
    bool IsLocked,
    int FailedAttempts,
    string? RejectedReason = null,
    string? PairingId = null,
    string? ClientName = null,
    string? ClientType = null,
    string? Platform = null
);
