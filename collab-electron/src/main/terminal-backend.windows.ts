/**
 * Windows Terminal Backend
 *
 * Windows implementation using node-pty directly without tmux.
 * Uses PowerShell as the default shell, with cmd.exe as fallback.
 */

import * as pty from "node-pty";
import * as os from "os";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "crypto";
import { type IDisposable } from "node-pty";
import type {
  TerminalBackend,
  DiscoveredSession,
  ReconnectResult,
  SessionMeta,
} from "./terminal-backend";
import {
  SESSION_DIR,
  writeSessionMeta,
  readSessionMeta,
  deleteSessionMeta,
} from "./tmux";

/**
 * Logging utility for Windows terminal backend
 */
function log(level: "info" | "warn" | "error", message: string, data?: unknown): void {
  const prefix = `[WindowsTerminalBackend:${level}]`;
  if (data !== undefined) {
    console.log(prefix, message, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

interface PtySession {
  pty: pty.IPty;
  shell: string;
  cwd: string;
  disposables: IDisposable[];
}

const sessions = new Map<string, PtySession>();
let shuttingDown = false;

const KILL_ALL_TIMEOUT_MS = 2000;

/**
 * Get the default shell path for Windows
 * PowerShell is preferred, with cmd.exe as fallback
 */
function getDefaultShell(): string {
  // Try PowerShell first (available on all modern Windows)
  const powerShellPaths = [
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    "C:\\Windows\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe",
  ];

  for (const psPath of powerShellPaths) {
    if (fs.existsSync(psPath)) {
      return psPath;
    }
  }

  // Fallback to cmd.exe
  return "C:\\Windows\\System32\\cmd.exe";
}

/**
 * Get the default shell name for environment setup
 */
function getDefaultShellName(): string {
  const shell = getDefaultShell();
  if (shell.includes("powershell")) {
    return "PowerShell";
  }
  return "cmd.exe";
}

/**
 * Windows environment setup for PTY
 */
function windowsEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  // Filter out undefined values and build a clean string-only record
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  // Ensure proper code page for UTF-8 output
  if (!env.LANG) {
    env.LANG = "en_US.UTF-8";
  }

  // Set COLORTERM for true color support
  if (!env.COLORTERM) {
    env.COLORTERM = "truecolor";
  }

  // Set TERM for xterm compatibility
  env.TERM = "xterm-256color";

  return env;
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

function spawnWindowsPty(
  shell: string,
  cwd: string,
  cols: number,
  rows: number,
): pty.IPty {
  const args: string[] = [];

  // Configure shell arguments based on shell type
  if (shell.includes("powershell")) {
    // PowerShell arguments for interactive session
    args.push("-NoExit", "-NoLogo", "-NoProfile");
  } else if (shell.includes("cmd.exe")) {
    // cmd.exe doesn't need special args for interactive use
  }

  return pty.spawn(shell, args, {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env: windowsEnv(),
  });
}

function createSessionInternal(
  sessionId: string,
  shell: string,
  cwd: string,
  cols: number,
  rows: number,
  senderWebContentsId?: number,
): PtySession {
  const ptyProcess = spawnWindowsPty(shell, cwd, cols, rows);

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
    ptyProcess.onExit(({ exitCode }) => {
      if (shuttingDown) {
        sessions.delete(sessionId);
        deleteSessionMeta(sessionId);
        return;
      }
      deleteSessionMeta(sessionId);
      sendToSender(
        senderWebContentsId,
        "pty:exit",
        { sessionId, exitCode: exitCode ?? 0 },
      );
      sessions.delete(sessionId);
    }),
  );

  const session: PtySession = {
    pty: ptyProcess,
    shell,
    cwd,
    disposables,
  };

  sessions.set(sessionId, session);
  return session;
}

/**
 * Windows Terminal Backend implementation
 *
 * Uses node-pty directly without tmux wrapper.
 * Sessions are persisted to disk for reconnection after app restart.
 */
export class WindowsTerminalBackend implements TerminalBackend {
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

    const shell = process.env.COMSPEC || getDefaultShell();
    const resolvedCwd = cwd || os.homedir();
    const c = cols || 80;
    const r = rows || 24;

    try {
      writeSessionMeta(sessionId, {
        shell,
        cwd: resolvedCwd,
        createdAt: new Date().toISOString(),
      });
      log("info", "Created session metadata", { sessionId, shell, cwd: resolvedCwd });
    } catch (error) {
      log("error", "Failed to write session metadata", { sessionId, error });
      throw new Error(`Failed to persist session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      createSessionInternal(
        sessionId,
        shell,
        resolvedCwd,
        c,
        r,
        senderWebContentsId,
      );
      log("info", "Created Windows PTY session", { sessionId, cols: c, rows: r });
    } catch (error) {
      log("error", "Failed to create PTY session", { sessionId, error });
      // Clean up metadata if PTY creation fails
      deleteSessionMeta(sessionId);
      throw new Error(`Failed to spawn terminal: ${error instanceof Error ? error.message : String(error)}`);
    }

    return { sessionId, shell };
  }

  reconnectSession(
    sessionId: string,
    cols: number,
    rows: number,
    senderWebContentsId: number,
  ): ReconnectResult {
    const meta = readSessionMeta(sessionId);

    if (!meta) {
      log("error", "Session metadata not found during reconnect", { sessionId });
      throw new Error(`Session ${sessionId} not found`);
    }

    // Verify the session is still alive
    const existingSession = sessions.get(sessionId);
    if (existingSession && existingSession.pty) {
      // Session already exists in memory, just resize it
      try {
        existingSession.pty.resize(cols, rows);
        log("info", "Resized existing session", { sessionId, cols, rows });
      } catch (error) {
        log("error", "Failed to resize existing session", { sessionId, error });
      }

      return {
        sessionId,
        shell: existingSession.shell,
        meta,
        scrollback: "",
      };
    }

    // Session not in memory - this shouldn't happen on Windows
    // since we don't have persistent sessions like tmux
    log("error", "Session cannot be reconnected - no persistent session support on Windows", { sessionId });
    throw new Error(
      `Session ${sessionId} cannot be reconnected - Windows does not support persistent terminal sessions`,
    );
  }

  writeToSession(sessionId: string, data: string): void {
    const session = sessions.get(sessionId);
    if (!session) return;
    session.pty.write(data);
  }

  sendRawKeys(sessionId: string, data: string): void {
    // On Windows, sendRawKeys is equivalent to write
    // node-pty handles key sequence translation on Windows
    this.writeToSession(sessionId, data);
  }

  resizeSession(sessionId: string, cols: number, rows: number): void {
    const session = sessions.get(sessionId);
    if (!session) return;
    session.pty.resize(cols, rows);
  }

  killSession(sessionId: string): void {
    const session = sessions.get(sessionId);
    if (session) {
      log("info", "Killing session", { sessionId });
      for (const d of session.disposables) {
        try {
          d.dispose();
        } catch (error) {
          log("error", "Error disposing disposable", { error });
        }
      }
      try {
        session.pty.kill();
        log("info", "Killed PTY process", { sessionId });
      } catch (error) {
        log("warn", "PTY kill failed - process may already be dead", { sessionId, error });
      }
      sessions.delete(sessionId);
    } else {
      log("warn", "Attempted to kill non-existent session", { sessionId });
    }

    try {
      deleteSessionMeta(sessionId);
    } catch (error) {
      log("error", "Failed to delete session metadata", { sessionId, error });
    }
  }

  listSessions(): string[] {
    return [...sessions.keys()];
  }

  killAll(): void {
    shuttingDown = true;
    log("info", "Killing all sessions", { count: sessions.size });
    for (const [id, session] of sessions) {
      for (const d of session.disposables) {
        try {
          d.dispose();
        } catch (error) {
          log("error", "Error disposing disposable", { error });
        }
      }
      try {
        session.pty.kill();
      } catch {
        // Process may already be dead
      }
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
      try {
        session.pty.kill();
      } catch {
        // Process may already be dead
      }
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
  }

  discoverSessions(): DiscoveredSession[] {
    // On Windows, we can only return in-memory sessions
    // since we don't have a session manager like tmux
    const result: DiscoveredSession[] = [];

    for (const [sessionId, session] of sessions) {
      const meta = readSessionMeta(sessionId);
      if (meta) {
        result.push({ sessionId, meta });
      } else {
        log("warn", "Session in memory but metadata missing", { sessionId });
      }
    }

    // Clean up orphaned metadata files
    this.cleanupOrphanedMetadata();

    return result;
  }

  /**
   * Clean up metadata files for sessions that no longer exist
   */
  private cleanupOrphanedMetadata(): void {
    let metaFiles: string[];
    try {
      metaFiles = fs
        .readdirSync(SESSION_DIR)
        .filter((f) => f.endsWith(".json"));
    } catch (error) {
      log("warn", "Failed to read session directory for cleanup", { error });
      return;
    }

    for (const file of metaFiles) {
      const sessionId = file.replace(".json", "");
      if (!sessions.has(sessionId)) {
        try {
          deleteSessionMeta(sessionId);
          log("info", "Cleaned up orphaned metadata", { sessionId });
        } catch (error) {
          log("error", "Failed to delete orphaned metadata", { sessionId, error });
        }
      }
    }
  }

  verifyAvailable(): void {
    // node-pty is always available on Windows if installed
    // No external binary required
    const shell = getDefaultShell();
    if (!fs.existsSync(shell)) {
      log("error", "Default shell not found", { shell });
      throw new Error(`Default shell not found: ${shell}`);
    }
    log("info", "Windows terminal backend verified", { shell });
  }

  setShuttingDown(value: boolean): void {
    shuttingDown = value;
  }
}

// Re-export SessionMeta type for convenience
export type { SessionMeta };
