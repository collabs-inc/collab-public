import { useCallback, useEffect, useRef, useState } from "react";
import {
  GearSix,
  Keyboard,
  Palette,
  PuzzlePiece,
  Sun,
  Moon,
  Monitor,
  Terminal,
} from "@phosphor-icons/react";
import {
  KEYBOARD_SHORTCUTS_PREF,
  KEYBOARD_SHORTCUT_DEFINITIONS,
  findKeyboardShortcutConflicts,
  formatKeyboardShortcutBinding,
  getDefaultKeyboardShortcutBindings,
  getEffectiveKeyboardShortcutBindings,
  keyboardShortcutBindingFromInput,
  keyboardShortcutBindingsEqual,
  normalizeKeyboardShortcutOverrides,
  validateKeyboardShortcutBinding,
  withKeyboardShortcutOverride,
  type KeyboardShortcutActionId,
  type KeyboardShortcutBinding,
  type KeyboardShortcutCategory,
  type KeyboardShortcutDefinition,
  type KeyboardShortcutOverride,
  type KeyboardShortcutOverrides,
} from "@collab/shared/keyboard-shortcuts";

type ThemeMode = "light" | "dark" | "system";

interface SettingsApi {
  getPref: (key: string) => Promise<unknown>;
  setPref: (key: string, value: unknown) => Promise<void>;
  setKeyboardShortcutRecording: (recording: boolean) => void;
  listTerminalTargets: () => Promise<Array<{
    id: string;
    label: string;
    isDefault?: boolean;
  }>>;
  setTheme: (mode: string) => Promise<void>;
  getAppVersion: () => Promise<string>;
  getAgents: () => Promise<AgentStatus[]>;
  installSkill: (agentId: string) => Promise<{ ok: boolean }>;
  uninstallSkill: (agentId: string) => Promise<{ ok: boolean }>;
  close: () => void;
}

const api = (window as unknown as { api: SettingsApi }).api;

const THEME_MODES: ThemeMode[] = ["light", "dark", "system"];

const THEME_ICONS: Record<ThemeMode, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

function Slider({
  value,
  min = 0,
  max = 100,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const pct = ((value - min) / (max - min)) * 100;

  const commit = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      onChange(Math.round(min + ratio * (max - min)));
    },
    [min, max, onChange],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      commit(e.clientX);
    },
    [commit],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      commit(e.clientX);
    },
    [commit],
  );

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <div
      ref={trackRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="relative h-5 w-full cursor-pointer select-none flex items-center"
    >
      <div
        className="absolute h-[3px] w-full rounded-full"
        style={{
          backgroundColor:
            "color-mix(in srgb, var(--foreground) 12%, transparent)",
        }}
      />
      <div
        className="absolute h-[3px] rounded-full"
        style={{
          width: `${pct}%`,
          backgroundColor: "var(--foreground)",
          opacity: 0.45,
        }}
      />
      <div
        className="absolute h-3.5 w-3.5 rounded-full border-2 shadow-sm"
        style={{
          left: `calc(${pct}% - 7px)`,
          backgroundColor: "var(--background)",
          borderColor: "var(--foreground)",
          opacity: 1,
        }}
      />
    </div>
  );
}

function ThemeToggle({
  value,
  onChange,
}: {
  value: ThemeMode;
  onChange: (mode: ThemeMode) => void;
}) {
  const idx = THEME_MODES.indexOf(value);

  return (
    <div
      className="relative inline-flex h-8 rounded-full p-0.5"
      style={{
        backgroundColor:
          "color-mix(in srgb, var(--foreground) 10%, transparent)",
      }}
    >
      {/* sliding pill */}
      <div
        className="absolute top-0.5 h-7 w-9 rounded-full transition-transform duration-150"
        style={{
          backgroundColor: "var(--accent)",
          transform: `translateX(${idx * 36}px)`,
        }}
      />
      {THEME_MODES.map((mode) => {
        const Icon = THEME_ICONS[mode];
        const active = mode === value;
        return (
          <button
            key={mode}
            type="button"
            aria-label={mode}
            onClick={() => onChange(mode)}
            className="relative z-10 flex h-7 w-9 items-center justify-center rounded-full cursor-pointer"
          >
            <Icon
              className="h-4 w-4 transition-colors duration-150"
              style={{
                color: active
                  ? "var(--foreground)"
                  : "var(--muted-foreground)",
              }}
              weight={active ? "fill" : "regular"}
            />
          </button>
        );
      })}
    </div>
  );
}

