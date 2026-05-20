using Ceryx.Agent.Core;

namespace Ceryx.Agent.Security.Devices;

public interface IDefaultPermissionPolicy
{
    IReadOnlyList<Permission> ResolveForClient(string clientType);
}

public sealed class DefaultPermissionPolicy : IDefaultPermissionPolicy
{
    private static readonly IReadOnlyList<Permission> IpadPermissions =
    [
        Permission.ViewWindow,
        Permission.SendPrompt,
        Permission.UploadImage,
        Permission.ReadDiff,
        Permission.Screenshot,
        Permission.Recording,
        Permission.CopyOutput
    ];

    private static readonly IReadOnlyList<Permission> DesktopPermissions =
    [
        Permission.ViewWindow,
        Permission.ControlInput,
        Permission.SendPrompt,
        Permission.UploadImage,
        Permission.ReadDiff,
        Permission.RunTest,
        Permission.Screenshot,
        Permission.Recording,
        Permission.CopyOutput,
        Permission.ManageAgent,
        Permission.ManageDevices
    ];

    public IReadOnlyList<Permission> ResolveForClient(string clientType)
    {
        if (string.Equals(clientType, "desktop", StringComparison.OrdinalIgnoreCase))
        {
            return DesktopPermissions;
        }

        return IpadPermissions;
    }
}
