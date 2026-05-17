export const KEYBOARD_SHORTCUTS_PREF = "keyboardShortcuts";

export type KeyboardShortcutPlatform =
  | "darwin"
  | "win32"
  | "linux"
  | "other";

export type KeyboardShortcutCategory =
  | "Application"
  | "Navigation"
  | "Canvas"
  | "View";

export type KeyboardShortcutActionId =
  | "toggle-settings"
  | "sidebar-files"
  | "toggle-agent"
  | "add-workspace"
  | "focus-file-search"
  | "new-tile"
  | "close-tile"
  | "focus-tile-left"
  | "focus-tile-right"
  | "focus-tile-up"
  | "focus-tile-down"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | "toggle-full-screen";

export interface KeyboardShortcutModifiers {
  cmdOrCtrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  control?: boolean;
  meta?: boolean;
}

export interface KeyboardShortcutBinding {
  code: string;
  key: string;
  modifiers: KeyboardShortcutModifiers;
}

export type KeyboardShortcutOverride =
  | KeyboardShortcutBinding[]
  | null;

export type KeyboardShortcutOverrides = Partial<
  Record<KeyboardShortcutActionId, KeyboardShortcutOverride>
>;

export interface KeyboardShortcutDefinition {
  id: KeyboardShortcutActionId;
  label: string;
  category: KeyboardShortcutCategory;
  defaultBindings: readonly KeyboardShortcutBinding[];
  defaultBindingsByPlatform?: Partial<
    Record<KeyboardShortcutPlatform, readonly KeyboardShortcutBinding[]>
  >;
}

export interface KeyboardShortcutInputLike {
  type?: string;
  code?: string;
  key?: string;
  alt?: boolean;
  meta?: boolean;
  control?: boolean;
  shift?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  isAutoRepeat?: boolean;
  repeat?: boolean;
}

const MODIFIER_KEYS = new Set([
  "Alt",
  "AltGraph",
  "Control",
  "Meta",
  "Shift",
]);

function shortcut(
  code: string,
  key: string,
  modifiers: KeyboardShortcutModifiers = {},
): KeyboardShortcutBinding {
  return { code, key, modifiers };
}

export const KEYBOARD_SHORTCUT_DEFINITIONS: readonly KeyboardShortcutDefinition[] = [
  {
    id: "toggle-settings",
    label: "Settings",
    category: "Application",
    defaultBindings: [shortcut("Comma", ",", { cmdOrCtrl: true })],
  },
  {
    id: "add-workspace",
    label: "Open Workspace",
    category: "Application",
    defaultBindings: [
      shortcut("KeyO", "O", { cmdOrCtrl: true, shift: true }),
    ],
  },
  {
    id: "focus-file-search",
    label: "Find",
    category: "Navigation",
    defaultBindings: [shortcut("KeyK", "K", { cmdOrCtrl: true })],
  },
  {
    id: "sidebar-files",
    label: "Toggle Navigator",
    category: "Navigation",
    defaultBindings: [
      shortcut("KeyB", "B", { cmdOrCtrl: true }),
      shortcut("Backslash", "\\", { cmdOrCtrl: true }),
    ],
  },
  {
    id: "toggle-agent",
    label: "Toggle Agent",
    category: "Navigation",
    defaultBindings: [
      shortcut("KeyB", "B", { cmdOrCtrl: true, alt: true }),
    ],
  },
  {
    id: "new-tile",
    label: "New Tile",
    category: "Canvas",
    defaultBindings: [shortcut("KeyN", "N", { cmdOrCtrl: true })],
  },
  {
    id: "close-tile",
    label: "Close Tile",
    category: "Canvas",
    defaultBindings: [shortcut("KeyW", "W", { cmdOrCtrl: true })],
  },
  {
    id: "focus-tile-left",
    label: "Focus Tile Left",
    category: "Canvas",
    defaultBindings: [shortcut("ArrowLeft", "ArrowLeft", { alt: true })],
  },
  {
    id: "focus-tile-right",
    label: "Focus Tile Right",
    category: "Canvas",
    defaultBindings: [shortcut("ArrowRight", "ArrowRight", { alt: true })],
  },
  {
    id: "focus-tile-up",
    label: "Focus Tile Up",
    category: "Canvas",
    defaultBindings: [shortcut("ArrowUp", "ArrowUp", { alt: true })],
  },
  {
    id: "focus-tile-down",
    label: "Focus Tile Down",
    category: "Canvas",
    defaultBindings: [shortcut("ArrowDown", "ArrowDown", { alt: true })],
  },
  {
    id: "zoom-in",
    label: "Zoom In",
    category: "View",
    defaultBindings: [shortcut("Equal", "=", { cmdOrCtrl: true })],
  },
  {
    id: "zoom-out",
    label: "Zoom Out",
    category: "View",
    defaultBindings: [shortcut("Minus", "-", { cmdOrCtrl: true })],
  },
  {
    id: "zoom-reset",
    label: "Actual Size",
    category: "View",
    defaultBindings: [shortcut("Digit0", "0", { cmdOrCtrl: true })],
  },
  {
    id: "toggle-full-screen",
    label: "Toggle Full Screen",
    category: "View",
    defaultBindings: [shortcut("F11", "F11")],
    defaultBindingsByPlatform: {
      darwin: [
        shortcut("KeyF", "F", { control: true, meta: true }),
      ],
    },
  },
];

