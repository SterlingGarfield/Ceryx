export const gestureBindingIds = [
  "singleFingerDrag",
  "singleFingerTap",
  "doubleFingerDrag",
  "doubleFingerTap",
  "doubleFingerPinch",
  "tripleFingerDrag",
  "tripleFingerTap",
  "longPress"
] as const;

export type GestureBindingId = (typeof gestureBindingIds)[number];

export const gestureActionIds = [
  "none",
  "mouse_move",
  "left_click",
  "right_click",
  "scroll",
  "zoom",
  "press_hold",
  "toggle_toolbar",
  "hotkey"
] as const;

export type GestureActionId = (typeof gestureActionIds)[number];

export interface GestureMappingParams {
  hotkey?: string;
  sensitivity?: number;
  invertScroll?: boolean;
  zoomMode?: "pinch" | "drag";
}

export interface GestureMapping {
  action: GestureActionId | string;
  params?: GestureMappingParams;
}

export interface GestureDefinition {
  id: GestureBindingId;
  label: string;
  description: string;
  defaultMapping: GestureMapping;
}

export interface GestureProfile {
  id: string;
  name: string;
  bindings: Record<GestureBindingId, GestureMapping>;
}

export const gestureActionLabels: Record<GestureActionId, string> = {
  none: "Disabled",
  mouse_move: "Mouse move",
  left_click: "Left click",
  right_click: "Right click",
  scroll: "Scroll",
  zoom: "Zoom",
  press_hold: "Press and hold",
  toggle_toolbar: "Toggle toolbar",
  hotkey: "Hotkey"
};

export const gestureActionOptions: Array<{
  description: string;
  id: GestureActionId;
  label: string;
}> = [
  {
    id: "none",
    label: "Disabled",
    description: "Ignore this gesture."
  },
  {
    id: "mouse_move",
    label: "Mouse move",
    description: "Move the remote pointer while dragging."
  },
  {
    id: "left_click",
    label: "Left click",
    description: "Click the touched point."
  },
  {
    id: "right_click",
    label: "Right click",
    description: "Open the context menu."
  },
  {
    id: "scroll",
    label: "Scroll",
    description: "Scroll the remote viewport."
  },
  {
    id: "zoom",
    label: "Zoom",
    description: "Zoom the viewport or Codex canvas."
  },
  {
    id: "press_hold",
    label: "Press and hold",
    description: "Press the mouse button down briefly."
  },
  {
    id: "toggle_toolbar",
    label: "Toggle toolbar",
    description: "Show or hide the console toolbar."
  },
  {
    id: "hotkey",
    label: "Hotkey",
    description: "Send a custom key combination."
  }
];

export const defaultGestureDefinitions: GestureDefinition[] = [
  {
    id: "singleFingerDrag",
    label: "Single-finger drag",
    description: "Moves the remote pointer across the viewport.",
    defaultMapping: {
      action: "mouse_move",
      params: {
        sensitivity: 1
      }
    }
  },
  {
    id: "singleFingerTap",
    label: "Single-finger tap",
    description: "Clicks the touched point.",
    defaultMapping: {
      action: "left_click"
    }
  },
  {
    id: "doubleFingerDrag",
    label: "Two-finger drag",
    description: "Scrolls the remote viewport.",
    defaultMapping: {
      action: "scroll",
      params: {
        sensitivity: 1,
        invertScroll: false
      }
    }
  },
  {
    id: "doubleFingerTap",
    label: "Two-finger tap",
    description: "Opens the context menu.",
    defaultMapping: {
      action: "right_click"
    }
  },
  {
    id: "doubleFingerPinch",
    label: "Two-finger pinch",
    description: "Zooms the viewport in or out.",
    defaultMapping: {
      action: "zoom",
      params: {
        sensitivity: 1,
        zoomMode: "pinch"
      }
    }
  },
  {
    id: "tripleFingerDrag",
    label: "Three-finger drag",
    description: "Reserved for a custom shortcut or action.",
    defaultMapping: {
      action: "none"
    }
  },
  {
    id: "tripleFingerTap",
    label: "Three-finger tap",
    description: "Shows or hides the console toolbar.",
    defaultMapping: {
      action: "toggle_toolbar"
    }
  },
  {
    id: "longPress",
    label: "Long press",
    description: "Presses and holds the remote mouse button.",
    defaultMapping: {
      action: "press_hold"
    }
  }
];

const defaultGestureProfileBindings = defaultGestureDefinitions.reduce((accumulator, definition) => {
  accumulator[definition.id] = {
    action: definition.defaultMapping.action,
    params: definition.defaultMapping.params ? { ...definition.defaultMapping.params } : undefined
  };
  return accumulator;
}, {} as Record<GestureBindingId, GestureMapping>);

