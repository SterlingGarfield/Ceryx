using System.Diagnostics;
using Ceryx.Agent.Storage;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Ceryx.Agent.App.Tray;

public sealed class AgentTrayShell : IAgentTrayShell
{
    private static readonly IReadOnlyList<TrayShellCommand> DefaultCommands =
    [
        new(TrayShellCommandIds.OpenDesktopConsole, "Open Desktop Console"),
        new(TrayShellCommandIds.OpenSettings, "Open Settings"),
        new(TrayShellCommandIds.OpenLogsFolder, "Open Logs Folder"),
        new(TrayShellCommandIds.Quit, "Quit")
    ];

    private readonly IHostApplicationLifetime _applicationLifetime;
    private readonly LocalPaths _localPaths;
    private readonly ILogger<AgentTrayShell> _logger;

    public AgentTrayShell(
        IHostApplicationLifetime applicationLifetime,
        LocalPaths localPaths,
        ILogger<AgentTrayShell> logger)
    {
        _applicationLifetime = applicationLifetime ?? throw new ArgumentNullException(nameof(applicationLifetime));
        _localPaths = localPaths ?? throw new ArgumentNullException(nameof(localPaths));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public IReadOnlyList<TrayShellCommand> Commands => DefaultCommands;

    public Task ExecuteAsync(string commandId, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        switch (commandId)
        {
            case TrayShellCommandIds.OpenDesktopConsole:
                _logger.LogInformation("Tray command executed: {CommandId}. Placeholder behavior.", commandId);
                break;
            case TrayShellCommandIds.OpenSettings:
                _logger.LogInformation("Tray command executed: {CommandId}. Placeholder behavior.", commandId);
                break;
            case TrayShellCommandIds.OpenLogsFolder:
                _logger.LogInformation(
                    "Tray command executed: {CommandId}. Attempting to open logs folder {LogsPath}.",
                    commandId,
                    _localPaths.Logs);
                TryOpenLogsFolder();
                break;
            case TrayShellCommandIds.Quit:
                _logger.LogInformation("Tray command executed: {CommandId}. Requesting host shutdown.", commandId);
                _applicationLifetime.StopApplication();
                break;
            default:
                throw new ArgumentOutOfRangeException(nameof(commandId), commandId, "Unknown tray command id.");
        }

        return Task.CompletedTask;
    }

    private void TryOpenLogsFolder()
    {
        try
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = "explorer.exe",
                Arguments = _localPaths.Logs,
                UseShellExecute = true
            };

            _ = Process.Start(startInfo);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to open logs folder.");
        }
    }
}