export const KEYBOARD_SHORTCUT_ACTION_IDS =
  KEYBOARD_SHORTCUT_DEFINITIONS.map((definition) => definition.id);

const KEYBOARD_SHORTCUT_DEFINITION_BY_ID = new Map(
  KEYBOARD_SHORTCUT_DEFINITIONS.map((definition) => [
    definition.id,
    definition,
  ]),
);

export function normalizeShortcutKey(
  key: string | null | undefined,
): string | null {
  if (!key) return null;
  return key.length === 1 ? key.toLowerCase() : key;
}

export function normalizeKeyboardShortcutPlatform(
  platform: string | undefined,
): KeyboardShortcutPlatform {
  if (platform === "darwin" || platform === "win32" || platform === "linux") {
    return platform;
  }
  return "other";
}

function primaryModifierForPlatform(
  platform: string | undefined,
): "control" | "meta" {
  return normalizeKeyboardShortcutPlatform(platform) === "darwin"
    ? "meta"
    : "control";
}

export function isKeyboardShortcutActionId(
  value: string,
): value is KeyboardShortcutActionId {
  return KEYBOARD_SHORTCUT_DEFINITION_BY_ID.has(
    value as KeyboardShortcutActionId,
  );
}

export function getKeyboardShortcutDefinition(
  actionId: KeyboardShortcutActionId,
): KeyboardShortcutDefinition {
  const definition = KEYBOARD_SHORTCUT_DEFINITION_BY_ID.get(actionId);
  if (!definition) {
    throw new Error(`Unknown keyboard shortcut action: ${actionId}`);
  }
  return definition;
}

function cloneBinding(
  binding: KeyboardShortcutBinding,
): KeyboardShortcutBinding {
  return {
    code: binding.code,
    key: binding.key,
    modifiers: { ...binding.modifiers },
  };
}

function cloneBindings(
  bindings: readonly KeyboardShortcutBinding[],
): KeyboardShortcutBinding[] {
  return bindings.map(cloneBinding);
}

export function getDefaultKeyboardShortcutBindings(
  actionId: KeyboardShortcutActionId,
  platform: string | undefined,
): KeyboardShortcutBinding[] {
  const normalizedPlatform = normalizeKeyboardShortcutPlatform(platform);
  const definition = getKeyboardShortcutDefinition(actionId);
  const platformDefault =
    definition.defaultBindingsByPlatform?.[normalizedPlatform];
  return cloneBindings(platformDefault ?? definition.defaultBindings);
}

export function getEffectiveKeyboardShortcutBindings(
  actionId: KeyboardShortcutActionId,
  overrides: KeyboardShortcutOverrides,
  platform: string | undefined,
): KeyboardShortcutBinding[] {
  if (Object.hasOwn(overrides, actionId)) {
    const override = overrides[actionId];
    return override === null ? [] : cloneBindings(override ?? []);
  }
  return getDefaultKeyboardShortcutBindings(actionId, platform);
}

