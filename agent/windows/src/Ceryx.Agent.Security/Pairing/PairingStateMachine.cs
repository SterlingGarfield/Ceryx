namespace Ceryx.Agent.Security.Pairing;

public sealed class PairingStateMachine
{
    private static readonly TimeSpan PairingTtl = TimeSpan.FromSeconds(120);
    private static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(5);
    private const int LockoutThreshold = 5;

    private readonly object _sync = new();
    private readonly IPairingClock _clock;
    private readonly IPairingCodeGenerator _codeGenerator;
    private readonly IPairingAuditSink _auditSink;

    private PendingPairing? _pending;
    private DateTimeOffset? _lockedUntil;
    private int _failedAttempts;

    public PairingStateMachine(
        IPairingClock clock,
        IPairingCodeGenerator codeGenerator,
        IPairingAuditSink? auditSink = null)
    {
        _clock = clock ?? throw new ArgumentNullException(nameof(clock));
        _codeGenerator = codeGenerator ?? throw new ArgumentNullException(nameof(codeGenerator));
        _auditSink = auditSink ?? new NoOpPairingAuditSink();
    }

    public string GetState()
    {
        lock (_sync)
        {
            ExpirePendingIfNeeded(_clock.UtcNow);
            if (_pending is null)
            {
                return "idle";
            }

            return _pending.State;
        }
    }

    public async Task<PairingRequestResult> RequestAsync(
        PairingRequestContext context,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(context);

        var now = _clock.UtcNow;
        lock (_sync)
        {
            ExpirePendingIfNeeded(now);

            if (IsLocked(now))
            {
                return new PairingRequestResult(
                    IsAccepted: false,
                    State: "rejected",
                    RejectedReason: "lockout_active");
            }

            if (_pending is not null)
            {
                return new PairingRequestResult(
                    IsAccepted: false,
                    State: "rejected",
                    RejectedReason: "pending_pairing_exists");
            }

            var pairingId = "pair_" + Guid.NewGuid().ToString("N");
            var code = _codeGenerator.GenerateSixDigitCode();
            var expiresAt = now.Add(PairingTtl);

            _pending = new PendingPairing(
                PairingId: pairingId,
                Code: code,
                ExpiresAt: expiresAt,
                State: "waiting_desktop_confirm",
                DesktopConfirmed: false,
                ClientName: context.ClientName,
                ClientType: context.ClientType,
                Platform: context.Platform);
        }

        await WriteAuditAsync("pairing_request", "waiting_desktop_confirm", "Pairing request created.", cancellationToken);

        PendingPairing current;
        lock (_sync)
        {
            current = _pending!;
        }

        return new PairingRequestResult(
            IsAccepted: true,
            State: current.State,
            PairingId: current.PairingId,
            ExpiresAt: current.ExpiresAt.ToString("O"),
            Code: null);
    }

    public async Task<bool> ApproveOnDesktopAsync(string pairingId, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(pairingId))
        {
            return false;
        }

        var now = _clock.UtcNow;
        lock (_sync)
        {
            ExpirePendingIfNeeded(now);

            if (_pending is null || !string.Equals(_pending.PairingId, pairingId, StringComparison.Ordinal))
            {
                return false;
            }

            _pending = _pending with
            {
                DesktopConfirmed = true,
                State = "code_input"
            };
        }

        await WriteAuditAsync("pairing_desktop_confirm", "code_input", "Desktop confirmed pairing request.", cancellationToken);
        return true;
    }

    public async Task<PairingConfirmResult> ConfirmAsync(
        string pairingId,
        string code,
        CancellationToken cancellationToken = default)
    {
        var now = _clock.UtcNow;
        PendingPairing? pendingSnapshot;

        lock (_sync)
        {
            ExpirePendingIfNeeded(now);

            if (IsLocked(now))
            {
                return new PairingConfirmResult(
                    IsSuccess: false,
                    State: "rejected",
                    IsLocked: true,
                    FailedAttempts: _failedAttempts,
                    RejectedReason: "lockout_active");
            }

            pendingSnapshot = _pending;
            if (pendingSnapshot is null)
            {
                return new PairingConfirmResult(
                    IsSuccess: false,
                    State: "rejected",
                    IsLocked: false,
                    FailedAttempts: _failedAttempts,
                    RejectedReason: "pairing_not_found");
            }

            if (!string.Equals(pendingSnapshot.PairingId, pairingId, StringComparison.Ordinal))
            {
                RegisterFailure(now);
                return new PairingConfirmResult(
                    IsSuccess: false,
                    State: "rejected",
                    IsLocked: IsLocked(now),
                    FailedAttempts: _failedAttempts,
                    RejectedReason: "pairing_id_mismatch");
            }

            if (!pendingSnapshot.DesktopConfirmed)
            {
                return new PairingConfirmResult(
                    IsSuccess: false,
                    State: "waiting_desktop_confirm",
                    IsLocked: false,
                    FailedAttempts: _failedAttempts,
                    RejectedReason: "desktop_confirmation_required");
            }

            _pending = pendingSnapshot with { State = "verifying" };
            pendingSnapshot = _pending;
        }

        if (string.Equals(pendingSnapshot.Code, code, StringComparison.Ordinal))
        {
            lock (_sync)
            {
                _pending = null;
                _failedAttempts = 0;
                _lockedUntil = null;
            }

            await WriteAuditAsync("pairing_success", "success", "Pairing code verified.", cancellationToken);

            return new PairingConfirmResult(
                IsSuccess: true,
                State: "success",
                IsLocked: false,
                FailedAttempts: 0,
                PairingId: pendingSnapshot.PairingId,
                ClientName: pendingSnapshot.ClientName,
                ClientType: pendingSnapshot.ClientType,
                Platform: pendingSnapshot.Platform);
        }

        lock (_sync)
        {
            RegisterFailure(now);
            if (_pending is not null)
            {
                _pending = _pending with { State = "code_input" };
            }
        }

        await WriteAuditAsync("pairing_failure", "rejected", "Pairing code verification failed.", cancellationToken);

        return new PairingConfirmResult(
            IsSuccess: false,
            State: "rejected",
            IsLocked: IsLocked(now),
            FailedAttempts: _failedAttempts,
            RejectedReason: "code_mismatch");
    }

    private bool IsLocked(DateTimeOffset now)
    {
        return _lockedUntil.HasValue && _lockedUntil.Value > now;
    }

    private void RegisterFailure(DateTimeOffset now)
    {
        _failedAttempts++;
        if (_failedAttempts >= LockoutThreshold)
        {
            _lockedUntil = now.Add(LockoutDuration);
        }
    }

    private void ExpirePendingIfNeeded(DateTimeOffset now)
    {
        if (_pending is null)
        {
            return;
        }

        if (_pending.ExpiresAt <= now)
        {
            _pending = null;
        }
    }

    private Task WriteAuditAsync(
        string action,
        string state,
        string message,
        CancellationToken cancellationToken)
    {
        PendingPairing? pending;
        lock (_sync)
        {
            pending = _pending;
        }

        var pairingId = pending?.PairingId ?? "pair_unknown";
        return _auditSink.WriteAsync(action, pairingId, state, message, cancellationToken);
    }

    private sealed record PendingPairing(
        string PairingId,
        string Code,
        DateTimeOffset ExpiresAt,
        string State,
        bool DesktopConfirmed,
        string ClientName,
        string ClientType,
        string Platform
    );
}
