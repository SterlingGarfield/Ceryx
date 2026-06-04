import { useEffect, useMemo } from "react";
import {
  createDefaultCustomShortcutProfile,
  defaultShortcutDefinitions,
  defaultShortcutProfiles,
  type ShortcutActionId,
  type ShortcutDefinition,
  type ShortcutProfile,
  type ShortcutProfileId
} from "@ceryx/protocol";

export {
  createDefaultCustomShortcutProfile,
  defaultShortcutDefinitions,
  defaultShortcutProfiles
} from "@ceryx/protocol";
export type {
  ShortcutActionId,
  ShortcutDefinition,
  ShortcutProfile,
  ShortcutProfileId
} from "@ceryx/protocol";

const modifierOrder = ["Ctrl", "Alt", "Shift", "Meta"] as const;
const modifierAliases: Record<string, (typeof modifierOrder)[number]> = {
  ctrl: "Ctrl",
  control: "Ctrl",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  meta: "Meta",
  cmd: "Meta",
  command: "Meta",
  win: "Meta",
  super: "Meta"
};

function cloneProfile(profile: ShortcutProfile): ShortcutProfile {
  return {
    id: profile.id,
    name: profile.name,
    bindings: { ...profile.bindings }
  };
}

function normalizeKeyToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed === "?") {
    return "?";
  }

  if (trimmed.length === 1) {
    return trimmed.toUpperCase();
  }

  return trimmed[0].toUpperCase() + trimmed.slice(1).toLowerCase();
}

function splitShortcutCombo(combo: string): { modifiers: Set<(typeof modifierOrder)[number]>; key: string } {
  const parts = combo
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);

  const modifiers = new Set<(typeof modifierOrder)[number]>();
  let key = "";

  for (const part of parts) {
    const normalized = modifierAliases[part.toLowerCase()];
    if (normalized) {
      modifiers.add(normalized);
      continue;
    }

    key = normalizeKeyToken(part);
  }

  return { modifiers, key };
}

function joinShortcutCombo(modifiers: Set<(typeof modifierOrder)[number]>, key: string): string {
  const orderedModifiers = modifierOrder.filter((modifier) => modifiers.has(modifier));
  const normalizedKey = normalizeKeyToken(key);
  if (!normalizedKey) {
    return orderedModifiers.join("+");
  }

  if (normalizedKey === "?") {
    return "?";
  }

  return [...orderedModifiers, normalizedKey].join("+");
}

export function normalizeShortcutCombo(combo: string): string {
  const trimmed = combo.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed === "?") {
    return "?";
  }

  const { modifiers, key } = splitShortcutCombo(trimmed);
  return joinShortcutCombo(modifiers, key);
}

export function shortcutEventToCombo(event: KeyboardEvent): string {
  if (event.key === "?") {
    return "?";
  }

  if (event.key === "/" && event.shiftKey) {
    return "?";
  }

  const modifiers = new Set<(typeof modifierOrder)[number]>();
  if (event.ctrlKey) {
    modifiers.add("Ctrl");
  }
  if (event.altKey) {
    modifiers.add("Alt");
  }
  if (event.shiftKey) {
    modifiers.add("Shift");
  }
  if (event.metaKey) {
    modifiers.add("Meta");
  }

  return joinShortcutCombo(modifiers, event.key);
}

export function resolveShortcutProfile(
  profileId: string,
  customProfile?: ShortcutProfile
): ShortcutProfile {
  const preset = defaultShortcutProfiles[profileId as keyof typeof defaultShortcutProfiles];
  if (preset) {
    return cloneProfile(preset);
  }

  if (profileId !== "custom") {
    return cloneProfile(defaultShortcutProfiles["vscode-style"]);
  }

  const baseProfile = createDefaultCustomShortcutProfile();
  const source = customProfile ?? baseProfile;
  return {
    id: "custom",
    name: source.name || "Custom",
    bindings: normalizeShortcutBindings({
      ...baseProfile.bindings,
      ...source.bindings
    })
  };
}

export function normalizeShortcutBindings(bindings: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [actionId, combo] of Object.entries(bindings)) {
    const value = normalizeShortcutCombo(combo);
    if (value) {
      normalized[actionId] = value;
    }
  }
  return normalized;
}

export function shortcutBindingsForProfile(
  profile: ShortcutProfile,
  definitions: ShortcutDefinition[] = defaultShortcutDefinitions
): Record<ShortcutActionId, string> {
  const resolved = normalizeShortcutBindings(profile.bindings);
  const output: Partial<Record<ShortcutActionId, string>> = {};

  for (const definition of definitions) {
    const binding = resolved[definition.id] ?? normalizeShortcutCombo(definition.defaultKeys);
    if (binding) {
      output[definition.id as ShortcutActionId] = binding;
    }
  }

  return output as Record<ShortcutActionId, string>;
}

export function shortcutProfileMatchesEvent(
  profile: ShortcutProfile,
  event: KeyboardEvent,
  definitions: ShortcutDefinition[] = defaultShortcutDefinitions
): ShortcutActionId | null {
  const combo = shortcutEventToCombo(event);
  const bindings = shortcutBindingsForProfile(profile, definitions);
  const match = Object.entries(bindings).find(([, binding]) => binding === combo);
  return (match?.[0] as ShortcutActionId | undefined) ?? null;
}

export function detectShortcutConflicts(
  bindings: Record<string, string>
): Array<{ combo: string; actionIds: string[] }> {
  const normalized = normalizeShortcutBindings(bindings);
  const reverse = new Map<string, string[]>();

  for (const [actionId, combo] of Object.entries(normalized)) {
    const bucket = reverse.get(combo) ?? [];
    bucket.push(actionId);
    reverse.set(combo, bucket);
  }

  return [...reverse.entries()]
    .filter(([, actionIds]) => actionIds.length > 1)
    .map(([combo, actionIds]) => ({ combo, actionIds }));
}

export interface UseKeyboardShortcutsOptions {
  enabled: boolean;
  profileId: ShortcutProfileId | string;
  customProfile?: ShortcutProfile;
  definitions?: ShortcutDefinition[];
  onAction: (actionId: ShortcutActionId) => void;
  onHelp?: () => void;
  shouldIgnoreEvent?: (event: KeyboardEvent) => boolean;
}

export function useKeyboardShortcuts({
  enabled,
  profileId,
  customProfile,
  definitions = defaultShortcutDefinitions,
  onAction,
  onHelp,
  shouldIgnoreEvent
}: UseKeyboardShortcutsOptions): {
  profile: ShortcutProfile;
  bindings: Record<ShortcutActionId, string>;
  conflicts: Array<{ combo: string; actionIds: string[] }>;
} {
  const profile = useMemo(() => resolveShortcutProfile(profileId, customProfile), [customProfile, profileId]);
  const bindings = useMemo(() => shortcutBindingsForProfile(profile, definitions), [definitions, profile]);
  const conflicts = useMemo(() => detectShortcutConflicts(profile.bindings), [profile.bindings]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (shouldIgnoreEvent?.(event)) {
        return;
      }

      const actionId = shortcutProfileMatchesEvent(profile, event, definitions);
      if (!actionId) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (actionId === "help.toggle") {
        onHelp?.();
        return;
      }

      onAction(actionId);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [definitions, enabled, onAction, onHelp, profile, shouldIgnoreEvent]);

  return { profile, bindings, conflicts };
}