export function getEffectiveKeyboardShortcutMap(
  overrides: KeyboardShortcutOverrides,
  platform: string | undefined,
): Record<KeyboardShortcutActionId, KeyboardShortcutBinding[]> {
  const entries = KEYBOARD_SHORTCUT_ACTION_IDS.map((actionId) => [
    actionId,
    getEffectiveKeyboardShortcutBindings(actionId, overrides, platform),
  ] as const);
  return Object.fromEntries(entries) as Record<
    KeyboardShortcutActionId,
    KeyboardShortcutBinding[]
  >;
}

function readBoolean(value: unknown): boolean | undefined {
  return value === true ? true : undefined;
}

export function normalizeKeyboardShortcutBinding(
  value: unknown,
): KeyboardShortcutBinding | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.code !== "string" || typeof record.key !== "string") {
    return null;
  }
  const rawModifiers = record.modifiers && typeof record.modifiers === "object"
    ? record.modifiers as Record<string, unknown>
    : {};
  const modifiers: KeyboardShortcutModifiers = {};
  const cmdOrCtrl = readBoolean(rawModifiers.cmdOrCtrl);
  const shift = readBoolean(rawModifiers.shift);
  const alt = readBoolean(rawModifiers.alt);
  const control = readBoolean(rawModifiers.control);
  const meta = readBoolean(rawModifiers.meta);
  if (cmdOrCtrl) modifiers.cmdOrCtrl = cmdOrCtrl;
  if (shift) modifiers.shift = shift;
  if (alt) modifiers.alt = alt;
  if (control) modifiers.control = control;
  if (meta) modifiers.meta = meta;
  return {
    code: record.code,
    key: record.key,
    modifiers,
  };
}

export function normalizeKeyboardShortcutOverrides(
  value: unknown,
): KeyboardShortcutOverrides {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const overrides: KeyboardShortcutOverrides = {};
  for (const actionId of KEYBOARD_SHORTCUT_ACTION_IDS) {
    if (!Object.hasOwn(record, actionId)) continue;
    const rawOverride = record[actionId];
    if (rawOverride === null) {
      overrides[actionId] = null;
      continue;
    }
    const rawBindings = Array.isArray(rawOverride)
      ? rawOverride
      : [rawOverride];
    const bindings = rawBindings
      .map(normalizeKeyboardShortcutBinding)
      .filter((binding): binding is KeyboardShortcutBinding => Boolean(binding));
    if (bindings.length > 0) overrides[actionId] = bindings;
  }
  return overrides;
}

export function withKeyboardShortcutOverride(
  overrides: KeyboardShortcutOverrides,
  actionId: KeyboardShortcutActionId,
  override: KeyboardShortcutOverride | undefined,
): KeyboardShortcutOverrides {
  const next: KeyboardShortcutOverrides = { ...overrides };
  if (override === undefined) {
    delete next[actionId];
  } else {
    next[actionId] = override === null ? null : cloneBindings(override);
  }
  return next;
}

function inputTypeIsKeyDown(input: KeyboardShortcutInputLike): boolean {
  return !input.type || input.type === "keyDown" || input.type === "keydown";
}

export function isKeyboardShortcutAutoRepeat(
  input: KeyboardShortcutInputLike,
): boolean {
  return input.isAutoRepeat === true || input.repeat === true;
}

function inputHasModifier(
  input: KeyboardShortcutInputLike,
  electronName: "alt" | "meta" | "control" | "shift",
  domName: "altKey" | "metaKey" | "ctrlKey" | "shiftKey",
): boolean {
  return input[electronName] === true || input[domName] === true;
}

function getInputModifierState(
  input: KeyboardShortcutInputLike,
): Required<KeyboardShortcutModifiers> {
  return {
    cmdOrCtrl: inputHasModifier(input, "meta", "metaKey") ||
      inputHasModifier(input, "control", "ctrlKey"),
    shift: inputHasModifier(input, "shift", "shiftKey"),
    alt: inputHasModifier(input, "alt", "altKey"),
    control: inputHasModifier(input, "control", "ctrlKey"),
    meta: inputHasModifier(input, "meta", "metaKey"),
  };
}

