/**
 * Tmux-based Terminal Backend
 *
 * macOS/Linux implementation using tmux for session management.
 * Provides persistent sessions that survive app restarts.
 */

import * as pty from "node-pty";
import * as os from "os";
import * as fs from "node:fs";
import * as crypto from "crypto";
import { type IDisposable } from "node-pty";
import {
  getTmuxBin,
  getTerminfoDir,
  tmuxExec,
  tmuxSessionName,
  writeSessionMeta,
  readSessionMeta,
  deleteSessionMeta,
  SESSION_DIR,
  type SessionMeta,
} from "./tmux";
import type {
  TerminalBackend,
  DiscoveredSession,
  ReconnectResult,
} from "./terminal-backend";

interface PtySession {
  pty: pty.IPty;
  shell: string;
  disposables: IDisposable[];
}

const sessions = new Map<string, PtySession>();
let shuttingDown = false;

const KILL_ALL_TIMEOUT_MS = 2000;

/**
 * Logging utility for tmux terminal backend
 */
function log(level: "info" | "warn" | "error", message: string, data?: unknown): void {
  const prefix = `[TmuxTerminalBackend:${level}]`;
  if (data !== undefined) {
    console.log(prefix, message, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

function getWebContents(): typeof import("electron").webContents | null {
  try {
    return require("electron").webContents;
  } catch {
    return null;
  }
}

function sendToSender(
  senderWebContentsId: number | undefined,
  channel: string,
  payload: unknown,
): void {
  if (senderWebContentsId == null) return;
  const wc = getWebContents();
  if (!wc) return;
  const sender = wc.fromId(senderWebContentsId);
  if (sender && !sender.isDestroyed()) {
    sender.send(channel, payload);
  }
}

function utf8Env(): Record<string, string> {
  const env: Record<string, string> = {};
  // Filter out undefined values and build a clean string-only record
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  if (!env.LANG || !env.LANG.includes("UTF-8")) {
    env.LANG = "en_US.UTF-8";
  }
  const terminfoDir = getTerminfoDir();
  if (terminfoDir) {
    env.TERMINFO = terminfoDir;
  }
  return env;
}

function attachClient(
  sessionId: string,
  cols: number,
  rows: number,
  senderWebContentsId?: number,
): pty.IPty {
  const tmuxBin = getTmuxBin();
  const name = tmuxSessionName(sessionId);

  const ptyProcess = pty.spawn(
    tmuxBin,
    ["-L", "collab", "-u", "attach-session", "-t", name],
    { name: "xterm-256color", cols, rows, env: utf8Env() },
  );

  const disposables: IDisposable[] = [];

  disposables.push(
    ptyProcess.onData((data: string) => {
      sendToSender(
        senderWebContentsId,
        "pty:data",
        { sessionId, data },
      );
    }),
  );

  disposables.push(
    ptyProcess.onExit(() => {
      if (shuttingDown) {
        sessions.delete(sessionId);
        return;
      }
      try {
        tmuxExec("has-session", "-t", name);
      } catch {
        deleteSessionMeta(sessionId);
        sendToSender(
          senderWebContentsId,
          "pty:exit",
          { sessionId, exitCode: 0 },
        );
      }
      sessions.delete(sessionId);
    }),
  );

  sessions.set(sessionId, {
    pty: ptyProcess,
    shell: "",
    disposables,
  });

  return ptyProcess;
}

function stripTrailingBlanks(text: string): string {
  const lines = text.split("\n");
  let end = lines.length;
  while (end > 0 && lines[end - 1]!.trim() === "") {
    end--;
  }
  return lines.slice(0, end).join("\n");
}

/**
 * Tmux-based Terminal Backend implementation
 */
export class TmuxTerminalBackend implements TerminalBackend {
  createSession(
    cwd?: string,
    senderWebContentsId?: number,
    cols?: number,
    rows?: number,
  ): { sessionId: string; shell: string } {
    const sessionId = crypto.randomBytes(8).toString("hex");

    // Check for session ID collision (extremely rare but possible)
    if (sessions.has(sessionId)) {
      log("warn", "Session ID collision detected, regenerating", { sessionId });
      return this.createSession(cwd, senderWebContentsId, cols, rows);
    }

    const shell = process.env.SHELL || "/bin/zsh";
    const name = tmuxSessionName(sessionId);
    const resolvedCwd = cwd || os.homedir();
    const c = cols || 80;
    const r = rows || 24;

    try {
      tmuxExec(
        "new-session", "-d",
        "-s", name,
        "-c", resolvedCwd,
        "-x", String(c),
        "-y", String(r),
      );
      log("info", "Created tmux session", { sessionId, name, shell, cwd: resolvedCwd });
    } catch (error) {
      log("error", "Failed to create tmux session", { sessionId, name, error });
      throw new Error(`Failed to create tmux session: ${error instanceof Error ? error.message : String(error)}`);
    }

    tmuxExec(
      "set-environment", "-t", name,
      "COLLAB_PTY_SESSION_ID", sessionId,
    );
    tmuxExec(
      "set-environment", "-t", name,
      "SHELL", shell,
    );

    try {
      writeSessionMeta(sessionId, {
        shell,
        cwd: resolvedCwd,
        createdAt: new Date().toISOString(),
      });
      log("info", "Created session metadata", { sessionId });
    } catch (error) {
      log("error", "Failed to write session metadata", { sessionId, error });
      // Clean up tmux session if metadata write fails
      try {
        tmuxExec("kill-session", "-t", name);
      } catch {
        // Best effort cleanup
      }
      throw new Error(`Failed to persist session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    }

    attachClient(sessionId, c, r, senderWebContentsId);

    const session = sessions.get(sessionId)!;
    session.shell = shell;

    return { sessionId, shell };
  }

  reconnectSession(
    sessionId: string,
    cols: number,
    rows: number,
    senderWebContentsId: number,
  ): ReconnectResult {
    const name = tmuxSessionName(sessionId);

    try {
      tmuxExec("has-session", "-t", name);
    } catch {
      deleteSessionMeta(sessionId);
      throw new Error(`tmux session ${name} not found`);
    }

    let scrollback = "";
    try {
      const raw = tmuxExec(
        "capture-pane", "-t", name,
        "-p", "-e", "-S", "-200000",
      );
      scrollback = stripTrailingBlanks(raw);
    } catch {
      // Proceed without scrollback
    }

    attachClient(sessionId, cols, rows, senderWebContentsId);

    try {
      tmuxExec(
        "resize-window", "-t", name,
        "-x", String(cols), "-y", String(rows),
      );
    } catch {
      // Non-fatal
    }

    const meta = readSessionMeta(sessionId);
    const session = sessions.get(sessionId)!;
    session.shell =
      meta?.shell || process.env.SHELL || "/bin/zsh";

    return { sessionId, shell: session.shell, meta, scrollback };
  }

  writeToSession(sessionId: string, data: string): void {
    const session = sessions.get(sessionId);
    if (!session) return;
    session.pty.write(data);
  }

  sendRawKeys(sessionId: string, data: string): void {
    const name = tmuxSessionName(sessionId);
    tmuxExec("send-keys", "-l", "-t", name, data);
  }

  resizeSession(sessionId: string, cols: number, rows: number): void {
    const session = sessions.get(sessionId);
    if (!session) return;
    session.pty.resize(cols, rows);

    const name = tmuxSessionName(sessionId);
    try {
      tmuxExec(
        "resize-window", "-t", name,
        "-x", String(cols), "-y", String(rows),
      );
    } catch {
      // Non-fatal
    }
  }

  killSession(sessionId: string): void {
    const session = sessions.get(sessionId);
    if (session) {
      for (const d of session.disposables) d.dispose();
      session.pty.kill();
      sessions.delete(sessionId);
    }

    const name = tmuxSessionName(sessionId);
    try {
      tmuxExec("kill-session", "-t", name);
    } catch {
      // Session may already be dead
    }

    deleteSessionMeta(sessionId);
  }

  listSessions(): string[] {
    return [...sessions.keys()];
  }

  killAll(): void {
    shuttingDown = true;
    for (const [id, session] of sessions) {
      for (const d of session.disposables) d.dispose();
      session.pty.kill();
      sessions.delete(id);
    }
  }

  async killAllAndWait(): Promise<void> {
    shuttingDown = true;
    if (sessions.size === 0) return Promise.resolve();

    log("info", "Killing all sessions and waiting", { count: sessions.size });

    const pending: Promise<void>[] = [];
    for (const [id, session] of sessions) {
      // Fix race condition: register onExit handler BEFORE killing
      const exitPromise = new Promise<void>((resolve) => {
        let resolved = false;
        const onExitHandler = () => {
          if (!resolved) {
            resolved = true;
            resolve();
          }
        };
        // Register handler immediately
        session.pty.onExit(onExitHandler);
        // Also set a timeout fallback in case onExit doesn't fire
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve();
          }
        }, KILL_ALL_TIMEOUT_MS / 2);
      });
      pending.push(exitPromise);

      for (const d of session.disposables) {
        try {
          d.dispose();
        } catch {
          // Dispose error - continue with cleanup
        }
      }
      session.pty.kill();
      sessions.delete(id);
    }

    const timeout = new Promise<void>((resolve) =>
      setTimeout(resolve, KILL_ALL_TIMEOUT_MS),
    );

    try {
      await Promise.race([
        Promise.all(pending).then(() => {}),
        timeout,
      ]);
      log("info", "All sessions killed");
    } catch (error) {
      log("error", "Error during killAllAndWait", { error });
    }
  }

  destroyAll(): void {
    this.killAll();
    try {
      tmuxExec("kill-server");
    } catch {
      // Server may not be running
    }
  }

  discoverSessions(): DiscoveredSession[] {
    let tmuxNames: string[];
    try {
      const raw = tmuxExec(
        "list-sessions", "-F", "#{session_name}",
      );
      tmuxNames = raw.split("\n").filter(Boolean);
    } catch {
      tmuxNames = [];
    }

    const tmuxSet = new Set(tmuxNames);
    const result: DiscoveredSession[] = [];

    let metaFiles: string[];
    try {
      metaFiles = fs
        .readdirSync(SESSION_DIR)
        .filter((f) => f.endsWith(".json"));
    } catch {
      metaFiles = [];
    }

    for (const file of metaFiles) {
      const sessionId = file.replace(".json", "");
      const name = tmuxSessionName(sessionId);

      if (tmuxSet.has(name)) {
        const meta = readSessionMeta(sessionId);
        if (meta) {
          result.push({ sessionId, meta });
        }
        tmuxSet.delete(name);
      } else {
        deleteSessionMeta(sessionId);
      }
    }

    for (const orphan of tmuxSet) {
      if (orphan.startsWith("collab-")) {
        try {
          tmuxExec("kill-session", "-t", orphan);
        } catch {
          // Already dead
        }
      }
    }

    return result;
  }

  verifyAvailable(): void {
    tmuxExec("-V");
  }

  setShuttingDown(value: boolean): void {
    shuttingDown = value;
  }
}
