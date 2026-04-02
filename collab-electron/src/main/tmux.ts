import { execFileSync, execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { type TerminalTarget } from "./config";
import { COLLAB_DIR } from "./paths";

export interface SessionMeta {
  shell: string;
  cwd: string;
  createdAt: string;
  target?: string;
  displayName?: string;
  command?: string;
  args?: string[];
  cwdHostPath?: string;
  cwdGuestPath?: string;
  backend?: "tmux" | "sidecar" | "direct";
}

export const SESSION_DIR = path.join(
  COLLAB_DIR, "terminal-sessions",
);
function getSocketName(): string {
  const app = getApp();
  if (app && !app.isPackaged) return "collab-dev";
  return "collab";
}

export { getSocketName };

// Electron app module — unavailable in unit tests.
// Lazy-loaded to avoid crashing bun test.
function getApp(): typeof import("electron").app | null {
  try {
    return require("electron").app;
  } catch {
    return null;
  }
}

function packagedResourcePath(...segments: string[]): string | null {
  const app = getApp();
  if (!app?.isPackaged) return null;
  const candidate = path.join(process.resourcesPath, ...segments);
  return fs.existsSync(candidate) ? candidate : null;
}

export function getTmuxBin(): string {
  return packagedResourcePath("tmux") ?? "tmux";
}


export function getTmuxConf(): string {
  const packaged = packagedResourcePath("tmux.conf");
  if (packaged) {
    return packaged;
  }
  // Dev mode: resolve from project root.
  // app.getAppPath() returns project root in electron-vite;
  // fall back to the source/output tree so tests don't depend on cwd.
  const app = getApp();
  const root = app?.getAppPath() ?? path.resolve(__dirname, "..", "..");
  return path.join(root, "resources", "tmux.conf");
}

export function getTerminfoDir(): string | undefined {
  const packaged = packagedResourcePath("terminfo");
  if (packaged) {
    return packaged;
  }
  return undefined;
}

function wslDistro(target: TerminalTarget | undefined): string | null {
  if (process.platform !== "win32") return null;
  if (!target?.startsWith("wsl:")) return null;
  return target.slice(4);
}

function baseArgs(target?: TerminalTarget): string[] {
  const args = ["-L", getSocketName(), "-u"];
  const conf = wslDistro(target) ? null : getTmuxConf();
  if (conf) {
    args.push("-f", conf);
  }
  return args;
}

function tmuxEnv(target?: TerminalTarget): Record<string, string> | undefined {
  if (wslDistro(target)) return undefined;
  const dir = getTerminfoDir();
  if (!dir) return undefined;
  return { ...process.env, TERMINFO: dir } as Record<string, string>;
}

export interface TmuxSpawnSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export function getTmuxSpawnSpec(
  target?: TerminalTarget,
  ...args: string[]
): TmuxSpawnSpec {
  const distro = wslDistro(target);
  if (distro) {
    return {
      command: "wsl.exe",
      args: ["-d", distro, "-e", "tmux", ...baseArgs(target), ...args],
    };
  }
  return {
    command: getTmuxBin(),
    args: [...baseArgs(), ...args],
    env: tmuxEnv(),
  };
}

/** WSL cold-starts can take 10-15s; 5s is too tight. */
const TMUX_EXEC_TIMEOUT_MS = 30_000;

export function tmuxExecForTarget(
  target: TerminalTarget | undefined,
  ...args: string[]
): string {
  const spec = getTmuxSpawnSpec(target, ...args);
  try {
    return execFileSync(
      spec.command,
      spec.args,
      {
        encoding: "utf8",
        timeout: TMUX_EXEC_TIMEOUT_MS,
        env: spec.env,
        windowsHide: process.platform === "win32",
      },
    ).trim();
  } catch (err: unknown) {
    if (isEnoent(err)) {
      const app = getApp();
      const distro = wslDistro(target);
      const hint = distro
        ? `tmux is required inside WSL distro ${distro}. Install it there and ensure it is on PATH.`
        : app?.isPackaged
          ? "tmux is required for legacy session recovery in packaged builds. Install it and ensure it is on your PATH."
          : "tmux is required for dev mode. Install it with: brew install tmux";
      throw new Error(hint);
    }
    throw err;
  }
}

export function tmuxExec(...args: string[]): string {
  return tmuxExecForTarget(undefined, ...args);
}

function isEnoent(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as NodeJS.ErrnoException).code === "ENOENT"
  );
}

export function tmuxExecAsync(
  target: TerminalTarget | undefined,
  ...args: string[]
): Promise<string> {
  const spec = getTmuxSpawnSpec(target, ...args);
  return new Promise((resolve, reject) => {
    execFile(
      spec.command,
      spec.args,
      {
        encoding: "utf8",
        timeout: TMUX_EXEC_TIMEOUT_MS,
        env: spec.env,
        windowsHide: process.platform === "win32",
      },
      (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout.trim());
      },
    );
  });
}

export function tmuxSessionName(sessionId: string): string {
  return `collab-${sessionId}`;
}

function ensureSessionDir(): void {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

const SESSION_ID_RE = /^[0-9a-f]{16}$/;
function assertSessionId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !SESSION_ID_RE.test(id))
    throw new Error("Invalid session ID");
}

function metaPath(sessionId: string): string {
  assertSessionId(sessionId);
  return path.join(SESSION_DIR, `${sessionId}.json`);
}

export function writeSessionMeta(
  sessionId: string,
  meta: SessionMeta,
): void {
  ensureSessionDir();
  fs.writeFileSync(metaPath(sessionId), JSON.stringify(meta));
}

export function readSessionMeta(
  sessionId: string,
): SessionMeta | null {
  try {
    const raw = fs.readFileSync(metaPath(sessionId), "utf8");
    return JSON.parse(raw) as SessionMeta;
  } catch {
    return null;
  }
}

export function deleteSessionMeta(sessionId: string): void {
  try {
    fs.unlinkSync(metaPath(sessionId));
  } catch {
    // no-op if file doesn't exist
  }
}
