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

public sealed record PairingConfirmResult(
    bool IsSuccess,
    string State,
    bool IsLocked,
    int FailedAttempts,
    string? RejectedReason = null
);