export const defaultGestureProfiles = {
  default: {
    id: "default",
    name: "Default",
    bindings: defaultGestureProfileBindings
  },
  precision: {
    id: "precision",
    name: "Precision",
    bindings: {
      singleFingerDrag: {
        action: "mouse_move",
        params: {
          sensitivity: 0.7
        }
      },
      singleFingerTap: {
        action: "left_click"
      },
      doubleFingerDrag: {
        action: "scroll",
        params: {
          sensitivity: 0.6,
          invertScroll: false
        }
      },
      doubleFingerTap: {
        action: "right_click"
      },
      doubleFingerPinch: {
        action: "zoom",
        params: {
          sensitivity: 0.75,
          zoomMode: "pinch"
        }
      },
      tripleFingerDrag: {
        action: "none"
      },
      tripleFingerTap: {
        action: "toggle_toolbar"
      },
      longPress: {
        action: "press_hold"
      }
    }
  }
} as const satisfies Record<string, GestureProfile>;

export type GestureProfileId = keyof typeof defaultGestureProfiles | "custom";

export function createGestureProfile(
  id: string,
  name: string,
  bindings: Record<GestureBindingId, GestureMapping>
): GestureProfile {
  return {
    id,
    name,
    bindings: normalizeGestureBindings(bindings)
  };
}

export function createDefaultCustomGestureProfile(baseProfile?: GestureProfile): GestureProfile {
  const source = normalizeGestureProfile(baseProfile ?? defaultGestureProfiles.default);
  return {
    id: "custom",
    name: "Custom",
    bindings: cloneGestureBindings(source.bindings)
  };
}

export function resolveGestureProfile(
  activeGestureProfile?: string | null,
  customGestures?: GestureProfile | null
): GestureProfile {
  if (activeGestureProfile === "custom") {
    return normalizeGestureProfile(customGestures ?? createDefaultCustomGestureProfile());
  }

  if (activeGestureProfile && activeGestureProfile in defaultGestureProfiles) {
    return normalizeGestureProfile(defaultGestureProfiles[activeGestureProfile as keyof typeof defaultGestureProfiles]);
  }

  return normalizeGestureProfile(defaultGestureProfiles.default);
}

export function normalizeGestureProfile(profile?: GestureProfile | null): GestureProfile {
  const fallback = defaultGestureProfiles.default;
  if (!profile) {
    return createGestureProfile(fallback.id, fallback.name, fallback.bindings);
  }

  return {
    id: profile.id || fallback.id,
    name: profile.name || (profile.id === "custom" ? "Custom" : fallback.name),
    bindings: normalizeGestureBindings(profile.bindings, fallback.bindings)
  };
}

export function normalizeGestureBindings(
  bindings: Partial<Record<GestureBindingId, GestureMapping>> | undefined,
  fallbackBindings: Record<GestureBindingId, GestureMapping> = defaultGestureProfiles.default.bindings
): Record<GestureBindingId, GestureMapping> {
  const normalized = {} as Record<GestureBindingId, GestureMapping>;
  for (const bindingId of gestureBindingIds) {
    normalized[bindingId] = normalizeGestureMapping(bindings?.[bindingId], fallbackBindings[bindingId]);
  }

  return normalized;
}

export function gestureBindingsForProfile(profile: GestureProfile): Array<{
  definition: GestureDefinition;
  mapping: GestureMapping;
}> {
  const normalized = normalizeGestureProfile(profile);
  return defaultGestureDefinitions.map((definition) => ({
    definition,
    mapping: normalized.bindings[definition.id]
  }));
}

export function gestureActionLabel(action: GestureActionId | string): string {
  return action in gestureActionLabels ? gestureActionLabels[action as GestureActionId] : action;
}

function cloneGestureBindings(bindings: Record<GestureBindingId, GestureMapping>): Record<GestureBindingId, GestureMapping> {
  const cloned = {} as Record<GestureBindingId, GestureMapping>;
  for (const bindingId of gestureBindingIds) {
    cloned[bindingId] = normalizeGestureMapping(bindings[bindingId], defaultGestureDefinitions.find((definition) => definition.id === bindingId)?.defaultMapping);
  }

  return cloned;
}

function normalizeGestureMapping(
  mapping: GestureMapping | undefined,
  fallbackMapping: GestureMapping | undefined
): GestureMapping {
  const source = mapping ?? fallbackMapping ?? { action: "none" };
  const action = gestureActionIds.includes(source.action as GestureActionId)
    ? (source.action as GestureActionId)
    : ((fallbackMapping?.action as GestureActionId) ?? "none");

  const fallbackParams = fallbackMapping?.params ?? {};
  const sourceParams = source.params ?? {};
  const params: GestureMappingParams = {};

  if (action === "mouse_move" || action === "scroll" || action === "zoom") {
    const sensitivity = normalizeSensitivity(
      sourceParams.sensitivity ?? fallbackParams.sensitivity ?? 1
    );
    params.sensitivity = sensitivity;
  }

  if (action === "scroll") {
    params.invertScroll = sourceParams.invertScroll ?? fallbackParams.invertScroll ?? false;
  }

  if (action === "zoom") {
    params.zoomMode = sourceParams.zoomMode === "drag" ? "drag" : (fallbackParams.zoomMode ?? "pinch");
  }

  if (action === "hotkey") {
    const hotkey = (sourceParams.hotkey ?? fallbackParams.hotkey ?? "").trim();
    if (hotkey) {
      params.hotkey = hotkey;
    }
  }

  return Object.keys(params).length > 0
    ? { action, params }
    : { action };
}

function normalizeSensitivity(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }

  return Math.min(3, Math.max(0.1, Number(value)));
}