function AppearancePane() {
  const [theme, setTheme] = useState<ThemeMode>("system");
  const [canvasOpacity, setCanvasOpacity] = useState(0);

  useEffect(() => {
    api.getPref("theme")
      .then((v) => {
        if (v === "light" || v === "dark") setTheme(v);
        else setTheme("system");
      })
      .catch(() => { });
    api.getPref("canvasOpacity")
      .then((v) => {
        if (typeof v === "number") setCanvasOpacity(v);
      })
      .catch(() => { });
  }, []);

  async function handleThemeChange(mode: ThemeMode) {
    setTheme(mode);
    await api.setTheme(mode);
  }

  async function handleOpacityChange(value: number) {
    setCanvasOpacity(value);
    await api.setPref("canvasOpacity", value);
  }

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Appearance</h2>
        <p className="text-sm text-muted-foreground">
          Customize how Collaborator looks.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Theme</p>
        <ThemeToggle
          value={theme}
          onChange={(m) => { void handleThemeChange(m); }}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Canvas opacity</p>
          <span className="text-xs tabular-nums text-muted-foreground">
            {canvasOpacity}%
          </span>
        </div>
        <Slider
          value={canvasOpacity}
          onChange={(v) => { void handleOpacityChange(v); }}
        />
      </div>
    </div>
  );
}

const PLATFORM = window.api.getPlatform();
const IS_MAC = PLATFORM === "darwin";

const MOD = IS_MAC ? "\u2318" : "Ctrl+";
const SHIFT = IS_MAC ? "\u21E7" : "Shift+";
const CTRL = IS_MAC ? "\u2303" : "Ctrl+";

const MOUSE_INPUTS: { label: string; keys: string }[] = [
  { label: "Pan Canvas", keys: "Two-Finger Swipe" },
  { label: "Pan Canvas", keys: "Middle Click + Drag" },
  { label: "Pan Canvas", keys: "Space + Drag" },
  { label: "Scroll Canvas Vertically", keys: "Scroll" },
  { label: "Scroll Canvas Horizontally", keys: `${SHIFT} Scroll` },
  { label: "Zoom", keys: `${CTRL} Scroll` },
  ...(IS_MAC
    ? [{ label: "Zoom", keys: `${MOD} Scroll` }]
    : []),
];

function Kbd({ children }: { children: string }) {
  return (
    <kbd
      className="inline-flex min-h-6 items-center rounded px-1.5 py-0.5 text-xs font-mono"
      style={{
        backgroundColor:
          "color-mix(in srgb, var(--foreground) 8%, transparent)",
        color: "var(--foreground)",
      }}
    >
      {children}
    </kbd>
  );
}

function KbdGroup({ keys }: { keys: string[] }) {
  if (keys.length === 0) {
    return (
      <span className="text-xs font-medium text-muted-foreground">
        Disabled
      </span>
    );
  }
  return (
    <span className="flex flex-wrap justify-end gap-1.5">
      {keys.map((key) => <Kbd key={key}>{key}</Kbd>)}
    </span>
  );
}

function ShortcutList({ items }: { items: { label: string; keys: string }[] }) {
  return (
    <div className="space-y-0">
      {items.map(({ label, keys }, i) => (
        <div
          key={`${label}-${i}`}
          className="flex items-center justify-between py-2"
          style={{
            borderBottom:
              "1px solid color-mix(in srgb, var(--foreground) 6%, transparent)",
          }}
        >
          <span className="text-sm">{label}</span>
          <Kbd>{keys}</Kbd>
        </div>
      ))}
    </div>
  );
}

