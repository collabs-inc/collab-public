/**
 * PTY session manager — cross-platform (Windows + macOS/Linux).
 *
 * On Windows:
 *   Uses node-pty directly (backed by ConPTY).  No tmux dependency.
 *   Sessions are ephemeral — if the shell process exits the session
 *   is gone.  Metadata is still persisted so the renderer can
 *   discover running sessions after a window reload.
 *
 * On macOS/Linux:
 *   Uses tmux for session persistence (original behaviour).
 */

import * as pty from "node-pty";
import * as os from "os";
import * as fs from "node:fs";
import * as crypto from "crypto";
import { type IDisposable } from "node-pty";
import {
  getTmuxBin,
  getTerminfoDir,
  getDefaultShell,
  getPreferredWindowsShell,
  tmuxExec,
  tmuxSessionName,
  writeSessionMeta,
  readSessionMeta,
  deleteSessionMeta,
  SESSION_DIR,
  type SessionMeta,
} from "./tmux";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PtySession {
  pty: pty.IPty;
  shell: string;
  disposables: IDisposable[];
}

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

const sessions = new Map<string, PtySession>();
let shuttingDown = false;

const IS_WIN = process.platform === "win32";

export function setShuttingDown(value: boolean): void {
  shuttingDown = value;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

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

function buildEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;

  if (IS_WIN) {
    // Ensure UTF-8 code page for modern Windows terminals
    env.PYTHONIOENCODING = "utf-8";
    return env;
  }

  // macOS/Linux: ensure UTF-8 locale + terminfo
  if (!env.LANG || !env.LANG.includes("UTF-8")) {
    env.LANG = "en_US.UTF-8";
  }
  const terminfoDir = getTerminfoDir();
  if (terminfoDir) {
    env.TERMINFO = terminfoDir;
  }
  return env;
}

/* ------------------------------------------------------------------ */
/*  Windows: direct PTY sessions                                       */
/* ------------------------------------------------------------------ */

function createWindowsSession(
  cwd: string,
  cols: number,
  rows: number,
  senderWebContentsId?: number,
): { sessionId: string; shell: string } {
  const sessionId = crypto.randomBytes(8).toString("hex");
  const shell = getPreferredWindowsShell();
  const resolvedCwd = cwd || os.homedir();

  // Spawn shell directly via node-pty (ConPTY on Windows)
  const ptyProcess = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: resolvedCwd,
    env: buildEnv(),
    useConpty: true,
  } as pty.IPtyForkOptions & { useConpty?: boolean });

  const disposables: IDisposable[] = [];

  disposables.push(
    ptyProcess.onData((data: string) => {
      sendToSender(senderWebContentsId, "pty:data", {
        sessionId,
        data,
      });
    }),
  );

  disposables.push(
    ptyProcess.onExit(({ exitCode }) => {
      if (!shuttingDown) {
        deleteSessionMeta(sessionId);
        sendToSender(senderWebContentsId, "pty:exit", {
          sessionId,
          exitCode,
        });
      }
      sessions.delete(sessionId);
    }),
  );

  sessions.set(sessionId, { pty: ptyProcess, shell, disposables });

  writeSessionMeta(sessionId, {
    shell,
    cwd: resolvedCwd,
    createdAt: new Date().toISOString(),
  });

  return { sessionId, shell };
}

/* ------------------------------------------------------------------ */
/*  macOS/Linux: tmux-backed sessions (original logic)                 */
/* ------------------------------------------------------------------ */

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
    { name: "xterm-256color", cols, rows, env: buildEnv() },
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

function createUnixSession(
  cwd: string,
  cols: number,
  rows: number,
  senderWebContentsId?: number,
): { sessionId: string; shell: string } {
  const sessionId = crypto.randomBytes(8).toString("hex");
  const shell = getDefaultShell();
  const name = tmuxSessionName(sessionId);
  const resolvedCwd = cwd || os.homedir();

  tmuxExec(
    "new-session", "-d",
    "-s", name,
    "-c", resolvedCwd,
    "-x", String(cols),
    "-y", String(rows),
  );

  tmuxExec(
    "set-environment", "-t", name,
    "COLLAB_PTY_SESSION_ID", sessionId,
  );
  tmuxExec(
    "set-environment", "-t", name,
    "SHELL", shell,
  );

  writeSessionMeta(sessionId, {
    shell,
    cwd: resolvedCwd,
    createdAt: new Date().toISOString(),
  });

  attachClient(sessionId, cols, rows, senderWebContentsId);

  const session = sessions.get(sessionId)!;
  session.shell = shell;

  return { sessionId, shell };
}

/* ------------------------------------------------------------------ */
/*  Public API — cross-platform                                        */
/* ------------------------------------------------------------------ */

export function createSession(
  cwd?: string,
  senderWebContentsId?: number,
  cols?: number,
  rows?: number,
): { sessionId: string; shell: string } {
  const c = cols || 80;
  const r = rows || 24;
  const resolvedCwd = cwd || os.homedir();

  if (IS_WIN) {
    return createWindowsSession(resolvedCwd, c, r, senderWebContentsId);
  }
  return createUnixSession(resolvedCwd, c, r, senderWebContentsId);
}

