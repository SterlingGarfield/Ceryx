using Ceryx.Agent.Codex.SessionLock;
using Xunit;

namespace Ceryx.Agent.Tests;

public sealed class SessionLockTests
{
    [Fact]
    public void SessionLock_RejectsSecondActiveController()
    {
        var service = new InMemorySessionLockService(TimeSpan.FromSeconds(10));
        var now = DateTimeOffset.UtcNow;

        var first = service.AcquireForInput("w1", "dev_a", now);
        var second = service.AcquireForInput("w1", "dev_b", now.AddSeconds(1));

        Assert.True(first.IsGranted);
        Assert.False(second.IsGranted);
        Assert.Equal("dev_a", second.ActiveDeviceId);
        Assert.Equal("active_controller_exists", second.Reason);
    }

    [Fact]
    public void SessionLock_ReplacesStaleController()
    {
        var service = new InMemorySessionLockService(TimeSpan.FromSeconds(2));
        var now = DateTimeOffset.UtcNow;

        _ = service.AcquireForInput("w1", "dev_a", now);
        var second = service.AcquireForInput("w1", "dev_b", now.AddSeconds(3));

        Assert.True(second.IsGranted);
        Assert.Equal("dev_b", second.ActiveDeviceId);
        Assert.True(second.OwnershipChanged);
        Assert.Equal("granted_stale_replaced", second.Reason);
    }
}
