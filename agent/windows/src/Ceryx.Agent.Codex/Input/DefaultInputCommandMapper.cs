using Ceryx.Agent.Core;

namespace Ceryx.Agent.Codex.Input;

public sealed class DefaultInputCommandMapper : IInputCommandMapper
{
    public IReadOnlyList<string> MapKey(InputKeyBody body)
    {
        ArgumentNullException.ThrowIfNull(body);
        if (string.IsNullOrWhiteSpace(body.Key))
        {
            throw new ArgumentException("Key is required.", nameof(body));
        }

        var mods = body.Modifiers is { Count: > 0 }
            ? $"[{string.Join("+", body.Modifiers)}]+"
            : string.Empty;
        return [$"key:{mods}{body.Key}:{body.Action}"];
    }

    public IReadOnlyList<string> MapMouse(InputMouseBody body)
    {
        ArgumentNullException.ThrowIfNull(body);
        return [$"mouse:{body.Button}:{body.Action}@{body.X},{body.Y}"];
    }

    public IReadOnlyList<string> MapScroll(InputScrollBody body)
    {
        ArgumentNullException.ThrowIfNull(body);
        return [$"scroll:{body.DeltaX},{body.DeltaY}"];
    }

    public IReadOnlyList<string> MapHotkey(InputHotkeyBody body)
    {
        ArgumentNullException.ThrowIfNull(body);
        if (body.Keys.Count == 0)
        {
            throw new ArgumentException("Hotkey keys cannot be empty.", nameof(body));
        }

        return [$"hotkey:{string.Join("+", body.Keys)}"];
    }

    public IReadOnlyList<string> MapText(InputTextBody body)
    {
        ArgumentNullException.ThrowIfNull(body);
        return [$"text:{body.Text}"];
    }
}
