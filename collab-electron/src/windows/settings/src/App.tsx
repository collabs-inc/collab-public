import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowsClockwise,
  GearSix,
  Info,
  Keyboard,
  Palette,
  Sun,
  Moon,
  Monitor,
  Terminal,
} from "@phosphor-icons/react";

type ThemeMode = "light" | "dark" | "system";

type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "error";

interface UpdateState {
  status: UpdateStatus;
  progress?: number;
  version?: string;
  releaseNotes?: string;
  error?: string;
}

interface SettingsApi {
  getPref: (key: string) => Promise<unknown>;
  setPref: (key: string, value: unknown) => Promise<void>;
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
  updateGetStatus: () => Promise<UpdateState>;
  updateCheck: () => Promise<UpdateState>;
  updateDownload: () => Promise<UpdateState>;
  updateInstall: () => void;
  onUpdateStatus: (cb: (state: UpdateState) => void) => () => void;
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

const IS_MAC = window.api.getPlatform() === "darwin";

const MOD = IS_MAC ? "\u2318" : "Ctrl+";
const SHIFT = IS_MAC ? "\u21E7" : "Shift+";
const CTRL = IS_MAC ? "\u2303" : "Ctrl+";

const SHORTCUTS: { label: string; keys: string }[] = [
  { label: "Settings", keys: `${MOD} ,` },
  { label: "Find", keys: `${MOD} K` },
  { label: "Toggle Navigator", keys: `${MOD} \\` },
  { label: "Toggle Terminal List", keys: `${MOD} \`` },
  { label: "Open Workspace", keys: `${SHIFT} ${MOD} O` },
  { label: "Zoom In", keys: `${MOD} =` },
  { label: "Zoom Out", keys: `${MOD} -` },
  { label: "Actual Size", keys: `${MOD} 0` },
  {
    label: "Toggle Full Screen",
    keys: IS_MAC ? "\u2303 \u2318 F" : "F11",
  },
];

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
      className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono"
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
      <ShortcutList items={SHORTCUTS} />

      <div className="space-y-1 pt-2">
        <h2 className="text-base font-semibold">Mouse Controls</h2>
      </div>
      <ShortcutList items={MOUSE_INPUTS} />
    </div>
  );
}

function AboutPane() {
  const [updateState, setUpdateState] = useState<UpdateState>({ status: "idle" });
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    api.getAppVersion()
      .then((v) => setAppVersion(v))
      .catch(() => {});
  }, []);

  useEffect(() => {
    api.updateGetStatus()
      .then((s) => setUpdateState(s))
      .catch(() => {});

    const unsub = api.onUpdateStatus((s) => {
      setUpdateState(s);
    });
    return unsub;
  }, []);

  function handleCheck() {
    void api.updateCheck();
  }

  function handleDownload() {
    void api.updateDownload();
  }

  function handleInstall() {
    api.close();
    setTimeout(() => {
      api.updateInstall();
    }, 300);
  }

  function renderReleaseNotes(notes: string | undefined) {
    if (!notes) return null;
    return (
      <div
        className="rounded-md p-3 text-xs leading-relaxed whitespace-pre-wrap"
        style={{
          backgroundColor:
            "color-mix(in srgb, var(--foreground) 4%, transparent)",
          maxHeight: "200px",
          overflowY: "auto",
        }}
      >
        {notes}
      </div>
    );
  }

  function renderStatusBlock() {
    switch (updateState.status) {
      case "idle":
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: "var(--accent, #22c55e)" }}
              />
              <p className="text-sm">You're up to date</p>
            </div>
            <button
              type="button"
              onClick={handleCheck}
              className="rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer"
              style={{
                border: "1px solid color-mix(in srgb, var(--foreground) 20%, transparent)",
                backgroundColor: "transparent",
                color: "var(--foreground)",
              }}
            >
              Check for Updates
            </button>
          </div>
        );

      case "checking":
        return (
          <div className="flex items-center gap-2">
            <ArrowsClockwise
              className="h-4 w-4 animate-spin"
              style={{ color: "var(--muted-foreground)" }}
            />
            <p className="text-sm text-muted-foreground">
              Checking for updates...
            </p>
          </div>
        );

      case "available":
        return (
          <div className="space-y-3">
            <p className="text-sm font-medium">
              Version {updateState.version} available
            </p>
            {renderReleaseNotes(updateState.releaseNotes)}
            <button
              type="button"
              onClick={handleDownload}
              className="rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer"
              style={{
                border: "1.5px solid var(--foreground)",
                backgroundColor: "var(--foreground)",
                color: "var(--background)",
              }}
            >
              Download
            </button>
          </div>
        );

      case "downloading":
        return (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Downloading... {Math.round(updateState.progress ?? 0)}%
            </p>
            <div
              className="h-1.5 w-full rounded-full overflow-hidden"
              style={{
                backgroundColor:
                  "color-mix(in srgb, var(--foreground) 10%, transparent)",
              }}
            >
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${Math.round(updateState.progress ?? 0)}%`,
                  backgroundColor: "var(--foreground)",
                  opacity: 0.6,
                }}
              />
            </div>
          </div>
        );

      case "ready":
        return (
          <div className="space-y-3">
            <p className="text-sm font-medium">
              Update downloaded — v{updateState.version}
            </p>
            {renderReleaseNotes(updateState.releaseNotes)}
            <button
              type="button"
              onClick={handleInstall}
              className="rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer"
              style={{
                border: "1.5px solid var(--foreground)",
                backgroundColor: "var(--foreground)",
                color: "var(--background)",
              }}
            >
              Restart &amp; Update
            </button>
          </div>
        );

      case "installing":
        return (
          <div className="flex items-center gap-2">
            <ArrowsClockwise
              className="h-4 w-4 animate-spin"
              style={{ color: "var(--muted-foreground)" }}
            />
            <p className="text-sm text-muted-foreground">
              Installing...
            </p>
          </div>
        );

      case "error":
        return (
          <div className="space-y-3">
            <p className="text-sm" style={{ color: "var(--destructive, #ef4444)" }}>
              Update check failed
            </p>
            {updateState.error && (
              <p className="text-xs text-muted-foreground">
                {updateState.error}
              </p>
            )}
            <button
              type="button"
              onClick={handleCheck}
              className="rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer"
              style={{
                border: "1px solid color-mix(in srgb, var(--foreground) 20%, transparent)",
                backgroundColor: "transparent",
                color: "var(--foreground)",
              }}
            >
              Retry
            </button>
          </div>
        );

      default:
        return null;
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">About &amp; Updates</h2>
        <p className="text-sm text-muted-foreground">
          Application version and update status.
        </p>
      </div>

      {appVersion && (
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Current version</p>
          <span className="text-xs tabular-nums text-muted-foreground font-mono">
            v{appVersion}
          </span>
        </div>
      )}

      <div
        className="rounded-lg p-4"
        style={{
          border: "1px solid color-mix(in srgb, var(--foreground) 10%, transparent)",
        }}
      >
        {renderStatusBlock()}
      </div>
    </div>
  );
}

type Pane = "appearance" | "terminal" | "controls" | "about";

const NAV_ITEMS: {
  id: Pane;
  label: string;
  icon: typeof Palette;
}[] = [
    { id: "appearance", label: "Appearance", icon: Palette },
    { id: "terminal", label: "Terminal", icon: Terminal },
    { id: "controls", label: "Controls", icon: Keyboard },
    { id: "about", label: "About & Updates", icon: Info },
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
        {activePane === "controls" && <ControlsPane />}
        {activePane === "about" && <AboutPane />}
      </div>
    </div>
  );
}