const KEYBOARD_SHORTCUT_CATEGORIES: KeyboardShortcutCategory[] = [
  "Application",
  "Navigation",
  "Canvas",
  "View",
];

function shortcutOverrideIsDefault(
  actionId: KeyboardShortcutActionId,
  overrides: KeyboardShortcutOverrides,
): boolean {
  return !Object.hasOwn(overrides, actionId);
}

function shortcutOverrideFromBinding(
  binding: KeyboardShortcutBinding,
): KeyboardShortcutBinding[] {
  return [binding];
}

function shortcutBindingsMatchDefault(
  actionId: KeyboardShortcutActionId,
  bindings: KeyboardShortcutBinding[],
): boolean {
  const defaults = getDefaultKeyboardShortcutBindings(actionId, PLATFORM);
  return bindings.length === defaults.length && bindings.every(
    (binding, index) => keyboardShortcutBindingsEqual(
      binding,
      defaults[index]!,
      PLATFORM,
    ),
  );
}

function ShortcutRow({
  definition,
  overrides,
  recording,
  draftBinding,
  error,
  onRecord,
  onClear,
  onReset,
}: {
  definition: KeyboardShortcutDefinition;
  overrides: KeyboardShortcutOverrides;
  recording: boolean;
  draftBinding: KeyboardShortcutBinding | null;
  error: string | null;
  onRecord: (actionId: KeyboardShortcutActionId) => void;
  onClear: (actionId: KeyboardShortcutActionId) => void;
  onReset: (actionId: KeyboardShortcutActionId) => void;
}) {
  const effectiveBindings = getEffectiveKeyboardShortcutBindings(
    definition.id,
    overrides,
    PLATFORM,
  );
  const displayBindings = recording && draftBinding
    ? [draftBinding]
    : effectiveBindings;
  const labels = displayBindings.map((binding) =>
    formatKeyboardShortcutBinding(binding, PLATFORM)
  );
  const isDefault = shortcutOverrideIsDefault(definition.id, overrides);
  const isDisabled = !isDefault && overrides[definition.id] === null;

  return (
    <div
      className="py-2.5"
      style={{
        borderBottom:
          "1px solid color-mix(in srgb, var(--foreground) 6%, transparent)",
      }}
    >
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 text-sm">{definition.label}</span>
        <button
          type="button"
          data-shortcut-action={definition.id}
          data-recording-shortcut={recording ? "true" : undefined}
          onClick={() => onRecord(definition.id)}
          className="flex min-h-8 min-w-40 items-center justify-end rounded-md px-2 text-right outline-none"
          style={{
            border: `1px solid ${recording
              ? "var(--foreground)"
              : "color-mix(in srgb, var(--foreground) 12%, transparent)"}`,
            backgroundColor: recording
              ? "color-mix(in srgb, var(--foreground) 6%, transparent)"
              : "transparent",
          }}
        >
          <KbdGroup keys={labels} />
        </button>
        <button
          type="button"
          onClick={() => onClear(definition.id)}
          disabled={isDisabled}
          className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => onReset(definition.id)}
          disabled={isDefault}
          className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          Reset
        </button>
      </div>
      {recording && error && (
        <p className="mt-1 text-xs" style={{ color: "#ef4444" }}>
          {error}
        </p>
      )}
    </div>
  );
}

