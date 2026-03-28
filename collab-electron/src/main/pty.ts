import * as pty from "node-pty";
import * as os from "os";
import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
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
import { getTerminalMode, type TerminalMode } from "./config";
import { SidecarClient } from "./sidecar/client";
import {
  SIDECAR_SOCKET_PATH,
  SIDECAR_PID_PATH,
  SIDECAR_VERSION,
  type PidFileData,
} from "./sidecar/protocol";

function terminalMode(): TerminalMode {
  return getTerminalMode();
}

interface PtySession {
  pty: pty.IPty;
  shell: string;
  disposables: IDisposable[];
}

const sessions = new Map<string, PtySession>();
let shuttingDown = false;

let sidecarClient: SidecarClient | null = null;

/** Map of sessionId -> data socket for sidecar sessions. */
const dataSockets = new Map<string, net.Socket>();

/**
 * Track which sessions are sidecar-managed. Sidecar sessions never
 * touch the `sessions` Map (which holds IPty objects).
 */
const sidecarSessionIds = new Set<string>();

function getSidecarClient(): SidecarClient {
  if (!sidecarClient) throw new Error("Sidecar client not initialized");
  return sidecarClient;
}

/**
 * Determine which backend owns an existing session.
 * Checks in-memory tracking first, then falls back to persisted metadata.
 */
function sessionBackend(sessionId: string): TerminalMode {
  if (sidecarSessionIds.has(sessionId)) return "sidecar";
  if (dataSockets.has(sessionId)) return "sidecar";
  if (sessions.has(sessionId)) return "tmux";
  const meta = readSessionMeta(sessionId);
  return meta?.backend ?? "tmux";
}

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

export async function ensureSidecar(): Promise<void> {
  if (sidecarClient) {
    try {
      await sidecarClient.ping();
      return;
    } catch {
      sidecarClient.disconnect();
      sidecarClient = null;
    }
  }

  let needsSpawn = false;
  try {
    const pidRaw = fs.readFileSync(SIDECAR_PID_PATH, "utf-8");
    const pidData = JSON.parse(pidRaw) as PidFileData;

    const client = new SidecarClient(SIDECAR_SOCKET_PATH);
    await client.connect();
    const ping = await client.ping();

    if (
      ping.token !== pidData.token ||
      ping.version !== SIDECAR_VERSION
    ) {
      try { await client.shutdownSidecar(); } catch {}
      client.disconnect();
      needsSpawn = true;
    } else {
      sidecarClient = client;
    }
  } catch {
    needsSpawn = true;
  }

  if (needsSpawn) {
    await spawnSidecar();
  }

  if (sidecarClient) {
    sidecarClient.onNotification((method, params) => {
      if (method === "session.exited") {
        const { sessionId, exitCode } = params as {
          sessionId: string;
          exitCode: number;
        };
        cleanupForegroundSession(sessionId);
        dataSockets.get(sessionId)?.destroy();
        dataSockets.delete(sessionId);
        deleteSessionMeta(sessionId);
        sendToMainWindow("pty:exit", { sessionId, exitCode });
      }
    });
  }
}