function stripTrailingBlanks(text: string): string {
  const lines = text.split("\n");
  let end = lines.length;
  while (end > 0 && lines[end - 1]!.trim() === "") {
    end--;
  }
  return lines.slice(0, end).join("\n");
}

export function reconnectSession(
  sessionId: string,
  cols: number,
  rows: number,
  senderWebContentsId: number,
): {
  sessionId: string;
  shell: string;
  meta: SessionMeta | null;
  scrollback: string;
} {
  if (IS_WIN) {
    // On Windows, sessions are in-memory.  If the session object
    // still exists we can re-attach the IPC listeners; otherwise
    // the session is gone (shell exited).
    const existing = sessions.get(sessionId);
    if (!existing) {
      deleteSessionMeta(sessionId);
      throw new Error(`Session ${sessionId} not found (shell exited)`);
    }

    // Dispose old listeners and re-attach with new sender
    for (const d of existing.disposables) d.dispose();
    const disposables: IDisposable[] = [];

    disposables.push(
      existing.pty.onData((data: string) => {
        sendToSender(senderWebContentsId, "pty:data", {
          sessionId,
          data,
        });
      }),
    );

    disposables.push(
      existing.pty.onExit(({ exitCode }) => {
        if (!shuttingDown) {
          deleteSessionMeta(sessionId);
          sendToSender(senderWebContentsId, "pty:exit", {
            sessionId,
            exitCode,
          });
        }
        sessions.delete(sessionId);
      }),
    );

    existing.disposables = disposables;

    // Resize to requested dimensions
    try {
      existing.pty.resize(cols, rows);
    } catch {
      // Non-fatal
    }

    const meta = readSessionMeta(sessionId);
    return {
      sessionId,
      shell: existing.shell,
      meta,
      scrollback: "", // ConPTY does not expose scrollback history
    };
  }

  // Unix path — tmux-based reconnection
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
    meta?.shell || getDefaultShell();

  return { sessionId, shell: session.shell, meta, scrollback };
}

export function writeToSession(
  sessionId: string,
  data: string,
): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.pty.write(data);
}

export function sendRawKeys(
  sessionId: string,
  data: string,
): void {
  if (IS_WIN) {
    // On Windows, write directly to the PTY
    writeToSession(sessionId, data);
    return;
  }
  const name = tmuxSessionName(sessionId);
  tmuxExec("send-keys", "-l", "-t", name, data);
}

export function resizeSession(
  sessionId: string,
  cols: number,
  rows: number,
): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.pty.resize(cols, rows);

  if (!IS_WIN) {
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
}

export function killSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    for (const d of session.disposables) d.dispose();
    session.pty.kill();
    sessions.delete(sessionId);
  }

  if (!IS_WIN) {
    const name = tmuxSessionName(sessionId);
    try {
      tmuxExec("kill-session", "-t", name);
    } catch {
      // Session may already be dead
    }
  }

  deleteSessionMeta(sessionId);
}

export function listSessions(): string[] {
  return [...sessions.keys()];
}

export function killAll(): void {
  shuttingDown = true;
  for (const [id, session] of sessions) {
    for (const d of session.disposables) d.dispose();
    session.pty.kill();
    sessions.delete(id);
  }
}

const KILL_ALL_TIMEOUT_MS = 2000;

export function killAllAndWait(): Promise<void> {
  shuttingDown = true;
  if (sessions.size === 0) return Promise.resolve();

  const pending: Promise<void>[] = [];
  for (const [id, session] of sessions) {
    pending.push(
      new Promise<void>((resolve) => {
        session.pty.onExit(() => resolve());
      }),
    );
    for (const d of session.disposables) d.dispose();
    session.pty.kill();
    sessions.delete(id);
  }

  const timeout = new Promise<void>((resolve) =>
    setTimeout(resolve, KILL_ALL_TIMEOUT_MS),
  );

  return Promise.race([
    Promise.all(pending).then(() => {}),
    timeout,
  ]);
}

export function destroyAll(): void {
  killAll();
  if (!IS_WIN) {
    try {
      tmuxExec("kill-server");
    } catch {
      // Server may not be running
    }
  }
}

export interface DiscoveredSession {
  sessionId: string;
  meta: SessionMeta;
}

export function discoverSessions(): DiscoveredSession[] {
  if (IS_WIN) {
    // On Windows, active sessions are held in-memory.
    // Cross-reference with metadata files on disk.
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
      if (sessions.has(sessionId)) {
        const meta = readSessionMeta(sessionId);
        if (meta) {
          result.push({ sessionId, meta });
        }
      } else {
        // Stale metadata — shell already exited
        deleteSessionMeta(sessionId);
      }
    }
    return result;
  }

  // Unix path — query tmux
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

export function verifyTmuxAvailable(): void {
  if (IS_WIN) {
    // On Windows we use ConPTY — no tmux needed.
    console.log("[pty] Windows detected — using ConPTY (no tmux required)");
    return;
  }
  tmuxExec("-V");
}
