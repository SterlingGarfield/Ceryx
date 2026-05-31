using Ceryx.Agent.Security.Pairing;
using Xunit;

namespace Ceryx.Agent.Tests;

public sealed class PairingStateMachineTests
{
    [Fact]
    public async Task PairingRequest_ExpiresAfter120Seconds()
    {
        var clock = new FakeClock(new DateTimeOffset(2026, 5, 20, 0, 0, 0, TimeSpan.Zero));
        var machine = CreateStateMachine(clock, "123456");

        var request = await machine.RequestAsync(new PairingRequestContext("ipad", "ipad", "ios"));
        Assert.True(request.IsAccepted);
        Assert.Equal("waiting_desktop_confirm", request.State);

        clock.Advance(TimeSpan.FromSeconds(121));

        Assert.Equal("idle", machine.GetState());
        var confirm = await machine.ConfirmAsync(request.PairingId!, "123456");
        Assert.False(confirm.IsSuccess);
        Assert.Equal("rejected", confirm.State);
    }

    [Fact]
    public async Task PairingRequest_AllowsOnlyOnePendingRequest()
    {
        var clock = new FakeClock(DateTimeOffset.UtcNow);
        var machine = CreateStateMachine(clock, "123456");

        var first = await machine.RequestAsync(new PairingRequestContext("ipad", "ipad", "ios"));
        var second = await machine.RequestAsync(new PairingRequestContext("desktop", "desktop", "windows"));

        Assert.True(first.IsAccepted);
        Assert.False(second.IsAccepted);
        Assert.Equal("rejected", second.State);
        Assert.Equal("pending_pairing_exists", second.RejectedReason);
    }

    [Fact]
    public async Task PairingConfirm_LocksForFiveMinutesAfterFiveFailures()
    {
        var clock = new FakeClock(new DateTimeOffset(2026, 5, 20, 0, 0, 0, TimeSpan.Zero));
        var machine = CreateStateMachine(clock, "123456");

        var request = await machine.RequestAsync(new PairingRequestContext("ipad", "ipad", "ios"));
        var approved = await machine.ApproveOnDesktopAsync(request.PairingId!);
        Assert.True(approved.IsApproved);

        for (var i = 0; i < 4; i++)
        {
            var failed = await machine.ConfirmAsync(request.PairingId!, "000000");
            Assert.False(failed.IsSuccess);
            Assert.False(failed.IsLocked);
        }

        var lockout = await machine.ConfirmAsync(request.PairingId!, "000000");
        Assert.False(lockout.IsSuccess);
        Assert.True(lockout.IsLocked);

        var blockedRequest = await machine.RequestAsync(new PairingRequestContext("ipad2", "ipad", "ios"));
        Assert.False(blockedRequest.IsAccepted);
        Assert.Equal("lockout_active", blockedRequest.RejectedReason);

        clock.Advance(TimeSpan.FromMinutes(5).Add(TimeSpan.FromSeconds(1)));
        var requestAfterLock = await machine.RequestAsync(new PairingRequestContext("ipad3", "ipad", "ios"));
        Assert.True(requestAfterLock.IsAccepted);
    }

    [Fact]
    public async Task PairingConfirm_TransitionsToSuccessAfterDesktopApprovalAndCodeMatch()
    {
        var machine = CreateStateMachine(new FakeClock(DateTimeOffset.UtcNow), "654321");
        var request = await machine.RequestAsync(new PairingRequestContext("ipad", "ipad", "ios"));

        var pendingConfirm = await machine.ConfirmAsync(request.PairingId!, "654321");
        Assert.False(pendingConfirm.IsSuccess);
        Assert.Equal("waiting_desktop_confirm", pendingConfirm.State);

        var approved = await machine.ApproveOnDesktopAsync(request.PairingId!);
        Assert.True(approved.IsApproved);

        var success = await machine.ConfirmAsync(request.PairingId!, "654321");
        Assert.True(success.IsSuccess);
        Assert.Equal("success", success.State);
        Assert.Equal("idle", machine.GetState());
    }

    [Fact]
    public async Task PairingDesktopApproval_ReturnsCodeForCodeInputStep()
    {
        var machine = CreateStateMachine(new FakeClock(DateTimeOffset.UtcNow), "654321");
        var request = await machine.RequestAsync(new PairingRequestContext("ipad", "ipad", "ios"));

        var approved = await machine.ApproveOnDesktopAsync(request.PairingId!);

        Assert.True(approved.IsApproved);
        Assert.Equal("code_input", approved.State);
        Assert.Equal("654321", approved.Code);
    }

    private static PairingStateMachine CreateStateMachine(FakeClock clock, string code)
    {
        return new PairingStateMachine(
            clock,
            new FixedCodeGenerator(code),
            new NoOpPairingAuditSink());
    }

    private sealed class FakeClock : IPairingClock
    {
        public FakeClock(DateTimeOffset initial)
        {
            UtcNow = initial;
        }

        public DateTimeOffset UtcNow { get; private set; }

        public void Advance(TimeSpan span)
        {
            UtcNow = UtcNow.Add(span);
        }
    }

    private sealed class FixedCodeGenerator : IPairingCodeGenerator
    {
        private readonly string _code;

        public FixedCodeGenerator(string code)
        {
            _code = code;
        }

        public string GenerateSixDigitCode() => _code;
    }
}