async function spawnSidecar(): Promise<void> {
  try { fs.unlinkSync(SIDECAR_SOCKET_PATH); } catch {}
  try { fs.unlinkSync(SIDECAR_PID_PATH); } catch {}

  const token = crypto.randomBytes(16).toString("hex");

  let app: typeof import("electron").app | undefined;
  try { app = require("electron").app; } catch {}
  if (!app) throw new Error("Cannot spawn sidecar outside Electron");

  const sidecarPath = app.isPackaged
    ? path.join(
        process.resourcesPath,
        "app.asar",
        "out",
        "main",
        "pty-sidecar.js",
      )
    : path.join(__dirname, "pty-sidecar.js");

  const child = require("node:child_process").spawn(
    process.execPath,
    [sidecarPath, "--token", token],
    {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    },
  );
  child.unref();

  const maxWait = 5000;
  const interval = 100;
  let waited = 0;
  while (waited < maxWait) {
    await new Promise((r) => setTimeout(r, interval));
    waited += interval;
    try {
      const client = new SidecarClient(SIDECAR_SOCKET_PATH);
      await client.connect();
      const ping = await client.ping();
      if (ping.token === token) {
        sidecarClient = client;
        return;
      }
      client.disconnect();
    } catch {
      // Not ready yet
    }
  }
  throw new Error("Sidecar failed to start within timeout");
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
      cleanupForegroundSession(sessionId);
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

export async function createSession(
  cwd?: string,
  senderWebContentsId?: number,
  cols?: number,
  rows?: number,
): Promise<{ sessionId: string; shell: string }> {
  const sessionId = crypto.randomBytes(8).toString("hex");
  const shell = process.env.SHELL || "/bin/zsh";
  const resolvedCwd = cwd || os.homedir();
  const c = cols || 80;
  const r = rows || 24;

  const mode = terminalMode();

  if (mode === "sidecar") {
    await ensureSidecar();
    const client = getSidecarClient();
    const { sessionId: sid, socketPath } =
      await client.createSession({
        shell,
        cwd: resolvedCwd,
        cols: c,
        rows: r,
        env: utf8Env(),
      });

    const dataSock = await client.attachDataSocket(
      socketPath,
      (data) => {
        sendToSender(senderWebContentsId, "pty:data", {
          sessionId: sid,
          data,
        });
        scheduleForegroundCheck(sid);
      },
    );
    dataSockets.set(sid, dataSock);

    writeSessionMeta(sid, {
      shell,
      cwd: resolvedCwd,
      createdAt: new Date().toISOString(),
      backend: "sidecar",
    });

    sidecarSessionIds.add(sid);
    return { sessionId: sid, shell };
  }

  const name = tmuxSessionName(sessionId);

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

  attachClient(sessionId, c, r, senderWebContentsId);

  writeSessionMeta(sessionId, {
    shell,
    cwd: resolvedCwd,
    createdAt: new Date().toISOString(),
    backend: "tmux",
  });

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

export async function reconnectSession(
  sessionId: string,
  cols: number,
  rows: number,
  senderWebContentsId: number,
): Promise<{
  sessionId: string;
  shell: string;
  meta: SessionMeta | null;
  scrollback: string;
  mode: "tmux" | "sidecar";
}> {
  // Route based on the backend that originally created this session.
  // Sessions without a backend field are legacy tmux sessions.
  const meta = readSessionMeta(sessionId);
  const backend = meta?.backend ?? "tmux";

  if (backend === "sidecar") {
    await ensureSidecar();
    const client = getSidecarClient();
    const { socketPath } = await client.reconnectSession(
      sessionId, cols, rows,
    );

    const dataSock = await client.attachDataSocket(
      socketPath,
      (data) => {
        sendToSender(senderWebContentsId, "pty:data", {
          sessionId,
          data,
        });
        scheduleForegroundCheck(sessionId);
      },
    );

    dataSockets.get(sessionId)?.destroy();
    dataSockets.set(sessionId, dataSock);

    const shell = meta?.shell || process.env.SHELL || "/bin/zsh";
    sidecarSessionIds.add(sessionId);

    return {
      sessionId, shell, meta, scrollback: "", mode: "sidecar",
    };
  }

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

  const session = sessions.get(sessionId)!;
  session.shell =
    meta?.shell || process.env.SHELL || "/bin/zsh";

  return {
    sessionId, shell: session.shell, meta, scrollback, mode: "tmux",
  };
}

export function writeToSession(
  sessionId: string,
  data: string,
): void {
  const dataSock = dataSockets.get(sessionId);
  if (dataSock && !dataSock.destroyed) {
    dataSock.write(data);
    return;
  }
  const session = sessions.get(sessionId);
  if (!session) return;
  session.pty.write(data);
}

export function sendRawKeys(
  sessionId: string,
  data: string,
): void {
  if (terminalMode() !== "tmux") {
    writeToSession(sessionId, data);
    return;
  }
  const name = tmuxSessionName(sessionId);
  tmuxExec("send-keys", "-l", "-t", name, data);
}

export async function resizeSession(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> {
  const backend = sessionBackend(sessionId);

  if (backend === "sidecar") {
    const client = getSidecarClient();
    await client.resizeSession(sessionId, cols, rows);
    return;
  }

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

export async function killSession(
  sessionId: string,
): Promise<void> {
  clearForegroundCache(sessionId);
  const backend = sessionBackend(sessionId);

  if (backend === "sidecar") {
    dataSockets.get(sessionId)?.destroy();
    dataSockets.delete(sessionId);
    try {
      const client = getSidecarClient();
      await client.killSession(sessionId);
    } catch {
      // Session may already be dead
    }
    sidecarSessionIds.delete(sessionId);
    deleteSessionMeta(sessionId);
    return;
  }

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
  cleanupAllForegroundSessions();
  for (const [, sock] of dataSockets) {
    sock.destroy();
  }
  dataSockets.clear();
  sidecarSessionIds.clear();
  for (const [, session] of sessions) {
    for (const d of session.disposables) d.dispose();
    session.pty.kill();
  }
  sessions.clear();
}

const KILL_ALL_TIMEOUT_MS = 2000;

export function killAllAndWait(): Promise<void> {
  shuttingDown = true;
  cleanupAllForegroundSessions();
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
  if (terminalMode() === "tmux") {
    try {
      tmuxExec("kill-server");
    } catch {
      // Server may not be running
    }
  }
}

/**
 * Shut down the sidecar if it has no remaining sessions.
 * Called during app quit so the detached process doesn't linger.
 */
export async function shutdownSidecarIfIdle(): Promise<void> {
  if (!sidecarClient) return;
  try {
    const sessions = await sidecarClient.listSessions();
    if (sessions.length === 0) {
      await sidecarClient.shutdownSidecar();
    }
  } catch {
    // Sidecar already gone or unreachable — nothing to do.
  }
  sidecarClient = null;
}

export interface DiscoveredSession {
  sessionId: string;
  meta: SessionMeta;
}

export async function discoverSessions(): Promise<DiscoveredSession[]> {
  const mode = terminalMode();

  if (mode === "sidecar") {
    try {
      const client = getSidecarClient();
      const list = await client.listSessions();
      return list.map((s) => ({
        sessionId: s.sessionId,
        meta: {
          shell: s.shell,
          cwd: s.cwd,
          createdAt: s.createdAt,
        },
      }));
    } catch {
      return [];
    }
  }

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
    const meta = readSessionMeta(sessionId);

    // Skip metadata from a different backend — it belongs to the
    // sidecar process and must not be deleted or returned here.
    if (meta?.backend === "sidecar") continue;

    const name = tmuxSessionName(sessionId);

    if (tmuxSet.has(name)) {
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

export async function getForegroundProcess(
  sessionId: string,
): Promise<string | null> {
  if (sessionBackend(sessionId) === "sidecar") {
    try {
      const client = getSidecarClient();
      return await client.getForeground(sessionId);
    } catch {
      return null;
    }
  }

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
const lastDataTime = new Map<string, number>();
const fgTimers = new Map<string, ReturnType<typeof setTimeout>>();
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

function doForegroundCheck(sessionId: string): void {
  getForegroundProcess(sessionId).then((fg) => {
    if (fg == null) return;
    const prev = lastForeground.get(sessionId);
    if (fg === prev) return;
    lastForeground.set(sessionId, fg);
    sendToMainWindow("pty:status-changed", {
      sessionId,
      foreground: fg,
    });
  });
}

export function scheduleForegroundCheck(sessionId: string): void {
  lastDataTime.set(sessionId, Date.now());
  if (fgTimers.has(sessionId)) return;

  fgTimers.set(sessionId, setTimeout(function check() {
    const last = lastDataTime.get(sessionId) ?? 0;
    const elapsed = Date.now() - last;
    if (elapsed >= STATUS_DEBOUNCE_MS) {
      fgTimers.delete(sessionId);
      lastDataTime.delete(sessionId);
      doForegroundCheck(sessionId);
    } else {
      fgTimers.set(sessionId, setTimeout(check, STATUS_DEBOUNCE_MS - elapsed));
    }
  }, STATUS_DEBOUNCE_MS));
}

function cleanupForegroundSession(sessionId: string): void {
  lastForeground.delete(sessionId);
  lastDataTime.delete(sessionId);
  const timer = fgTimers.get(sessionId);
  if (timer) { clearTimeout(timer); fgTimers.delete(sessionId); }
}

function cleanupAllForegroundSessions(): void {
  for (const timer of fgTimers.values()) clearTimeout(timer);
  fgTimers.clear();
  lastDataTime.clear();
  lastForeground.clear();
}

export function clearForegroundCache(sessionId: string): void {
  cleanupForegroundSession(sessionId);
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

export async function cleanDetachedSessions(
  activeSessionIds: string[],
): Promise<void> {
  if (terminalMode() !== "tmux") return;

  const active = new Set(activeSessionIds);
  const attached = getAttachedSessionNames();
  const discovered = await discoverSessions();

  for (const { sessionId } of discovered) {
    if (active.has(sessionId)) continue;
    if (attached.has(tmuxSessionName(sessionId))) continue;
    await killSession(sessionId);
  }
}

export function verifyTmuxAvailable(): { ok: true } | { ok: false; message: string } {
  if (terminalMode() !== "tmux") return { ok: true };

  try {
    tmuxExec("-V");
    return { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error
      ? err.message
      : "tmux binary not found or not executable";
    return { ok: false, message };
  }
}