function bindingModifierState(
  binding: KeyboardShortcutBinding,
): Required<KeyboardShortcutModifiers> {
  return {
    cmdOrCtrl: binding.modifiers.cmdOrCtrl === true,
    shift: binding.modifiers.shift === true,
    alt: binding.modifiers.alt === true,
    control: binding.modifiers.control === true,
    meta: binding.modifiers.meta === true,
  };
}

function concreteBindingModifierState(
  binding: KeyboardShortcutBinding,
  platform: string | undefined,
): Required<KeyboardShortcutModifiers> {
  const state = bindingModifierState(binding);
  state.cmdOrCtrl = false;
  if (binding.modifiers.cmdOrCtrl === true) {
    state[primaryModifierForPlatform(platform)] = true;
  }
  return state;
}

function modifiersMatchInput(
  binding: KeyboardShortcutBinding,
  input: KeyboardShortcutInputLike,
  platform: string | undefined,
): boolean {
  const expected = concreteBindingModifierState(binding, platform);
  const actual = getInputModifierState(input);

  return expected.shift === actual.shift &&
    expected.alt === actual.alt &&
    expected.control === actual.control &&
    expected.meta === actual.meta;
}

function keyMatchesInput(
  binding: KeyboardShortcutBinding,
  input: KeyboardShortcutInputLike,
): boolean {
  if (input.code && binding.code === input.code) return true;
  return normalizeShortcutKey(binding.key) === normalizeShortcutKey(input.key);
}

export function keyboardShortcutBindingMatchesInput(
  binding: KeyboardShortcutBinding,
  input: KeyboardShortcutInputLike,
  platform?: string,
): boolean {
  return inputTypeIsKeyDown(input) &&
    keyMatchesInput(binding, input) &&
    modifiersMatchInput(binding, input, platform);
}

export function findKeyboardShortcutAction(
  input: KeyboardShortcutInputLike,
  overrides: KeyboardShortcutOverrides,
  platform: string | undefined,
): KeyboardShortcutActionId | null {
  for (const actionId of KEYBOARD_SHORTCUT_ACTION_IDS) {
    const bindings = getEffectiveKeyboardShortcutBindings(
      actionId,
      overrides,
      platform,
    );
    if (bindings.some((binding) =>
      keyboardShortcutBindingMatchesInput(binding, input, platform)
    )) {
      return actionId;
    }
  }
  return null;
}

export function keyboardShortcutBindingFromInput(
  input: KeyboardShortcutInputLike,
): KeyboardShortcutBinding | null {
  if (!input.code || !input.key || MODIFIER_KEYS.has(input.key)) {
    return null;
  }
  const modifiers: KeyboardShortcutModifiers = {};
  const state = getInputModifierState(input);
  if (state.shift) modifiers.shift = true;
  if (state.alt) modifiers.alt = true;
  if (state.control) modifiers.control = true;
  if (state.meta) modifiers.meta = true;
  return {
    code: input.code,
    key: input.key,
    modifiers,
  };
}

function hasAnyModifier(binding: KeyboardShortcutBinding): boolean {
  const modifiers = binding.modifiers;
  return modifiers.cmdOrCtrl === true ||
    modifiers.shift === true ||
    modifiers.alt === true ||
    modifiers.control === true ||
    modifiers.meta === true;
}

function isFunctionKey(binding: KeyboardShortcutBinding): boolean {
  return /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(binding.code) ||
    /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(binding.key);
}

export function validateKeyboardShortcutBinding(
  binding: KeyboardShortcutBinding,
): string | null {
  if (!binding.code || !binding.key) return "Press a shortcut.";
  if (MODIFIER_KEYS.has(binding.key)) return "Press a non-modifier key.";
  if (!hasAnyModifier(binding) && !isFunctionKey(binding)) {
    return "Use at least one modifier key.";
  }
  return null;
}

function concreteModifierStatesEqual(
  a: Required<KeyboardShortcutModifiers>,
  b: Required<KeyboardShortcutModifiers>,
): boolean {
  return a.shift === b.shift &&
    a.alt === b.alt &&
    a.control === b.control &&
    a.meta === b.meta;
}

