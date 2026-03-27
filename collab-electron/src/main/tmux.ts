import { execFileSync, execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { COLLAB_DIR } from "./paths";
import type { SessionMeta } from "./terminal-backend";

// Re-export SessionMeta for backward compatibility
export type { SessionMeta };

export const SESSION_DIR = path.join(
  COLLAB_DIR, "terminal-sessions",
);
const SOCKET_NAME = "collab";

// Electron app module — unavailable in unit tests.
// Lazy-loaded to avoid crashing bun test.
function getApp(): typeof import("electron").app | null {
  try {
    return require("electron").app;
  } catch {
    return null;
  }
}

export function getTmuxBin(): string {
  // tmux is only available on macOS/Linux
  if (process.platform === "win32") {
    throw new Error("tmux is not available on Windows");
  }
  const app = getApp();
  if (app?.isPackaged) {
    return path.join(process.resourcesPath, "tmux");
  }
  return "tmux";
}


export function getTmuxConf(): string {
  // tmux.conf is only needed on macOS/Linux
  if (process.platform === "win32") {
    throw new Error("tmux configuration is not needed on Windows");
  }
  const app = getApp();
  if (app?.isPackaged) {
    return path.join(process.resourcesPath, "tmux.conf");
  }
  // Dev mode: resolve from project root.
  // app.getAppPath() returns project root in electron-vite;
  // fall back to cwd for unit tests.
  const root = app?.getAppPath() ?? process.cwd();
  return path.join(root, "resources", "tmux.conf");
}

export function getTerminfoDir(): string | undefined {
  // terminfo is only needed for tmux on macOS/Linux
  // Windows does not use tmux and does not need terminfo
  if (process.platform === "win32") {
    return undefined;
  }
  const app = getApp();
  if (app?.isPackaged) {
    return path.join(process.resourcesPath, "terminfo");
  }
  return undefined;
}

function baseArgs(): string[] {
  return ["-L", SOCKET_NAME, "-u", "-f", getTmuxConf()];
}

function tmuxEnv(): Record<string, string> | undefined {
  const dir = getTerminfoDir();
  if (!dir) return undefined;

  const env: Record<string, string> = {};
  // Filter out undefined values and build a clean string-only record
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  env.TERMINFO = dir;
  return env;
}

export function tmuxExec(...args: string[]): string {
  if (process.platform === "win32") {
    throw new Error("tmux is not available on Windows");
  }
  return execFileSync(
    getTmuxBin(), [...baseArgs(), ...args],
    { encoding: "utf8", timeout: 5000, env: tmuxEnv() },
  ).trim();
}

export function tmuxExecAsync(
  ...args: string[]
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      getTmuxBin(), [...baseArgs(), ...args],
      { encoding: "utf8", timeout: 5000, env: tmuxEnv() },
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

function metaPath(sessionId: string): string {
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
