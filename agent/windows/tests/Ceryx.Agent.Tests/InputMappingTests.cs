using Ceryx.Agent.Codex.Input;
using Ceryx.Agent.Core;
using Xunit;

namespace Ceryx.Agent.Tests;

public sealed class InputMappingTests
{
    [Fact]
    public void InputMapping_MapsKeyAndMouse()
    {
        var mapper = new DefaultInputCommandMapper();
        var key = mapper.MapKey(new InputKeyBody(
            Key: "Enter",
            Action: "down",
            Modifiers: ["Ctrl"]));
        var mouse = mapper.MapMouse(new InputMouseBody(
            X: 100,
            Y: 120,
            Button: "left",
            Action: "click"));

        Assert.Equal("key:[Ctrl]+Enter:down", key[0]);
        Assert.Equal("mouse:left:click@100,120", mouse[0]);
    }

    [Fact]
    public void InputMapping_HotkeyRequiresKeys()
    {
        var mapper = new DefaultInputCommandMapper();
        Assert.Throws<ArgumentException>(() => mapper.MapHotkey(new InputHotkeyBody([])));
    }
}
