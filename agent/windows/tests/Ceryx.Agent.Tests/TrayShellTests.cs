using Ceryx.Agent.App.Tray;
using Ceryx.Agent.Storage;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Ceryx.Agent.Tests;

public class TrayShellTests
{
    [Fact]
    public void Commands_ContainRequiredPlaceholders()
    {
        var shell = CreateShell(out _);

        var commandIds = shell.Commands.Select(static command => command.Id).ToArray();

        Assert.Equal(4, commandIds.Length);
        Assert.Contains(TrayShellCommandIds.OpenDesktopConsole, commandIds);
        Assert.Contains(TrayShellCommandIds.OpenSettings, commandIds);
        Assert.Contains(TrayShellCommandIds.OpenLogsFolder, commandIds);
        Assert.Contains(TrayShellCommandIds.Quit, commandIds);
    }

    [Fact]
    public async Task QuitCommand_RequestsApplicationStop()
    {
        var shell = CreateShell(out var lifetime);

        await shell.ExecuteAsync(TrayShellCommandIds.Quit);

        Assert.True(lifetime.StopRequested);
    }

    private static AgentTrayShell CreateShell(out FakeHostApplicationLifetime lifetime)
    {
        lifetime = new FakeHostApplicationLifetime();
        var tempRoot = Path.Combine(Path.GetTempPath(), "ceryx-tray-" + Guid.NewGuid().ToString("N"));
        var localPaths = new LocalPaths(tempRoot);
        return new AgentTrayShell(lifetime, localPaths, NullLogger<AgentTrayShell>.Instance);
    }

    private sealed class FakeHostApplicationLifetime : IHostApplicationLifetime
    {
        public bool StopRequested { get; private set; }

        public CancellationToken ApplicationStarted => CancellationToken.None;

        public CancellationToken ApplicationStopping => CancellationToken.None;

        public CancellationToken ApplicationStopped => CancellationToken.None;

        public void StopApplication()
        {
            StopRequested = true;
        }
    }
}
