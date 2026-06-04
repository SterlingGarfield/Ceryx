export const shortcutCategories = [
  "capture",
  "input",
  "media",
  "clipboard",
  "window",
  "navigation"
] as const;

export type ShortcutCategory = (typeof shortcutCategories)[number];

export interface ShortcutDefinition {
  id: string;
  label: string;
  defaultKeys: string;
  category: ShortcutCategory;
}

export interface ShortcutProfile {
  id: string;
  name: string;
  bindings: Record<string, string>;
}

export const shortcutDefinitionIds = [
  "capture.toggle",
  "media.screenshot",
  "input.prompt.send",
  "window.focus",
  "navigation.diff",
  "navigation.logs",
  "navigation.settings",
  "clipboard.sendToWindows",
  "help.toggle"
] as const;

export type ShortcutActionId = (typeof shortcutDefinitionIds)[number];

export const defaultShortcutDefinitions: ShortcutDefinition[] = [
  {
    id: "capture.toggle",
    label: "Start or stop capture",
    defaultKeys: "Ctrl+Shift+C",
    category: "capture"
  },
  {
    id: "media.screenshot",
    label: "Take screenshot",
    defaultKeys: "Ctrl+Shift+S",
    category: "media"
  },
  {
    id: "input.prompt.send",
    label: "Send prompt",
    defaultKeys: "Ctrl+Enter",
    category: "input"
  },
  {
    id: "window.focus",
    label: "Focus Codex",
    defaultKeys: "Ctrl+Shift+F",
    category: "window"
  },
  {
    id: "navigation.diff",
    label: "Open diff workspace",
    defaultKeys: "Ctrl+Shift+D",
    category: "navigation"
  },
  {
    id: "navigation.logs",
    label: "Open logs workspace",
    defaultKeys: "Ctrl+Shift+L",
    category: "navigation"
  },
  {
    id: "navigation.settings",
    label: "Open settings workspace",
    defaultKeys: "Ctrl+,",
    category: "navigation"
  },
  {
    id: "clipboard.sendToWindows",
    label: "Send clipboard to Windows",
    defaultKeys: "Ctrl+Shift+V",
    category: "clipboard"
  },
  {
    id: "help.toggle",
    label: "Shortcut help",
    defaultKeys: "?",
    category: "navigation"
  }
];

export const defaultShortcutProfiles = {
  "vscode-style": {
    id: "vscode-style",
    name: "VSCode Style",
    bindings: {
      "capture.toggle": "Ctrl+Shift+C",
      "media.screenshot": "Ctrl+Shift+S",
      "input.prompt.send": "Ctrl+Enter",
      "window.focus": "Ctrl+Shift+F",
      "navigation.diff": "Ctrl+Shift+D",
      "navigation.logs": "Ctrl+Shift+L",
      "navigation.settings": "Ctrl+,",
      "clipboard.sendToWindows": "Ctrl+Shift+V",
      "help.toggle": "?"
    }
  },
  "jetbrains-style": {
    id: "jetbrains-style",
    name: "JetBrains Style",
    bindings: {
      "capture.toggle": "Ctrl+Alt+C",
      "media.screenshot": "Ctrl+Alt+Shift+S",
      "input.prompt.send": "Ctrl+Enter",
      "window.focus": "Ctrl+Alt+F",
      "navigation.diff": "Ctrl+Alt+D",
      "navigation.logs": "Ctrl+Alt+L",
      "navigation.settings": "Ctrl+Alt+S",
      "clipboard.sendToWindows": "Ctrl+Alt+V",
      "help.toggle": "?"
    }
  },
  "minimal-style": {
    id: "minimal-style",
    name: "Minimal Style",
    bindings: {
      "capture.toggle": "Ctrl+Shift+C",
      "media.screenshot": "Ctrl+Shift+S",
      "input.prompt.send": "Ctrl+Enter",
      "navigation.settings": "Ctrl+,",
      "clipboard.sendToWindows": "Ctrl+Shift+V",
      "help.toggle": "?"
    }
  }
} as const satisfies Record<string, ShortcutProfile>;

export type ShortcutProfileId = keyof typeof defaultShortcutProfiles | "custom";

export function createDefaultCustomShortcutProfile(baseProfile?: ShortcutProfile): ShortcutProfile {
  const source = baseProfile ?? defaultShortcutProfiles["vscode-style"];
  return {
    id: "custom",
    name: "Custom",
    bindings: { ...source.bindings }
  };
}

export function createShortcutProfile(
  id: string,
  name: string,
  bindings: Record<string, string>
): ShortcutProfile {
  return {
    id,
    name,
    bindings: { ...bindings }
  };
}
