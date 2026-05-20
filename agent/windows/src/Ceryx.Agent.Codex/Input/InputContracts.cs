using Ceryx.Agent.Core;

namespace Ceryx.Agent.Codex.Input;

public sealed record InputExecutionContext(
    string WindowId,
    string DeviceId,
    string TraceId
);

public sealed record InputExecutionResult(
    bool IsAccepted,
    string Action,
    string Status,
    string Message
);

public interface IInputBridge
{
    Task<InputExecutionResult> ExecuteKeyAsync(
        InputExecutionContext context,
        InputKeyBody body,
        CancellationToken cancellationToken = default);

    Task<InputExecutionResult> ExecuteMouseAsync(
        InputExecutionContext context,
        InputMouseBody body,
        CancellationToken cancellationToken = default);
}

public interface IInputCommandMapper
{
    IReadOnlyList<string> MapKey(InputKeyBody body);

    IReadOnlyList<string> MapMouse(InputMouseBody body);

    IReadOnlyList<string> MapScroll(InputScrollBody body);

    IReadOnlyList<string> MapHotkey(InputHotkeyBody body);

    IReadOnlyList<string> MapText(InputTextBody body);
}
