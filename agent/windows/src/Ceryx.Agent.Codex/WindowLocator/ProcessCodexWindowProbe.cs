using System.Diagnostics;

namespace Ceryx.Agent.Codex.WindowLocator;

public sealed class ProcessCodexWindowProbe : ICodexWindowProbe
{
    public Task<IReadOnlyList<CodexWindowCandidate>> ProbeAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var results = new List<CodexWindowCandidate>();

        foreach (var process in Process.GetProcesses())
        {
            try
            {
                if (process.HasExited || process.MainWindowHandle == IntPtr.Zero)
                {
                    continue;
                }

                var processName = process.ProcessName ?? string.Empty;
                var title = process.MainWindowTitle ?? string.Empty;
                if (string.IsNullOrWhiteSpace(title))
                {
                    continue;
                }

                var matched = processName.Contains("codex", StringComparison.OrdinalIgnoreCase) ||
                              title.Contains("codex", StringComparison.OrdinalIgnoreCase);
                if (!matched)
                {
                    continue;
                }

                var windowId = $"hwnd_{process.MainWindowHandle.ToInt64():X}";
                results.Add(new CodexWindowCandidate(
                    WindowId: windowId,
                    Title: title,
                    ProcessName: processName,
                    IsFocused: false,
                    IsMinimized: false));
            }
            catch
            {
                // Best-effort probe: ignore inaccessible processes.
            }
            finally
            {
                process.Dispose();
            }
        }

        return Task.FromResult<IReadOnlyList<CodexWindowCandidate>>(results);
    }
}
