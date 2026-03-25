/**
 * Session manager — Windows-compatible replacement for tmux.
 *
 * On macOS/Linux the original code used tmux for terminal session
 * persistence and multiplexing.  On Windows we manage sessions
 * directly through node-pty (backed by ConPTY) and persist metadata
 * to JSON files so the rest of the codebase can keep the same API
 * surface.
 *
 * Exports that were previously tmux-specific (getTmuxBin, tmuxExec, …)
 * are replaced by cross-platform equivalents that:
 *   - On Windows: use node-pty directly (no tmux binary needed)
 *   - On macOS/Linux: fall back to tmux if available
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync, execFile } from "node:child_process";
import { COLLAB_DIR } from "./paths";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SessionMeta {
  shell: string;
  cwd: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/*  Session metadata persistence                                       */
/* ------------------------------------------------------------------ */

export const SESSION_DIR = path.join(COLLAB_DIR, "terminal-sessions");

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

/* ------------------------------------------------------------------ */
/*  Platform detection                                                 */
/* ------------------------------------------------------------------ */

const IS_WIN = process.platform === "win32";

/* ------------------------------------------------------------------ */
/*  Shell resolution                                                   */
/* ------------------------------------------------------------------ */

/**
 * Returns the default shell for the current platform.
 */
export function getDefaultShell(): string {
  if (IS_WIN) {
    return process.env.COMSPEC || "C:\\Windows\\System32\\cmd.exe";
  }
  return process.env.SHELL || "/bin/zsh";
}

/**
 * Returns PowerShell path if available, falling back to cmd.exe.
 */
export function getPreferredWindowsShell(): string {
  // Prefer pwsh (PowerShell 7+) over the built-in Windows PowerShell 5
  const pwshPaths = [
    path.join(
      process.env.ProgramFiles || "C:\\Program Files",
      "PowerShell", "7", "pwsh.exe",
    ),
    path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32", "WindowsPowerShell", "v1.0", "powershell.exe",
    ),
  ];
  for (const p of pwshPaths) {
    if (fs.existsSync(p)) return p;
  }
  return process.env.COMSPEC || "C:\\Windows\\System32\\cmd.exe";
}

/* ------------------------------------------------------------------ */
/*  Session name helper                                                */
/* ------------------------------------------------------------------ */

export function tmuxSessionName(sessionId: string): string {
  return `collab-${sessionId}`;
}

/* ------------------------------------------------------------------ */
/*  tmux wrappers — only used on macOS/Linux                           */
/* ------------------------------------------------------------------ */

function getApp(): typeof import("electron").app | null {
  try {
    return require("electron").app;
  } catch {
    return null;
  }
}

export function getTmuxBin(): string {
  if (IS_WIN) return ""; // not applicable
  const app = getApp();
  if (app?.isPackaged) {
    return path.join(process.resourcesPath, "tmux");
  }
  return "tmux";
}

export function getTmuxConf(): string {
  if (IS_WIN) return "";
  const app = getApp();
  if (app?.isPackaged) {
    return path.join(process.resourcesPath, "tmux.conf");
  }
  const root = app?.getAppPath() ?? process.cwd();
  return path.join(root, "resources", "tmux.conf");
}

export function getTerminfoDir(): string | undefined {
  if (IS_WIN) return undefined;
  const app = getApp();
  if (app?.isPackaged) {
    return path.join(process.resourcesPath, "terminfo");
  }
  return undefined;
}

const SOCKET_NAME = "collab";

function baseArgs(): string[] {
  if (IS_WIN) return [];
  return ["-L", SOCKET_NAME, "-u", "-f", getTmuxConf()];
}

function tmuxEnv(): Record<string, string> | undefined {
  if (IS_WIN) return undefined;
  const dir = getTerminfoDir();
  if (!dir) return undefined;
  return { ...process.env, TERMINFO: dir } as Record<string, string>;
}

/**
 * Executes a tmux command synchronously.
 * On Windows this is a no-op that throws — callers should check
 * platform before calling.
 */
export function tmuxExec(...args: string[]): string {
  if (IS_WIN) {
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
  if (IS_WIN) {
    return Promise.reject(new Error("tmux is not available on Windows"));
  }
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
