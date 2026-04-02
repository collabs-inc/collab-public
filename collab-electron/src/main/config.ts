import { readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { COLLAB_DIR } from "./paths";
import { atomicWriteFileSync } from "./files";

export interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized?: boolean;
}

export interface AppConfig {
  workspaces: string[];
  active_workspace: number;
  window_state: WindowState | null;
  ui: Record<string, unknown>;
}

export type TerminalTarget =
  | "auto"
  | "powershell"
  | "shell"
  | `wsl:${string}`;

const DEFAULT_CONFIG: AppConfig = {
  workspaces: [],
  active_workspace: -1,
  window_state: null,
  ui: {},
};

function configPath(): string {
  return join(COLLAB_DIR, "config.json");
}

export function loadConfig(): AppConfig {
  try {
    const raw = readFileSync(configPath(), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const ui =
      parsed.ui && typeof parsed.ui === "object"
        ? { ...(parsed.ui as Record<string, unknown>) }
        : {};

    if (!isTerminalTarget(ui.terminalTarget)) {
      ui.terminalTarget = "auto";
    }

    let workspaces: string[];
    let activeWorkspace: number;

    if (Array.isArray(parsed.workspaces)) {
      workspaces = (parsed.workspaces as unknown[]).filter(
        (p): p is string => typeof p === "string",
      );
      const rawIndex =
        typeof parsed.active_workspace === "number"
          ? parsed.active_workspace
          : -1;
      activeWorkspace = workspaces.length > 0
        ? Math.max(0, Math.min(rawIndex, workspaces.length - 1))
        : -1;
    } else if (
      typeof parsed.workspace_path === "string" &&
      parsed.workspace_path !== ""
    ) {
      workspaces = [parsed.workspace_path];
      activeWorkspace = 0;
    } else {
      workspaces = [];
      activeWorkspace = -1;
    }

    return {
      workspaces,
      active_workspace: activeWorkspace,
      window_state: (parsed.window_state as WindowState) ?? null,
      ui,
    };
  } catch {
    return {
      ...DEFAULT_CONFIG,
      ui: { terminalTarget: "auto" },
    };
  }
}

export function saveConfig(config: AppConfig): void {
  const filePath = configPath();
  mkdirSync(dirname(filePath), { recursive: true });
  atomicWriteFileSync(filePath, JSON.stringify(config, null, 2));
}

export function getPref(
  config: AppConfig,
  key: string,
): unknown {
  return config.ui[key] ?? null;
}

/** Known preference keys that may be written via IPC. */
const ALLOWED_PREF_KEYS = new Set([
  "theme",
  "canvasOpacity",
  "terminalMode",
  "terminalTarget",
  "terminalBackend",
  "inProcessTerminals",
  "gpuRenderer",
  "uncapFrameRate",
  "collab:nav-view-mode",
  "collab:nav-sort-mode",
  "collab:nav-tree-sort-mode",
  "collab:nav-feed-sort-mode",
]);

/** Key prefixes for dynamically-named prefs (e.g. panel-width-nav). */
const ALLOWED_PREF_PREFIXES = [
  "panel-width-",
  "panel-visible-",
];

function isAllowedPrefKey(key: string): boolean {
  if (key.length > 64) return false; // prevent unbounded key growth
  if (ALLOWED_PREF_KEYS.has(key)) return true;
  return ALLOWED_PREF_PREFIXES.some((p) => key.startsWith(p));
}

export function setPref(
  config: AppConfig,
  key: string,
  value: unknown,
): void {
  if (!isAllowedPrefKey(key)) {
    console.warn(`[config] setPref rejected unknown key: ${key}`);
    return;
  }
  if (key === "__proto__" || key === "constructor" || key === "prototype") return;
  config.ui[key] = value;
  saveConfig(config);
}

export type TerminalMode = "tmux" | "sidecar";
export type TerminalBackend = "direct" | "sidecar";

export function getTerminalMode(): TerminalMode {
  if (process.platform !== "darwin") return "sidecar";
  const config = loadConfig();
  const mode = getPref(config, "terminalMode");
  if (mode === "sidecar" || mode === "tmux") return mode;
  return "sidecar";
}

export function getTerminalBackend(): TerminalBackend {
  if (process.platform === "win32") return "direct";
  const config = loadConfig();
  const backend = getPref(config, "terminalBackend");
  if (backend === "direct" || backend === "sidecar") return backend;
  return "sidecar";
}

export function isTerminalTarget(value: unknown): value is TerminalTarget {
  return value === "auto"
    || value === "powershell"
    || value === "shell"
    || (typeof value === "string" && value.startsWith("wsl:"));
}

export function getTerminalTarget(): TerminalTarget {
  const config = loadConfig();
  const target = getPref(config, "terminalTarget");
  return isTerminalTarget(target) ? target : "auto";
}

function getBoolPref(key: string, defaultValue: boolean): boolean {
  const config = loadConfig();
  const pref = getPref(config, key);
  if (pref === true || pref === false) return pref;
  return defaultValue;
}

export const getInProcessTerminals = () =>
  getBoolPref("inProcessTerminals", process.platform === "win32");
export const getGpuRenderer = () => getBoolPref("gpuRenderer", true);
export const getUncapFrameRate = () => getBoolPref("uncapFrameRate", false);
