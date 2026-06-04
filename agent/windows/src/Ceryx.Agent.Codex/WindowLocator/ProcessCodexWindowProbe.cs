using System.Diagnostics;
using System.Runtime.InteropServices;

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

                var hwnd = process.MainWindowHandle;
                var windowId = $"hwnd_{process.Id:X}_{hwnd.ToInt64():X}";
                results.Add(new CodexWindowCandidate(
                    WindowId: windowId,
                    Title: title,
                    ProcessName: processName,
                    IsFocused: GetForegroundWindow() == hwnd,
                    IsMinimized: IsIconic(hwnd),
                    ProcessId: process.Id));
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

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool IsIconic(IntPtr hWnd);
}
