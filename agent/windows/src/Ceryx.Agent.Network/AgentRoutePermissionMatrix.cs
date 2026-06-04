using Ceryx.Agent.Core;

namespace Ceryx.Agent.Network;

public sealed record AgentRoutePermissionEntry(
    string Method,
    string Path,
    bool AllowAnonymous,
    Permission? RequiredPermission,
    bool LocalOnly = false);

public static class AgentRoutePermissionMatrix
{
    public static IReadOnlyList<AgentRoutePermissionEntry> Entries { get; } =
    [
        new("GET", "/api/v1/health", true, null),
        new("POST", "/api/v1/pairing/request", true, null),
        new("POST", "/api/v1/pairing/desktop-confirm", true, null, LocalOnly: true),
        new("POST", "/api/v1/pairing/confirm", true, null),
        new("GET", "/api/v1/devices", false, Permission.ManageDevices),
        new("DELETE", "/api/v1/devices/{deviceId}", false, Permission.ManageDevices),
        new("GET", "/api/v1/agent/status", false, null),
        new("GET", "/api/v1/agent/paths", false, null),
        new("GET", "/api/v1/agent/connection-stats", false, Permission.ViewWindow),
        new("GET", "/api/v1/codex/window", false, Permission.ViewWindow),
        new("GET", "/api/v1/codex/windows", false, Permission.ViewWindow),
        new("POST", "/api/v1/codex/focus", false, Permission.ControlInput),
        new("POST", "/api/v1/codex/refresh", false, Permission.ViewWindow),
        new("POST", "/api/v1/codex/select-window", false, Permission.ControlInput),
        new("POST", "/api/v1/input/key", false, Permission.ControlInput),
        new("POST", "/api/v1/input/mouse", false, Permission.ControlInput),
        new("POST", "/api/v1/input/scroll", false, Permission.ControlInput),
        new("POST", "/api/v1/input/hotkey", false, Permission.ControlInput),
        new("POST", "/api/v1/input/text", false, Permission.ControlInput),
        new("POST", "/api/v1/prompt/send", false, Permission.SendPrompt),
        new("POST", "/api/v1/clipboard/send", false, Permission.ManageAgent),
        new("GET", "/api/v1/clipboard/receive", false, Permission.ManageAgent),
        new("POST", "/api/v1/clipboard/clear", false, Permission.ManageAgent),
        new("POST", "/api/v1/capture/start", false, Permission.ViewWindow),
        new("POST", "/api/v1/capture/stop", false, Permission.ViewWindow),
        new("GET", "/api/v1/capture/state", false, Permission.ViewWindow),
        new("GET", "/api/v1/capture/frame", false, Permission.ViewWindow),
        new("POST", "/api/v1/capture/webrtc/signal", false, Permission.ViewWindow),
        new("POST", "/api/v1/files/upload", false, Permission.ManageAgent),
        new("GET", "/api/v1/files/list", false, Permission.ManageAgent),
        new("GET", "/api/v1/files/download/{fileId}", false, Permission.ManageAgent),
        new("DELETE", "/api/v1/files/{fileId}", false, Permission.ManageAgent),
        new("POST", "/api/v1/assets/upload-image", false, Permission.UploadImage),
        new("GET", "/api/v1/project/diff", false, Permission.ReadDiff),
        new("GET", "/api/v1/project/diff/files", false, Permission.ReadDiff),
        new("GET", "/api/v1/project/diff/file", false, Permission.ReadDiff),
        new("GET", "/api/v1/project/files", false, Permission.ReadDiff),
        new("POST", "/api/v1/project/test-request", false, Permission.RunTest),
        new("GET", "/api/v1/project/tasks", false, null),
        new("POST", "/api/v1/media/screenshot", false, Permission.Screenshot),
        new("POST", "/api/v1/media/recording/start", false, Permission.Recording),
        new("POST", "/api/v1/media/recording/stop", false, Permission.Recording),
        new("GET", "/api/v1/media/recordings", false, Permission.Recording),
        new("GET", "/api/v1/media/recordings/download/{fileName}", false, Permission.Recording),
        new("POST", "/api/v1/agent/pause-control", false, Permission.ManageAgent, LocalOnly: true),
        new("POST", "/api/v1/agent/resume-control", false, Permission.ManageAgent, LocalOnly: true),
        new("POST", "/api/v1/agent/open-logs-folder", false, Permission.ManageAgent, LocalOnly: true),
        new("POST", "/api/v1/agent/restart-request", false, Permission.ManageAgent, LocalOnly: true),
        new("GET", "/api/v1/logs", false, null),
        new("GET", "/api/v1/settings", false, null),
        new("PATCH", "/api/v1/settings", false, Permission.ManageAgent),
        new("GET", "/api/v1/notifications", false, null),
        new("POST", "/api/v1/notifications/{notificationId}/read", false, null),
        new("POST", "/api/v1/notifications/clear", false, null)
    ];

    public static bool TryFind(string method, string path, out AgentRoutePermissionEntry? entry)
    {
        entry = Entries.FirstOrDefault(item =>
            string.Equals(item.Method, method, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(item.Path, path, StringComparison.Ordinal));
        return entry is not null;
    }
}
