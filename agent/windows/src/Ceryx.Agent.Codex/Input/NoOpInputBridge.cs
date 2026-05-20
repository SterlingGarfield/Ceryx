using Ceryx.Agent.Core;

namespace Ceryx.Agent.Codex.Input;

public sealed class NoOpInputBridge : IInputBridge
{
    private readonly IInputCommandMapper _mapper;

    public NoOpInputBridge(IInputCommandMapper mapper)
    {
        _mapper = mapper ?? throw new ArgumentNullException(nameof(mapper));
    }

    public Task<InputExecutionResult> ExecuteKeyAsync(
        InputExecutionContext context,
        InputKeyBody body,
        CancellationToken cancellationToken = default)
    {
        _ = _mapper.MapKey(body);
        return Task.FromResult(new InputExecutionResult(
            IsAccepted: true,
            Action: "input.key",
            Status: "applied",
            Message: $"Key input accepted for window {context.WindowId}."));
    }

    public Task<InputExecutionResult> ExecuteMouseAsync(
        InputExecutionContext context,
        InputMouseBody body,
        CancellationToken cancellationToken = default)
    {
        _ = _mapper.MapMouse(body);
        return Task.FromResult(new InputExecutionResult(
            IsAccepted: true,
            Action: "input.mouse",
            Status: "applied",
            Message: $"Mouse input accepted for window {context.WindowId}."));
    }
}
