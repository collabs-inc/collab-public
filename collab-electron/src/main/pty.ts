import * as pty from "node-pty";
import * as os from "os";
import * as fs from "node:fs";
import * as crypto from "crypto";
import { type IDisposable } from "node-pty";
import {
  getTmuxBin,
  getTerminfoDir,
  getSocketName,
  tmuxExec,
  tmuxSessionName,
  writeSessionMeta,
  readSessionMeta,
  deleteSessionMeta,
  SESSION_DIR,
  type SessionMeta,
} from "./tmux";

interface PtySession {
  pty: pty.IPty;
  shell: string;
  disposables: IDisposable[];
}

const sessions = new Map<string, PtySession>();
let shuttingDown = false;

export function setShuttingDown(value: boolean): void {
  shuttingDown = value;
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
  const env = { ...process.env } as Record<string, string>;
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
    ["-L", getSocketName(), "-u", "attach-session", "-t", name],
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
      scheduleForegroundCheck(sessionId);
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
        // Also notify the shell BrowserWindow for terminal list cleanup
        sendToMainWindow("pty:exit", { sessionId, exitCode: 0 });
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

export function createSession(
  cwd?: string,
  senderWebContentsId?: number,
  cols?: number,
  rows?: number,
): { sessionId: string; shell: string } {
  const sessionId = crypto.randomBytes(8).toString("hex");
  const shell = process.env.SHELL || "/bin/zsh";
  const name = tmuxSessionName(sessionId);
  const resolvedCwd = cwd || os.homedir();
  const c = cols || 80;
  const r = rows || 24;

  tmuxExec(
    "new-session", "-d",
    "-s", name,
    "-c", resolvedCwd,
    "-x", String(c),
    "-y", String(r),
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

  attachClient(sessionId, c, r, senderWebContentsId);

  const session = sessions.get(sessionId)!;
  session.shell = shell;

  return { sessionId, shell };
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

export function killSession(sessionId: string): void {
  clearForegroundCache(sessionId);
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
  try {
    tmuxExec("kill-server");
  } catch {
    // Server may not be running
  }
}

export interface DiscoveredSession {
  sessionId: string;
  meta: SessionMeta;
}

export function discoverSessions(): DiscoveredSession[] {
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

export function captureRecentOutput(
  sessionId: string,
  lineCount = 50,
): string {
  const name = tmuxSessionName(sessionId);
  try {
    const raw = tmuxExec(
      "capture-pane", "-t", name,
      "-p", "-S", `-${lineCount}`,
    );
    return stripTrailingBlanks(raw);
  } catch {
    return "";
  }
}

export function captureTerminalSnapshot(
  sessionId: string,
): { output: string; cwd: string; foreground: string; title: string } {
  const name = tmuxSessionName(sessionId);
  let output = "";
  let cwd = "";
  let foreground = "";
  let title = "";
  try {
    output = stripTrailingBlanks(
      tmuxExec("capture-pane", "-t", name, "-p", "-S", "-100"),
    );
  } catch { /* */ }
  try {
    const info = tmuxExec(
      "display-message", "-t", name,
      "-p", "#{pane_current_path}\t#{pane_current_command}\t#{pane_title}",
    );
    const parts = info.split("\t");
    cwd = parts[0] || "";
    foreground = parts[1] || "";
    title = parts[2] || "";
  } catch { /* */ }
  return { output, cwd, foreground, title };
}

export function getForegroundProcess(
  sessionId: string,
): string | null {
  const name = tmuxSessionName(sessionId);
  try {
    return tmuxExec(
      "display-message", "-t", name,
      "-p", "#{pane_current_command}",
    );
  } catch {
    return null;
  }
}

const lastForeground = new Map<string, string>();
const statusTimers = new Map<string, ReturnType<typeof setTimeout>>();
const STATUS_DEBOUNCE_MS = 500;

function sendToMainWindow(channel: string, payload: unknown): void {
  const { BrowserWindow } = require("electron");
  const wins = BrowserWindow.getAllWindows();
  for (const win of wins) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

export function scheduleForegroundCheck(sessionId: string): void {
  const existing = statusTimers.get(sessionId);
  if (existing) clearTimeout(existing);

  statusTimers.set(
    sessionId,
    setTimeout(() => {
      statusTimers.delete(sessionId);
      const fg = getForegroundProcess(sessionId);
      if (fg == null) return;

      const prev = lastForeground.get(sessionId);
      if (fg === prev) return;

      lastForeground.set(sessionId, fg);
      sendToMainWindow("pty:status-changed", {
        sessionId,
        foreground: fg,
      });
    }, STATUS_DEBOUNCE_MS),
  );
}

export function clearForegroundCache(sessionId: string): void {
  lastForeground.delete(sessionId);
  const timer = statusTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    statusTimers.delete(sessionId);
  }
}

function getAttachedSessionNames(): Set<string> {
  try {
    const raw = tmuxExec(
      "list-sessions", "-F",
      "#{session_name}:#{session_attached}",
    );
    const attached = new Set<string>();
    for (const line of raw.split("\n").filter(Boolean)) {
      const sep = line.lastIndexOf(":");
      const name = line.slice(0, sep);
      const count = parseInt(line.slice(sep + 1), 10);
      if (count > 0) attached.add(name);
    }
    return attached;
  } catch {
    return new Set();
  }
}

export function cleanDetachedSessions(
  activeSessionIds: string[],
): void {
  const active = new Set(activeSessionIds);
  const attached = getAttachedSessionNames();
  const discovered = discoverSessions();

  for (const { sessionId } of discovered) {
    if (active.has(sessionId)) continue;
    if (attached.has(tmuxSessionName(sessionId))) continue;
    killSession(sessionId);
  }
}

export function verifyTmuxAvailable(): void {
  tmuxExec("-V");
}
