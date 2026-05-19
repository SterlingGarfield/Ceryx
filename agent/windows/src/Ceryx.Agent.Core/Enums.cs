namespace Ceryx.Agent.Core;

public enum AgentRuntimeStatus
{
    Starting = 0,
    Running = 1,
    Paused = 2,
    Stopping = 3,
    Error = 4
}

public enum CodexWindowStatus
{
    NotFound = 0,
    Found = 1,
    Focused = 2,
    Minimized = 3,
    Closed = 4,
    MultipleCandidates = 5,
    PermissionIssue = 6
}

public enum ClientType
{
    Ipad = 0,
    Desktop = 1
}

public enum Permission
{
    ViewWindow = 0,
    ControlInput = 1,
    SendPrompt = 2,
    UploadImage = 3,
    ReadDiff = 4,
    RunTest = 5,
    Screenshot = 6,
    Recording = 7,
    CopyOutput = 8,
    ManageAgent = 9,
    ManageDevices = 10
}

public static class WireValueExtensions
{
    public static string ToWireValue(this AgentRuntimeStatus value)
    {
        return value switch
        {
            AgentRuntimeStatus.Starting => "starting",
            AgentRuntimeStatus.Running => "running",
            AgentRuntimeStatus.Paused => "paused",
            AgentRuntimeStatus.Stopping => "stopping",
            AgentRuntimeStatus.Error => "error",
            _ => throw new ArgumentOutOfRangeException(nameof(value), value, null)
        };
    }

    public static string ToWireValue(this CodexWindowStatus value)
    {
        return value switch
        {
            CodexWindowStatus.NotFound => "not_found",
            CodexWindowStatus.Found => "found",
            CodexWindowStatus.Focused => "focused",
            CodexWindowStatus.Minimized => "minimized",
            CodexWindowStatus.Closed => "closed",
            CodexWindowStatus.MultipleCandidates => "multiple_candidates",
            CodexWindowStatus.PermissionIssue => "permission_issue",
            _ => throw new ArgumentOutOfRangeException(nameof(value), value, null)
        };
    }

    public static string ToWireValue(this ClientType value)
    {
        return value switch
        {
            ClientType.Ipad => "ipad",
            ClientType.Desktop => "desktop",
            _ => throw new ArgumentOutOfRangeException(nameof(value), value, null)
        };
    }

    public static string ToWireValue(this Permission value)
    {
        return value switch
        {
            Permission.ViewWindow => "view_window",
            Permission.ControlInput => "control_input",
            Permission.SendPrompt => "send_prompt",
            Permission.UploadImage => "upload_image",
            Permission.ReadDiff => "read_diff",
            Permission.RunTest => "run_test",
            Permission.Screenshot => "screenshot",
            Permission.Recording => "recording",
            Permission.CopyOutput => "copy_output",
            Permission.ManageAgent => "manage_agent",
            Permission.ManageDevices => "manage_devices",
            _ => throw new ArgumentOutOfRangeException(nameof(value), value, null)
        };
    }
}
