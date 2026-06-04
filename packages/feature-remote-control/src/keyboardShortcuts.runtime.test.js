import { describe, expect, it } from "vitest";
import {
  defaultShortcutDefinitions,
  defaultShortcutProfiles,
  detectShortcutConflicts,
  normalizeShortcutCombo,
  resolveShortcutProfile,
  shortcutEventToCombo,
  shortcutProfileMatchesEvent
} from "../dist/keyboardShortcuts.js";

describe("keyboard shortcut helpers", () => {
  it("normalizes shortcut combo strings into canonical casing and order", () => {
    expect(normalizeShortcutCombo("shift+ctrl+c")).toBe("Ctrl+Shift+C");
    expect(normalizeShortcutCombo("cmd+alt+s")).toBe("Alt+Meta+S");
    expect(normalizeShortcutCombo("  ctrl + , ")).toBe("Ctrl+,");
  });

  it("resolves preset profiles with default bindings", () => {
    const profile = resolveShortcutProfile("vscode-style");
    expect(profile.id).toBe("vscode-style");
    expect(profile.bindings["navigation.diff"]).toBe("Ctrl+Shift+D");
    expect(profile.bindings["navigation.settings"]).toBe("Ctrl+,");
  });

  it("falls back to the custom profile when requested", () => {
    const customProfile = {
      id: "custom",
      name: "Custom",
      bindings: {
        "navigation.diff": "Ctrl+Alt+D",
        "help.toggle": "?"
      }
    };

    const profile = resolveShortcutProfile("custom", customProfile);
    expect(profile.bindings["navigation.diff"]).toBe("Ctrl+Alt+D");
    expect(profile.bindings["help.toggle"]).toBe("?");
  });

  it("matches keyboard events to preset actions", () => {
    const profile = defaultShortcutProfiles["vscode-style"];
    const event = new KeyboardEvent("keydown", { key: "d", ctrlKey: true, shiftKey: true });

    expect(shortcutEventToCombo(event)).toBe("Ctrl+Shift+D");
    expect(shortcutProfileMatchesEvent(profile, event, defaultShortcutDefinitions)).toBe("navigation.diff");
  });

  it("recognizes help shortcut events", () => {
    const profile = defaultShortcutProfiles["minimal-style"];
    const event = new KeyboardEvent("keydown", { key: "?", shiftKey: true });

    expect(shortcutEventToCombo(event)).toBe("?");
    expect(shortcutProfileMatchesEvent(profile, event, defaultShortcutDefinitions)).toBe("help.toggle");
  });

  it("detects conflicting shortcut combos", () => {
    const conflicts = detectShortcutConflicts({
      "navigation.diff": "Ctrl+Alt+D",
      "window.focus": "Ctrl+Alt+D",
      "help.toggle": "?"
    });

    expect(conflicts).toEqual([
      {
        combo: "Ctrl+Alt+D",
        actionIds: ["navigation.diff", "window.focus"]
      }
    ]);
  });
});