export function keyboardShortcutBindingsEqual(
  a: KeyboardShortcutBinding,
  b: KeyboardShortcutBinding,
  platform?: string,
): boolean {
  const sameKey = a.code === b.code ||
    normalizeShortcutKey(a.key) === normalizeShortcutKey(b.key);
  return sameKey && concreteModifierStatesEqual(
    concreteBindingModifierState(a, platform),
    concreteBindingModifierState(b, platform),
  );
}

export function findKeyboardShortcutConflicts(
  binding: KeyboardShortcutBinding,
  actionId: KeyboardShortcutActionId,
  overrides: KeyboardShortcutOverrides,
  platform: string | undefined,
): KeyboardShortcutDefinition[] {
  return KEYBOARD_SHORTCUT_DEFINITIONS.filter((definition) => {
    if (definition.id === actionId) return false;
    const bindings = getEffectiveKeyboardShortcutBindings(
      definition.id,
      overrides,
      platform,
    );
    return bindings.some((candidate) =>
      keyboardShortcutBindingsEqual(candidate, binding, platform)
    );
  });
}

function displayKey(binding: KeyboardShortcutBinding): string {
  const code = binding.code;
  if (code === "ArrowLeft") return "←";
  if (code === "ArrowRight") return "→";
  if (code === "ArrowUp") return "↑";
  if (code === "ArrowDown") return "↓";
  if (code === "Comma") return ",";
  if (code === "Backslash") return "\\";
  if (code === "Backquote") return "`";
  if (code === "Equal") return "=";
  if (code === "Minus") return "-";
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  if (binding.key.length === 1) return binding.key.toUpperCase();
  return binding.key;
}

export function formatKeyboardShortcutBinding(
  binding: KeyboardShortcutBinding,
  platform: string | undefined,
): string {
  const normalizedPlatform = normalizeKeyboardShortcutPlatform(platform);
  const modifiers = binding.modifiers;
  const key = displayKey(binding);
  if (normalizedPlatform === "darwin") {
    const parts = [];
    if (modifiers.control) parts.push("⌃");
    if (modifiers.alt) parts.push("⌥");
    if (modifiers.shift) parts.push("⇧");
    if (modifiers.meta || modifiers.cmdOrCtrl) parts.push("⌘");
    return [...parts, key].join(" ");
  }
  const parts = [];
  if (modifiers.cmdOrCtrl || modifiers.control) parts.push("Ctrl");
  if (modifiers.alt) parts.push("Alt");
  if (modifiers.shift) parts.push("Shift");
  if (modifiers.meta) parts.push("Meta");
  return [...parts, key].join("+");
}

export function formatKeyboardShortcutBindings(
  bindings: readonly KeyboardShortcutBinding[],
  platform: string | undefined,
): string[] {
  return bindings.map((binding) =>
    formatKeyboardShortcutBinding(binding, platform)
  );
}

function keyToElectronAccelerator(binding: KeyboardShortcutBinding): string | null {
  const code = binding.code;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  const map: Record<string, string> = {
    ArrowLeft: "Left",
    ArrowRight: "Right",
    ArrowUp: "Up",
    ArrowDown: "Down",
    Backquote: "`",
    Backslash: "\\",
    BracketLeft: "[",
    BracketRight: "]",
    Comma: ",",
    Equal: "=",
    Minus: "-",
    Period: ".",
    Quote: "'",
    Semicolon: ";",
    Slash: "/",
    Space: "Space",
    Tab: "Tab",
    Enter: "Enter",
    Escape: "Esc",
  };
  if (map[code]) return map[code];
  return binding.key.length === 1 ? binding.key.toUpperCase() : null;
}

export function keyboardShortcutBindingToElectronAccelerator(
  binding: KeyboardShortcutBinding,
): string | null {
  const key = keyToElectronAccelerator(binding);
  if (!key) return null;
  const modifiers = binding.modifiers;
  const parts = [];
  if (modifiers.cmdOrCtrl) parts.push("CommandOrControl");
  if (modifiers.control) parts.push("Ctrl");
  if (modifiers.meta) parts.push("Command");
  if (modifiers.alt) parts.push("Alt");
  if (modifiers.shift) parts.push("Shift");
  return [...parts, key].join("+");
}
