namespace Ceryx.Agent.Core;

public interface IAgentTrayShell
{
    IReadOnlyList<TrayShellCommand> Commands { get; }

    Task ExecuteAsync(string commandId, CancellationToken cancellationToken = default);
}

public sealed record TrayShellCommand(string Id, string Label);

public static class TrayShellCommandIds
{
    public const string OpenDesktopConsole = "open_desktop_console";
    public const string OpenSettings = "open_settings";
    public const string OpenLogsFolder = "open_logs_folder";
    public const string Quit = "quit";
}