function KeyboardShortcutEditor() {
  const [overrides, setOverrides] = useState<KeyboardShortcutOverrides>({});
  const [recordingAction, setRecordingAction] =
    useState<KeyboardShortcutActionId | null>(null);
  const [draftBinding, setDraftBinding] =
    useState<KeyboardShortcutBinding | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);

  useEffect(() => {
    api.getPref(KEYBOARD_SHORTCUTS_PREF)
      .then((value) => {
        setOverrides(normalizeKeyboardShortcutOverrides(value));
      })
      .catch(() => { });
  }, []);

  useEffect(() => {
    if (!recordingAction) return;
    const target = document.querySelector<HTMLElement>(
      `[data-shortcut-action="${recordingAction}"]`,
    );
    target?.focus();
  }, [recordingAction]);

  const saveOverrides = useCallback(async (next: KeyboardShortcutOverrides) => {
    setOverrides(next);
    await api.setPref(KEYBOARD_SHORTCUTS_PREF, next);
  }, []);

  const saveOverride = useCallback(async (
    actionId: KeyboardShortcutActionId,
    override: KeyboardShortcutOverride | undefined,
  ) => {
    await saveOverrides(withKeyboardShortcutOverride(
      overrides,
      actionId,
      override,
    ));
  }, [overrides, saveOverrides]);

  const startRecording = useCallback((actionId: KeyboardShortcutActionId) => {
    setRecordingAction(actionId);
    setDraftBinding(null);
    setRecordingError(null);
  }, []);

  const cancelRecording = useCallback(() => {
    setRecordingAction(null);
    setDraftBinding(null);
    setRecordingError(null);
  }, []);

  useEffect(() => {
    api.setKeyboardShortcutRecording(recordingAction !== null);
    return () => api.setKeyboardShortcutRecording(false);
  }, [recordingAction]);

  const clearShortcut = useCallback((actionId: KeyboardShortcutActionId) => {
    void saveOverride(actionId, null);
    if (recordingAction === actionId) cancelRecording();
  }, [cancelRecording, recordingAction, saveOverride]);

  const resetShortcut = useCallback((actionId: KeyboardShortcutActionId) => {
    void saveOverride(actionId, undefined);
    if (recordingAction === actionId) cancelRecording();
  }, [cancelRecording, recordingAction, saveOverride]);

  useEffect(() => {
    if (!recordingAction) return;
    const handler = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        cancelRecording();
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        clearShortcut(recordingAction);
        return;
      }

      const binding = keyboardShortcutBindingFromInput(event);
      if (!binding) return;
      setDraftBinding(binding);

      const validationError = validateKeyboardShortcutBinding(binding);
      if (validationError) {
        setRecordingError(validationError);
        return;
      }

      const conflicts = findKeyboardShortcutConflicts(
        binding,
        recordingAction,
        overrides,
        PLATFORM,
      );
      if (conflicts.length > 0) {
        setRecordingError(`Already used by ${conflicts[0]!.label}.`);
        return;
      }

      const nextOverride = shortcutOverrideFromBinding(binding);
      const next = shortcutBindingsMatchDefault(recordingAction, nextOverride)
        ? withKeyboardShortcutOverride(overrides, recordingAction, undefined)
        : withKeyboardShortcutOverride(overrides, recordingAction, nextOverride);
      void saveOverrides(next);
      cancelRecording();
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, {
      capture: true,
    });
  }, [
    cancelRecording,
    clearShortcut,
    overrides,
    recordingAction,
    saveOverrides,
  ]);

  return (
    <div className="space-y-5">
      {KEYBOARD_SHORTCUT_CATEGORIES.map((category) => {
        const definitions = KEYBOARD_SHORTCUT_DEFINITIONS.filter(
          (definition) => definition.category === category,
        );
        return (
          <div key={category} className="space-y-1">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">
              {category}
            </h3>
            <div className="space-y-0">
              {definitions.map((definition) => (
                <ShortcutRow
                  key={definition.id}
                  definition={definition}
                  overrides={overrides}
                  recording={recordingAction === definition.id}
                  draftBinding={recordingAction === definition.id
                    ? draftBinding
                    : null}
                  error={recordingAction === definition.id
                    ? recordingError
                    : null}
                  onRecord={startRecording}
                  onClear={clearShortcut}
                  onReset={resetShortcut}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type TerminalMode = "tmux" | "sidecar";

const TERMINAL_MODES: {
  value: TerminalMode;
  label: string;
  description: string;
  deprecated?: boolean;
}[] = [
  {
    value: "sidecar",
    label: "node-pty",
    description: "Clean scrollback rendering.",
  },
  {
    value: "tmux",
    label: "tmux",
    description: "May cause scrollback artifacts.",
    deprecated: true,
  },
];

type TerminalTarget = string;

type TerminalTargetOption = {
  id: string;
  label: string;
  isDefault?: boolean;
};

function RadioOption({
  selected,
  onClick,
  label,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left cursor-pointer"
      style={{
        border: `1px solid ${selected
          ? "var(--foreground)"
          : "color-mix(in srgb, var(--foreground) 15%, transparent)"}`,
        backgroundColor: selected
          ? "color-mix(in srgb, var(--foreground) 6%, transparent)"
          : "transparent",
      }}
    >
      <div
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
        style={{
          borderColor: selected
            ? "var(--foreground)"
            : "var(--muted-foreground)",
        }}
      >
        {selected && (
          <div
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: "var(--foreground)" }}
          />
        )}
      </div>
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}

function MacTerminalPane() {
  const [mode, setMode] = useState<TerminalMode>("sidecar");

  useEffect(() => {
    api.getPref("terminalMode")
      .then((v) => {
        if (v === "tmux" || v === "sidecar") setMode(v);
      })
      .catch(() => { });
  }, []);

  async function handleModeChange(value: TerminalMode) {
    setMode(value);
    await api.setPref("terminalMode", value);
  }

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Terminal</h2>
        <p className="text-sm text-muted-foreground">
          Changes take effect for new terminals.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Terminal backend</p>
        <div className="space-y-1.5">
          {TERMINAL_MODES.map(({ value, label, description, deprecated }) => (
            <RadioOption
              key={value}
              selected={mode === value}
              onClick={() => { void handleModeChange(value); }}
              label={label}
              description={
                deprecated
                  ? `${description} Deprecated — will be removed in a future release.`
                  : description
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function WindowsTerminalPane() {
  const [target, setTarget] = useState<TerminalTarget>("auto");
  const [options, setOptions] = useState<TerminalTargetOption[]>([]);

  useEffect(() => {
    api.getPref("terminalTarget")
      .then((v) => {
        if (typeof v === "string") setTarget(v);
      })
      .catch(() => { });
    api.listTerminalTargets()
      .then((items) => setOptions(items))
      .catch(() => { });
  }, []);

  async function handleTargetChange(value: TerminalTarget) {
    setTarget(value);
    await api.setPref("terminalTarget", value);
  }

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Terminal</h2>
        <p className="text-sm text-muted-foreground">
          Changes take effect for new terminals.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Terminal target</p>
        <div className="space-y-1.5">
          {options.map(({ id, label, isDefault }) => (
            <RadioOption
              key={id}
              selected={target === id}
              onClick={() => { void handleTargetChange(id); }}
              label={label}
              description={isDefault
                ? "Recommended default for this platform."
                : "Available for new terminals."}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function TerminalPane() {
  return IS_MAC ? <MacTerminalPane /> : <WindowsTerminalPane />;
}

function ControlsPane() {
  return (
    <div className="space-y-6 p-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Keyboard Shortcuts</h2>
      </div>
      <KeyboardShortcutEditor />

      <div className="space-y-1 pt-2">
        <h2 className="text-base font-semibold">Mouse Controls</h2>
      </div>
      <ShortcutList items={MOUSE_INPUTS} />
    </div>
  );
}

interface AgentStatus {
  id: string;
  name: string;
  detected: boolean;
  installed: boolean;
}

function IntegrationsPane() {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getAgents()
      .then((a) => setAgents(a))
      .catch(() => {});
  }, []);

  async function toggle(agent: AgentStatus) {
    setBusy((s) => new Set(s).add(agent.id));
    setError(null);
    try {
      const result = agent.installed
        ? await api.uninstallSkill(agent.id)
        : await api.installSkill(agent.id);
      if (result && !result.ok) {
        setError(`${agent.name}: ${(result as { error?: string }).error ?? "Unknown error"}`);
      }
    } catch (err) {
      setError(`${agent.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    const updated = await api.getAgents();
    setAgents(updated);
    setBusy((s) => {
      const next = new Set(s);
      next.delete(agent.id);
      return next;
    });
  }

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Integrations</h2>
        <p className="text-sm text-muted-foreground">
          Install the Canvas Skill so AI agents can control
          the canvas from the terminal.
        </p>
      </div>

      {error && (
        <p className="text-xs" style={{ color: "#ef4444" }}>{error}</p>
      )}

      <div className="space-y-1.5">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="flex items-center justify-between rounded-md px-3 py-2.5"
            style={{
              border:
                "1px solid color-mix(in srgb, var(--foreground) 15%, transparent)",
            }}
          >
            <div className="space-y-0.5">
              <p className="text-sm font-medium">{agent.name}</p>
              <p className="text-xs text-muted-foreground">
                {agent.detected ? "Detected" : "Not found"}
              </p>
            </div>
            <button
              type="button"
              disabled={busy.has(agent.id)}
              onClick={() => { void toggle(agent); }}
              className="rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer disabled:opacity-50"
              style={{
                backgroundColor: agent.installed
                  ? "color-mix(in srgb, var(--foreground) 8%, transparent)"
                  : "var(--foreground)",
                color: agent.installed
                  ? "var(--foreground)"
                  : "var(--background)",
              }}
            >
              {agent.installed ? "Uninstall" : "Install"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

type Pane = "appearance" | "terminal" | "integrations" | "controls";

const NAV_ITEMS: {
  id: Pane;
  label: string;
  icon: typeof Palette;
}[] = [
    { id: "appearance", label: "Appearance", icon: Palette },
    { id: "terminal", label: "Terminal", icon: Terminal },
    { id: "integrations", label: "Integrations", icon: PuzzlePiece },
    { id: "controls", label: "Controls", icon: Keyboard },
  ];

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <button
        type="button"
        onClick={onClick}
        aria-label="Close"
        className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-foreground/25 bg-transparent p-0 text-foreground/25 transition-opacity duration-150 hover:text-foreground/60 hover:border-foreground/60 cursor-pointer"
      >
        <svg
          aria-hidden="true"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M3 3L9 9M9 3L3 9"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <span className="text-[11px] tracking-[0.05em] text-foreground/25 select-none pointer-events-none font-mono">
        esc
      </span>
    </div>
  );
}

export default function App() {
  const [activePane, setActivePane] =
    useState<Pane>("appearance");
  const [appVersion, setAppVersion] = useState("");
  const paneRef =
    useRef<HTMLDivElement>(null);

  useEffect(() => {
    const focusInitialControl = () => {
      paneRef.current?.focus();
    };
    focusInitialControl();
    window.addEventListener("focus", focusInitialControl);
    return () =>
      window.removeEventListener("focus", focusInitialControl);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        api.close();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () =>
      window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    api.getAppVersion()
      .then((v) => setAppVersion(v))
      .catch(() => { });
  }, []);

  return (
    <div
      ref={paneRef}
      tabIndex={-1}
      className="flex h-full w-full bg-background text-foreground focus:outline-none"
    >
      {/* Sidebar */}
      <div className="flex w-48 flex-col border-r border-border/50 bg-background p-3 pt-4">
        <div className="flex items-start gap-2 px-2">
          <CloseButton onClick={() => api.close()} />
        </div>

        <div className="px-2 mt-4">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <GearSix className="h-5 w-5" />
            Settings
          </h1>
        </div>

        <nav className="mt-3 space-y-0.5">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActivePane(id)}
              className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium ${activePane === id
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground"
                }`}
            >
              <Icon className="h-4 w-4" />
              <span className="flex-1 text-left">
                {label}
              </span>
            </button>
          ))}
        </nav>

        <div className="flex-1" />

        {appVersion && (
          <div className="px-2">
            <span className="text-[11px] font-mono text-muted-foreground">
              v{appVersion}
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activePane === "appearance" && <AppearancePane />}
        {activePane === "terminal" && <TerminalPane />}
        {activePane === "integrations" && <IntegrationsPane />}
        {activePane === "controls" && <ControlsPane />}
      </div>
    </div>
  );
}
