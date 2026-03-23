import { useCallback, useEffect, useRef, useState } from "react";
import {
  CaretDown,
  GearSix,
  Palette,
  Sun,
  Moon,
  Monitor,
} from "@phosphor-icons/react";

type ThemeMode = "light" | "dark" | "system";

interface SettingsApi {
  getPref: (key: string) => Promise<unknown>;
  setPref: (key: string, value: unknown) => Promise<void>;
  setTheme: (mode: string) => Promise<void>;
  getAppVersion: () => Promise<string>;
  getAgents: () => Promise<AgentStatus[]>;
  installSkill: (agentId: string) => Promise<{ ok: boolean }>;
  uninstallSkill: (agentId: string) => Promise<{ ok: boolean }>;
  listMonoFonts: () => Promise<string[]>;
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
          opacity: 0.8,
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
  const [terminalFontFamily, setTerminalFontFamily] = useState("");
  const [terminalFontSize, setTerminalFontSize] = useState(12);
  const [monoFonts, setMonoFonts] = useState<string[]>([]);

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
    api.getPref("terminalFontFamily")
      .then((v) => {
        if (typeof v === "string") setTerminalFontFamily(v);
      })
      .catch(() => { });
    api.getPref("terminalFontSize")
      .then((v) => {
        if (typeof v === "number") setTerminalFontSize(v);
      })
      .catch(() => { });
    api.listMonoFonts()
      .then((fonts) => {
        if (Array.isArray(fonts)) setMonoFonts(fonts);
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

  async function handleFontFamilyChange(value: string) {
    setTerminalFontFamily(value);
    await api.setPref("terminalFontFamily", value);
  }

  async function handleFontSizeChange(value: number) {
    setTerminalFontSize(value);
    await api.setPref("terminalFontSize", value);
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

      <div className="space-y-2">
        <p className="text-sm font-medium">Terminal font</p>
        <div className="relative">
        <select
          value={terminalFontFamily}
          onChange={(e) => { void handleFontFamilyChange(e.target.value); }}
          aria-label="Terminal font"
          className="w-full appearance-none rounded-md border border-border/50 bg-transparent px-2.5 py-1.5 pr-8 text-sm text-foreground focus:outline-none focus:border-foreground/25 cursor-pointer"
        >
          <option value="">Default (Menlo)</option>
          {monoFonts.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
        </select>
        <CaretDown
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
          weight="bold"
        />
        </div>
        <p className="text-xs text-muted-foreground">
          Changes apply to new terminals.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Terminal font size</p>
          <span className="text-xs tabular-nums text-muted-foreground">
            {terminalFontSize}px
          </span>
        </div>
        <Slider
          value={terminalFontSize}
          min={6}
          max={32}
          onChange={(v) => { void handleFontSizeChange(v); }}
        />
      </div>
    </div>
  );
}

type Pane = "appearance";

const NAV_ITEMS: {
  id: Pane;
  label: string;
  icon: typeof Palette;
}[] = [
    { id: "appearance", label: "Appearance", icon: Palette },
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
      </div>
    </div>
  );
}
