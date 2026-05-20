namespace Ceryx.Agent.Codex.SessionLock;

public sealed record SessionLockResult(
    bool IsGranted,
    string ActiveDeviceId,
    bool OwnershipChanged,
    string Reason
);

public interface ISessionLockService
{
    SessionLockResult AcquireForInput(string windowId, string deviceId, DateTimeOffset now);

    bool Release(string windowId, string deviceId);
}
