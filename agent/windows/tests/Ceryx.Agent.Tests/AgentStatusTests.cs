using System.Text.Json;
using Ceryx.Agent.Core;
using Xunit;

namespace Ceryx.Agent.Tests;

public class AgentStatusTests
{
    [Fact]
    public void AgentStatusResponse_UsesProtocolPropertyNames()
    {
        var response = new AgentStatusResponse(
            AgentVersion: "0.3.0",
            DeviceName: "Local Windows PC",
            Platform: "windows",
            Status: AgentRuntimeStatus.Running.ToWireValue(),
            HttpPort: 41527,
            SupportsWebRTC: true,
            SupportsDesktopClient: true,
            CodexStatus: CodexWindowStatus.NotFound.ToWireValue());

        using var document = JsonDocument.Parse(JsonSerializer.Serialize(response));
        var root = document.RootElement;

        Assert.True(root.TryGetProperty("agentVersion", out _));
        Assert.True(root.TryGetProperty("deviceName", out _));
        Assert.True(root.TryGetProperty("platform", out _));
        Assert.True(root.TryGetProperty("status", out _));
        Assert.True(root.TryGetProperty("httpPort", out _));
        Assert.True(root.TryGetProperty("supportsWebRTC", out _));
        Assert.True(root.TryGetProperty("supportsDesktopClient", out _));
        Assert.True(root.TryGetProperty("codexStatus", out _));
    }

    [Fact]
    public void WireValueMappings_MatchProtocolStrings()
    {
        Assert.Equal("starting", AgentRuntimeStatus.Starting.ToWireValue());
        Assert.Equal("running", AgentRuntimeStatus.Running.ToWireValue());
        Assert.Equal("paused", AgentRuntimeStatus.Paused.ToWireValue());
        Assert.Equal("stopping", AgentRuntimeStatus.Stopping.ToWireValue());
        Assert.Equal("error", AgentRuntimeStatus.Error.ToWireValue());

        Assert.Equal("not_found", CodexWindowStatus.NotFound.ToWireValue());
        Assert.Equal("multiple_candidates", CodexWindowStatus.MultipleCandidates.ToWireValue());
        Assert.Equal("permission_issue", CodexWindowStatus.PermissionIssue.ToWireValue());

        Assert.Equal("ipad", ClientType.Ipad.ToWireValue());
        Assert.Equal("desktop", ClientType.Desktop.ToWireValue());

        Assert.Equal("manage_agent", Permission.ManageAgent.ToWireValue());
        Assert.Equal("manage_devices", Permission.ManageDevices.ToWireValue());
        Assert.Equal("control_input", Permission.ControlInput.ToWireValue());
    }
}
