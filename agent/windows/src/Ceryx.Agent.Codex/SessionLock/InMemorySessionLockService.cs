namespace Ceryx.Agent.Codex.SessionLock;

public sealed class InMemorySessionLockService : ISessionLockService
{
    private readonly object _sync = new();
    private readonly TimeSpan _staleTimeout;
    private readonly Dictionary<string, LockState> _locks = new(StringComparer.OrdinalIgnoreCase);

    public InMemorySessionLockService(TimeSpan? staleTimeout = null)
    {
        _staleTimeout = staleTimeout ?? TimeSpan.FromSeconds(15);
    }

    public SessionLockResult AcquireForInput(string windowId, string deviceId, DateTimeOffset now)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(windowId);
        ArgumentException.ThrowIfNullOrWhiteSpace(deviceId);

        lock (_sync)
        {
            if (!_locks.TryGetValue(windowId, out var current))
            {
                _locks[windowId] = new LockState(deviceId, now);
                return new SessionLockResult(true, deviceId, true, "granted_new");
            }

            if (string.Equals(current.DeviceId, deviceId, StringComparison.Ordinal))
            {
                _locks[windowId] = current with { LastSeenAt = now };
                return new SessionLockResult(true, deviceId, false, "granted_existing");
            }

            if (current.LastSeenAt.Add(_staleTimeout) <= now)
            {
                _locks[windowId] = new LockState(deviceId, now);
                return new SessionLockResult(true, deviceId, true, "granted_stale_replaced");
            }

            return new SessionLockResult(false, current.DeviceId, false, "active_controller_exists");
        }
    }

    public bool Release(string windowId, string deviceId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(windowId);
        ArgumentException.ThrowIfNullOrWhiteSpace(deviceId);

        lock (_sync)
        {
            if (!_locks.TryGetValue(windowId, out var current))
            {
                return false;
            }

            if (!string.Equals(current.DeviceId, deviceId, StringComparison.Ordinal))
            {
                return false;
            }

            _locks.Remove(windowId);
            return true;
        }
    }

    private sealed record LockState(string DeviceId, DateTimeOffset LastSeenAt);
}
