import * as pty from "node-pty";
import * as os from "os";
import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import * as crypto from "crypto";

/** Clamp terminal dimensions to safe bounds for node-pty / conpty. */
function clampDims(cols: number, rows: number): [number, number] {
  return [
    Math.max(2, Math.min(Math.round(cols || 80), 500)),
    Math.max(1, Math.min(Math.round(rows || 24), 300)),
  ];
}
import { type IDisposable } from "node-pty";
import { displayBasename } from "@collab/shared/path-utils";
import {
  getTerminfoDir,
  getTmuxSpawnSpec,
  tmuxExec,
  tmuxExecAsync,
  tmuxExecForTarget,
  tmuxSessionName,
  writeSessionMeta,
  readSessionMeta,
  deleteSessionMeta,
  SESSION_DIR,
  type SessionMeta,
} from "./tmux";
import { cleanupEndpoint } from "./ipc-endpoint";
import {
  getTerminalBackend,
  getTerminalMode,
  getTerminalTarget,
  getInProcessTerminals,
  type TerminalBackend,
  type TerminalMode,
  type TerminalTarget,
} from "./config";
import { SidecarClient } from "./sidecar/client";
import {
  DEFAULT_RING_BUFFER_BYTES,
  SIDECAR_SOCKET_PATH,
  SIDECAR_PID_PATH,
  SIDECAR_VERSION,
  type PidFileData,
} from "./sidecar/protocol";
import { RingBuffer } from "./sidecar/ring-buffer";
import {
  resolveTerminalTarget,
  type ResolvedTerminalTarget,
} from "./terminal-target";

const SESSION_ID_RE = /^[0-9a-f]{16}$/;
export function assertSessionId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !SESSION_ID_RE.test(id))
    throw new Error("Invalid session ID");
}

interface PtySession {
  pty: pty.IPty;
  shell: string;
  displayName: string;
  disposables: IDisposable[];
  backend: "tmux" | "direct";
  ownerWebContentsId?: number;
  target?: TerminalTarget | undefined;
  command?: string;
  args?: string[];
  cwdHostPath?: string;
  cwdGuestPath?: string | undefined;
  createdAt?: string;
  ringBuffer?: RingBuffer;
}

const sessions = new Map<string, PtySession>();

/**
 * Session ownership for sender verification on IPC calls.
 * Maps sessionId → the webContentsId that created the session.
 * Covers all backends (tmux, direct, sidecar).
 */
const sessionOwners = new Map<string, number>();

/**
 * Verify that a sender is allowed to operate on a session.
 * Returns true if the sender owns the session or if the session is
 * routed to the shell window (in-process mode).
 */
export function isSessionOwner(sessionId: string, senderWebContentsId: number): boolean {
  const owner = sessionOwners.get(sessionId);
  if (owner == null) {
    // Only allow if the session actually exists (legacy migration)
    return sessions.has(sessionId) || sidecarSessionIds.has(sessionId);
  }
  if (owner === senderWebContentsId) return true;
  // In in-process mode, the shell window is the effective sender for all sessions.
  if (shellWebContentsId != null && senderWebContentsId === shellWebContentsId) return true;
  return false;
}
let shuttingDown = false;

let sidecarClient: SidecarClient | null = null;

/** Map of sessionId -> data socket for sidecar sessions. */
const dataSockets = new Map<string, net.Socket>();

/**
 * Track which sessions are sidecar-managed. Sidecar sessions never
 * touch the `sessions` Map (which holds IPty objects).
 */
const sidecarSessionIds = new Set<string>();

/**
 * When in-process terminal mode is active, PTY data is routed to the
 * shell BrowserWindow instead of per-terminal webviews.
 */
let shellWebContentsId: number | null = null;

export function registerShellWebContents(id: number): void {
  shellWebContentsId = id;
}

/**
 * Return the webContents id that should receive PTY data/exit events.
 * When in-process terminals are enabled and the shell window is registered,
 * route to the shell window; otherwise use the original sender.
 *
 * Called only at session creation/reconnection (not on every data event),
 * so reading config from disk here is fine.
 */
function getEffectiveSender(senderWebContentsId?: number): number | undefined {
  const inProc = getInProcessTerminals();
  if (inProc && shellWebContentsId != null) {
    return shellWebContentsId;
  }
  return senderWebContentsId;
}

function getSidecarClient(): SidecarClient {
  if (!sidecarClient) throw new Error("Sidecar client not initialized");
  return sidecarClient;
}

/**
 * Determine which backend owns an existing session.
 * Checks in-memory tracking first, then falls back to persisted metadata.
 */
function sessionBackend(sessionId: string): TerminalMode | TerminalBackend {
  if (sidecarSessionIds.has(sessionId)) return "sidecar";
  if (dataSockets.has(sessionId)) return "sidecar";
  const session = sessions.get(sessionId);
  if (session) return session.backend;
  const meta = readSessionMeta(sessionId);
  return meta?.backend ?? "tmux";
}

function currentSessionBackend(): TerminalMode | TerminalBackend {
  if (getTerminalMode() === "tmux") return "tmux";
  return getTerminalBackend();
}

function backendForResolvedTarget(
  resolvedTarget: ResolvedTerminalTarget,
): TerminalMode | TerminalBackend {
  if (
    process.platform === "win32"
    && resolvedTarget.target.startsWith("wsl:")
  ) {
    return "tmux";
  }
  return currentSessionBackend();
}

function tmuxTargetKey(target?: TerminalTarget): string {
  return target?.startsWith("wsl:") ? target : "";
}

function tmuxTargetForSession(sessionId: string): TerminalTarget | undefined {
  const session = sessions.get(sessionId);
  const target = session?.target ?? readSessionMeta(sessionId)?.target;
  return typeof target === "string" ? target as TerminalTarget : undefined;
}

function listKnownTmuxTargets(metaFiles: string[] = []): Array<TerminalTarget | undefined> {
  const targets = new Map<string, TerminalTarget | undefined>();
  targets.set(tmuxTargetKey(undefined), undefined);

  for (const session of sessions.values()) {
    if (session.backend !== "tmux") continue;
    const target = typeof session.target === "string"
      ? session.target as TerminalTarget
      : undefined;
    targets.set(tmuxTargetKey(target), target);
  }

  for (const file of metaFiles) {
    const sessionId = file.replace(".json", "");
    const meta = readSessionMeta(sessionId);
    if ((meta?.backend ?? "tmux") !== "tmux") continue;
    const target = meta ? typeof meta.target === "string"
      ? meta.target as TerminalTarget
      : undefined : undefined;
    targets.set(tmuxTargetKey(target), target);
  }

  return [...targets.values()];
}

function terminalName(target?: TerminalTarget): string {
  if (process.platform === "win32" && target?.startsWith("wsl:")) {
    return "screen-256color";
  }
  return "xterm-256color";
}

async function ensureTmuxSessionAppearance(
  target: TerminalTarget | undefined,
  sessionName: string,
): Promise<void> {
  // Batch all appearance options into a single tmux invocation using the
  // command separator (;) so we only cross the Win32→WSL boundary once
  // instead of 2-3 times (~200-400ms saved on cold WSL).
  // Note: execFile passes args directly (no shell), so use literal ";"
  // rather than the shell-escaped "\;".
  const cmds: string[] = [];
  if (process.platform === "win32" && target?.startsWith("wsl:")) {
    cmds.push(
      "set-option", "-g", "default-terminal", "screen-256color", ";",
      "set-option", "-ga", "terminal-overrides",
      ",screen-256color:Tc:smcup@:rmcup@", ";",
    );
  }
  cmds.push("set-option", "-t", sessionName, "status", "off");
  try {
    await tmuxExecAsync(target, ...cmds);
  } catch {
    // Best effort. If this fails, the session is still usable.
  }
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
  // xterm.js supports 24-bit color; ensure spawned shells know this
  // so CLI tools (e.g. Claude Code) render with full true color
  // instead of falling back to 256-color palettes.
  env.COLORTERM = "truecolor";
  // Reduce git lock-file overhead on WSL 9P mounts (\\wsl$ / /mnt/).
  // Prompt plugins like oh-my-zsh/powerlevel10k run `git status` on
  // every prompt; unnecessary .lock files are expensive across the
  // Win32↔Linux boundary.
  env.GIT_OPTIONAL_LOCKS = "0";
  const terminfoDir = getTerminfoDir();
  if (terminfoDir) {
    env.TERMINFO = terminfoDir;
  }
  return env;
}

function withOptionalFields<T extends object>(
  base: T,
  fields: Record<string, unknown>,
): T {
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      Object.assign(base, { [key]: value });
    }
  }
  return base;
}

function resolvedTargetFields(
  resolvedTarget: ResolvedTerminalTarget,
): {
  target: string;
  command: string;
  args: string[];
  cwdHostPath: string;
  cwdGuestPath?: string;
} {
  return withOptionalFields({
    target: resolvedTarget.target,
    command: resolvedTarget.command,
    args: resolvedTarget.args,
    cwdHostPath: resolvedTarget.cwdHostPath,
  }, {
    cwdGuestPath: resolvedTarget.cwdGuestPath,
  });
}

function resolvedTargetMeta(
  resolvedTarget: ResolvedTerminalTarget,
  backend: SessionMeta["backend"],
  createdAt: string,
): SessionMeta {
  return withOptionalFields({
    shell: resolvedTarget.command,
    cwd: resolvedTarget.cwdHostPath,
    createdAt,
    target: resolvedTarget.target,
    displayName: resolvedTarget.displayName,
    command: resolvedTarget.command,
    args: resolvedTarget.args,
    cwdHostPath: resolvedTarget.cwdHostPath,
    backend,
  }, {
    cwdGuestPath: resolvedTarget.cwdGuestPath,
  }) as SessionMeta;
}

let sidecarStarting: Promise<void> | null = null;

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

  if (sidecarStarting) return sidecarStarting;
  sidecarStarting = doEnsureSidecar().finally(() => {
    sidecarStarting = null;
  });
  return sidecarStarting;
}

async function doEnsureSidecar(): Promise<void> {
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
        dataSockets.get(sessionId)?.destroy();
        dataSockets.delete(sessionId);
        sidecarSessionIds.delete(sessionId);
        sessionOwners.delete(sessionId);
        deleteSessionMeta(sessionId);
        sendToMainWindow("pty:exit", { sessionId, exitCode });
      }
    });
  }
}

function fixSpawnHelperPerms(): void {
  if (process.platform === "win32") return;
  try {
    const ptyDir = path.dirname(require.resolve("node-pty"));
    const helper = path.join(ptyDir, "..", "build", "Release", "spawn-helper");
    const stat = fs.statSync(helper);
    if (!(stat.mode & 0o111)) {
      fs.chmodSync(helper, 0o755);
    }
  } catch {
    // Best effort — packaged builds bundle the binary with correct perms.
  }
}

async function spawnSidecar(): Promise<void> {
  fixSpawnHelperPerms();
  cleanupEndpoint(SIDECAR_SOCKET_PATH);
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
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    },
  );
  child.stderr?.on("data", (chunk: Buffer) => {
    console.error(`[sidecar] ${chunk.toString().trimEnd()}`);
  });
  child.on("exit", (code: number | null) => {
    if (code !== 0 && code !== null) {
      console.error(`Sidecar exited with code ${code}`);
    }
  });
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
  target?: TerminalTarget,
): pty.IPty {
  const effectiveSender = getEffectiveSender(senderWebContentsId);
  const name = tmuxSessionName(sessionId);
  const spec = getTmuxSpawnSpec(target, "attach-session", "-t", name);
  const options: pty.IPtyForkOptions = {
    name: terminalName(target),
    cols,
    rows,
  };
  if (spec.env) {
    options.env = spec.env;
  }

  const ptyProcess = pty.spawn(
    spec.command,
    spec.args,
    options,
  );

  const disposables: IDisposable[] = [];

  disposables.push(
    ptyProcess.onData((data: string) => {
      sendToSender(
        effectiveSender,
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
        sessionOwners.delete(sessionId);
        return;
      }
      tmuxExecAsync(target, "has-session", "-t", name).catch(() => {
        deleteSessionMeta(sessionId);
        sendToSender(
          effectiveSender,
          "pty:exit",
          { sessionId, exitCode: 0 },
        );
        // Also notify the shell BrowserWindow for terminal list cleanup
        sendToMainWindow("pty:exit", { sessionId, exitCode: 0 });
      });
      sessions.delete(sessionId);
      sessionOwners.delete(sessionId);
    }),
  );

  sessions.set(sessionId, {
    pty: ptyProcess,
    shell: "",
    displayName: "",
    disposables,
    backend: "tmux",
    target,
  });

  return ptyProcess;
}

function createDirectSession(
  sessionId: string,
  resolvedTarget: ResolvedTerminalTarget,
  cols: number,
  rows: number,
  senderWebContentsId?: number,
): PtySession {
  const effectiveSender = getEffectiveSender(senderWebContentsId);
  const createdAt = new Date().toISOString();
  const ringBuffer = new RingBuffer(DEFAULT_RING_BUFFER_BYTES);
  const ptyProcess = pty.spawn(
    resolvedTarget.command,
    resolvedTarget.args,
    {
      name: terminalName(resolvedTarget.target),
      cols,
      rows,
      cwd: resolvedTarget.cwd,
      env: utf8Env(),
    },
  );

  const disposables: IDisposable[] = [];

  disposables.push(
    ptyProcess.onData((data: string) => {
      ringBuffer.write(Buffer.from(data));
      sendToSender(
        effectiveSender,
        "pty:data",
        { sessionId, data },
      );
      scheduleForegroundCheck(sessionId);
    }),
  );

  disposables.push(
    ptyProcess.onExit(({ exitCode }) => {
      sessions.delete(sessionId);
      sessionOwners.delete(sessionId);
      deleteSessionMeta(sessionId);
      sendToSender(
        effectiveSender,
        "pty:exit",
        { sessionId, exitCode },
      );
      sendToMainWindow("pty:exit", { sessionId, exitCode });
    }),
  );

  const session: PtySession = {
    pty: ptyProcess,
    shell: resolvedTarget.command,
    displayName: resolvedTarget.displayName,
    disposables,
    backend: "direct",
    target: resolvedTarget.target,
    command: resolvedTarget.command,
    args: resolvedTarget.args,
    cwdHostPath: resolvedTarget.cwdHostPath,
    cwdGuestPath: resolvedTarget.cwdGuestPath,
    createdAt,
    ringBuffer,
  };
  sessions.set(sessionId, session);
  return session;
}

export async function createSession(
  cwd?: string,
  senderWebContentsId?: number,
  cols?: number,
  rows?: number,
  preferredTarget?: TerminalTarget,
  tileId?: string,
): Promise<{
  sessionId: string;
  shell: string;
  displayName: string;
  target: string;
  command: string;
  args: string[];
  cwdHostPath: string;
  cwdGuestPath?: string;
}> {
  const resolvedCwd = cwd || os.homedir();
  const [c, r] = clampDims(cols ?? 80, rows ?? 24);

  const mode = getTerminalMode();

  if (mode === "tmux") {
    const sessionId = crypto.randomBytes(8).toString("hex");
    const name = tmuxSessionName(sessionId);
    const shell = process.env.SHELL || "/bin/zsh";
    const shellName = displayBasename(shell) || "shell";

    await tmuxExecAsync(
      undefined,
      "new-session", "-d",
      "-s", name,
      "-c", resolvedCwd,
      "-x", String(c),
      "-y", String(r),
    );

    try {
      const envTasks: Promise<unknown>[] = [
        tmuxExecAsync(undefined, "set-environment", "-t", name, "COLLAB_PTY_SESSION_ID", sessionId),
        tmuxExecAsync(undefined, "set-environment", "-t", name, "SHELL", shell),
      ];
      if (tileId) {
        envTasks.push(
          tmuxExecAsync(undefined, "set-environment", "-t", name, "COLLAB_TILE_ID", tileId),
        );
      }
      await Promise.all(envTasks);
    } catch {
      // Under WSL, the tmux server may not have registered the session yet.
      // The terminal will still work — these env vars are nice-to-have.
    }

    attachClient(sessionId, c, r, senderWebContentsId);
    const _owner = getEffectiveSender(senderWebContentsId) ?? senderWebContentsId;
    if (_owner != null) sessionOwners.set(sessionId, _owner);

    writeSessionMeta(sessionId, {
      shell,
      cwd: resolvedCwd,
      createdAt: new Date().toISOString(),
      backend: "tmux",
    });

    const session = sessions.get(sessionId)!;
    session.shell = shell;
    session.displayName = shellName;
    if (_owner != null) session.ownerWebContentsId = _owner;

    return {
      sessionId,
      shell,
      displayName: shellName,
      target: "shell",
      command: shell,
      args: [],
      cwdHostPath: resolvedCwd,
    };
  }

  const resolvedTarget = resolveTerminalTarget(
    preferredTarget ?? getTerminalTarget(),
    resolvedCwd,
  );
  const backend = backendForResolvedTarget(resolvedTarget);

  if (backend === "tmux") {
    const t0 = performance.now();
    const lap = (label: string) => {
      const elapsed = (performance.now() - t0).toFixed(1);
      console.log(`[pty] createSession tmux +${elapsed}ms  ${label}`);
    };

    const sessionId = crypto.randomBytes(8).toString("hex");
    const name = tmuxSessionName(sessionId);
    const shell = resolvedTarget.command;
    const tmuxTarget = resolvedTarget.target;
    const tmuxCwd = resolvedTarget.cwdGuestPath ?? resolvedTarget.cwdHostPath;

    lap(`new-session start (target=${tmuxTarget})`);
    await tmuxExecAsync(
      tmuxTarget,
      "new-session", "-d",
      "-s", name,
      "-c", tmuxCwd,
      "-x", String(c),
      "-y", String(r),
    );
    lap("new-session done");

    // Run set-environment and appearance setup in parallel — they are
    // independent post-creation steps.  On WSL each tmuxExecAsync spawns
    // a wsl.exe process (~150-300ms), so parallelising saves 1-2 round trips.
    const postCreateTasks: Promise<unknown>[] = [
      tmuxExecAsync(
        tmuxTarget,
        "set-environment", "-t", name,
        "COLLAB_PTY_SESSION_ID", sessionId,
      ),
      ensureTmuxSessionAppearance(tmuxTarget, name),
    ];
    if (!(process.platform === "win32" && tmuxTarget.startsWith("wsl:"))) {
      postCreateTasks.push(
        tmuxExecAsync(
          tmuxTarget,
          "set-environment", "-t", name,
          "SHELL", shell,
        ),
      );
    }
    try {
      await Promise.all(postCreateTasks);
    } catch {
      // Under WSL, the tmux server may not have registered the session yet
      // when terminals are created in rapid succession.  The terminal will
      // still work — these env vars / appearance tweaks are nice-to-have.
    }
    lap("post-create tasks done (set-env ‖ appearance)");

    attachClient(sessionId, c, r, senderWebContentsId, tmuxTarget);
    lap("attachClient done");
    const _owner = getEffectiveSender(senderWebContentsId) ?? senderWebContentsId;
    if (_owner != null) sessionOwners.set(sessionId, _owner);

    writeSessionMeta(
      sessionId,
      resolvedTargetMeta(
        resolvedTarget,
        "tmux",
        new Date().toISOString(),
      ),
    );
    lap("createSession complete");

    const session = sessions.get(sessionId)!;
    session.shell = shell;
    session.displayName = resolvedTarget.displayName;
    session.target = resolvedTarget.target;
    session.command = resolvedTarget.command;
    if (_owner != null) session.ownerWebContentsId = _owner;
    session.args = resolvedTarget.args;
    session.cwdHostPath = resolvedTarget.cwdHostPath;
    session.cwdGuestPath = resolvedTarget.cwdGuestPath;

    return {
      sessionId,
      shell,
      displayName: resolvedTarget.displayName,
      ...resolvedTargetFields(resolvedTarget),
    };
  }

  if (backend === "direct") {
    const sessionId = crypto.randomBytes(8).toString("hex");
    const session = createDirectSession(
      sessionId,
      resolvedTarget,
      c,
      r,
      senderWebContentsId,
    );

    const _owner = getEffectiveSender(senderWebContentsId) ?? senderWebContentsId;
    if (_owner != null) sessionOwners.set(sessionId, _owner);

    writeSessionMeta(
      sessionId,
      resolvedTargetMeta(
        resolvedTarget,
        "direct",
        session.createdAt || new Date().toISOString(),
      ),
    );

    return {
      sessionId,
      shell: resolvedTarget.command,
      displayName: resolvedTarget.displayName,
      ...resolvedTargetFields(resolvedTarget),
    };
  }

  await ensureSidecar();
  const client = getSidecarClient();
  const sidecarEnv = utf8Env();
  if (tileId) sidecarEnv.COLLAB_TILE_ID = tileId;
  const createParams = withOptionalFields({
    command: resolvedTarget.command,
    args: resolvedTarget.args,
    shell: resolvedTarget.command,
    displayName: resolvedTarget.displayName,
    target: resolvedTarget.target,
    cwd: resolvedTarget.cwd,
    cwdHostPath: resolvedTarget.cwdHostPath,
    cols: c,
    rows: r,
    env: sidecarEnv,
  }, {
    cwdGuestPath: resolvedTarget.cwdGuestPath,
  });
  const { sessionId, socketPath } = await client.createSession(createParams);

  const effectiveSidecarSender = getEffectiveSender(senderWebContentsId);
  const dataSock = await client.attachDataSocket(
    socketPath,
    (data) => {
      sendToSender(effectiveSidecarSender, "pty:data", {
        sessionId,
        data,
      });
      scheduleForegroundCheck(sessionId);
    },
  );
  dataSockets.set(sessionId, dataSock);

  writeSessionMeta(
    sessionId,
    resolvedTargetMeta(
      resolvedTarget,
      "sidecar",
      new Date().toISOString(),
    ),
  );

  sidecarSessionIds.add(sessionId);
  const _owner = getEffectiveSender(senderWebContentsId) ?? senderWebContentsId;
  if (_owner != null) sessionOwners.set(sessionId, _owner);
  return {
    sessionId,
    shell: resolvedTarget.command,
    displayName: resolvedTarget.displayName,
    ...resolvedTargetFields(resolvedTarget),
  };
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
  rawCols: number,
  rawRows: number,
  senderWebContentsId: number,
): Promise<{
  sessionId: string;
  shell: string;
  displayName: string;
  target?: string;
  command?: string;
  args?: string[];
  cwdHostPath?: string;
  cwdGuestPath?: string;
  meta: SessionMeta | null;
  scrollback: string;
  mode: "tmux" | "sidecar" | "direct";
}> {
  // Route based on the backend that originally created this session.
  // Sessions without a backend field are legacy tmux sessions.
  const [cols, rows] = clampDims(rawCols, rawRows);
  const meta = readSessionMeta(sessionId);
  const backend = sessionBackend(sessionId);

  if (backend === "direct") {
    const session = sessions.get(sessionId);
    if (!session) {
      deleteSessionMeta(sessionId);
      throw new Error(`Direct session ${sessionId} not found`);
    }

    try {
      session.pty.resize(cols, rows);
    } catch {
      // pty already exited — ignore resize
    }

    const owner = getEffectiveSender(senderWebContentsId) ?? senderWebContentsId;
    if (owner != null) sessionOwners.set(sessionId, owner);

    return withOptionalFields({
      sessionId,
      shell: session.command || session.shell,
      displayName: session.displayName,
      meta,
      scrollback: stripTrailingBlanks(
        session.ringBuffer?.snapshot().toString("utf8") ?? "",
      ),
      mode: "direct",
    }, {
      target: session.target ?? meta?.target,
      command: session.command ?? meta?.command,
      args: session.args ?? meta?.args,
      cwdHostPath: session.cwdHostPath ?? meta?.cwdHostPath ?? meta?.cwd,
      cwdGuestPath: session.cwdGuestPath ?? meta?.cwdGuestPath,
    });
  }

  if (backend === "sidecar") {
    await ensureSidecar();
    const client = getSidecarClient();
    const { socketPath } = await client.reconnectSession(
      sessionId, cols, rows,
    );

    const effectiveReconnectSender = getEffectiveSender(senderWebContentsId);
    const dataSock = await client.attachDataSocket(
      socketPath,
      (data) => {
        sendToSender(effectiveReconnectSender, "pty:data", {
          sessionId,
          data,
        });
        scheduleForegroundCheck(sessionId);
      },
    );

    dataSockets.get(sessionId)?.destroy();
    dataSockets.set(sessionId, dataSock);

    const shell = meta?.command || meta?.shell || process.env.SHELL || "/bin/zsh";
    const displayName = meta?.displayName || displayBasename(shell) || "shell";
    sidecarSessionIds.add(sessionId);
    const owner = getEffectiveSender(senderWebContentsId) ?? senderWebContentsId;
    if (owner != null) sessionOwners.set(sessionId, owner);

    return withOptionalFields({
      sessionId,
      shell,
      displayName,
      meta,
      scrollback: "",
      mode: "sidecar",
    }, {
      target: meta?.target,
      command: meta?.command,
      args: meta?.args,
      cwdHostPath: meta?.cwdHostPath ?? meta?.cwd,
      cwdGuestPath: meta?.cwdGuestPath,
    });
  }

  const name = tmuxSessionName(sessionId);
  const target = tmuxTargetForSession(sessionId);

  try {
    await tmuxExecAsync(target, "has-session", "-t", name);
  } catch {
    deleteSessionMeta(sessionId);
    throw new Error(`tmux session ${name} not found`);
  }

  let scrollback = "";
  try {
    const raw = await tmuxExecAsync(
      target,
      "capture-pane", "-t", name,
      "-p", "-e", "-S", "-200000",
    );
    scrollback = stripTrailingBlanks(raw);
  } catch {
    // Proceed without scrollback
  }

  // Run appearance setup and resize in parallel — both are independent
  // post-reconnect steps. attachClient is synchronous (spawns the pty).
  const reconnectTasks: Promise<unknown>[] = [
    ensureTmuxSessionAppearance(target, name),
    tmuxExecAsync(
      target,
      "resize-window", "-t", name,
      "-x", String(cols), "-y", String(rows),
    ).catch(() => { /* non-fatal */ }),
  ];
  attachClient(sessionId, cols, rows, senderWebContentsId, target);
  const owner = getEffectiveSender(senderWebContentsId) ?? senderWebContentsId;
  if (owner != null) sessionOwners.set(sessionId, owner);
  await Promise.all(reconnectTasks);

  const session = sessions.get(sessionId)!;
  session.shell =
    meta?.shell || process.env.SHELL || "/bin/zsh";
  session.displayName =
    meta?.displayName || displayBasename(session.shell) || "shell";

  return withOptionalFields({
    sessionId,
    shell: session.shell,
    displayName: session.displayName,
    meta,
    scrollback,
    mode: "tmux",
  }, {
    target: meta?.target,
    command: meta?.command,
    args: meta?.args,
    cwdHostPath: meta?.cwdHostPath ?? meta?.cwd,
    cwdGuestPath: meta?.cwdGuestPath,
  });
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
  if (sessionBackend(sessionId) !== "tmux") {
    writeToSession(sessionId, data);
    return;
  }
  const name = tmuxSessionName(sessionId);
  tmuxExecForTarget(tmuxTargetForSession(sessionId), "send-keys", "-l", "-t", name, data);
}

/**
 * Pending tmux resize timers keyed by sessionId.  During rapid resize events
 * (e.g. tile drag) we debounce the tmux resize-window call to avoid spawning
 * dozens of wsl.exe processes that each block for hundreds of ms.  The PTY
 * itself is resized immediately — only the tmux bookkeeping is debounced.
 */
const tmuxResizeTimers = new Map<string, ReturnType<typeof setTimeout>>();
const TMUX_RESIZE_DEBOUNCE_MS = 150;

export async function resizeSession(
  sessionId: string,
  rawCols: number,
  rawRows: number,
): Promise<void> {
  const [cols, rows] = clampDims(rawCols, rawRows);
  const backend = sessionBackend(sessionId);
  if (backend === "sidecar") {
    try {
      await ensureSidecar();
      const client = getSidecarClient();
      await client.resizeSession(sessionId, cols, rows);
    } catch {
      // Restored renderer tabs can emit an initial resize before the
      // sidecar client is connected, or after the session is already gone.
      // Treat that startup race as non-fatal.
    }
    return;
  }

  const session = sessions.get(sessionId);
  if (!session) return;
  try {
    session.pty.resize(cols, rows);
  } catch {
    // The pty may have exited between the session lookup and the resize call.
    // node-pty throws if the pty is already dead — silently ignore.
    sessions.delete(sessionId);
    return;
  }

  if (backend === "tmux") {
    // Debounce the tmux resize-window call and run it async so it never
    // blocks the main process.
    const prev = tmuxResizeTimers.get(sessionId);
    if (prev) clearTimeout(prev);
    tmuxResizeTimers.set(
      sessionId,
      setTimeout(() => {
        tmuxResizeTimers.delete(sessionId);
        const name = tmuxSessionName(sessionId);
        tmuxExecAsync(
          tmuxTargetForSession(sessionId),
          "resize-window", "-t", name,
          "-x", String(cols), "-y", String(rows),
        ).catch(() => {
          // Non-fatal
        });
      }, TMUX_RESIZE_DEBOUNCE_MS),
    );
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
    sessionOwners.delete(sessionId);
    deleteSessionMeta(sessionId);
    return;
  }

  const session = sessions.get(sessionId);
  if (session) {
    for (const d of session.disposables) d.dispose();
    session.pty.kill();
    sessions.delete(sessionId);
  }

  if (backend === "tmux") {
    const name = tmuxSessionName(sessionId);
    try {
      await tmuxExecAsync(tmuxTargetForSession(sessionId), "kill-session", "-t", name);
    } catch {
      // Session may already be dead
    }
  }

  deleteSessionMeta(sessionId);
  sessionOwners.delete(sessionId);
}

export function listSessions(): string[] {
  return [...new Set([...sessions.keys(), ...sidecarSessionIds])];
}

export function killAll(): void {
  shuttingDown = true;
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
  sessionOwners.clear();
}

const KILL_ALL_TIMEOUT_MS = 2000;

export function killAllAndWait(): Promise<void> {
  shuttingDown = true;
  if (sessions.size === 0) {
    sessionOwners.clear();
    return Promise.resolve();
  }

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
  sessionOwners.clear();

  const timeout = new Promise<void>((resolve) =>
    setTimeout(resolve, KILL_ALL_TIMEOUT_MS),
  );

  return Promise.race([
    Promise.all(pending).then(() => {}),
    timeout,
  ]);
}

export function destroyAll(): void {
  const tmuxTargets = [...new Set(
    [...sessions.values()]
      .filter((session) => session.backend === "tmux")
      .map((session) => tmuxTargetKey(
        typeof session.target === "string"
          ? session.target as TerminalTarget
          : undefined,
      )),
  )].map((key) => key === "" ? undefined : key as TerminalTarget);
  killAll();
  for (const target of tmuxTargets) {
    try {
      tmuxExecForTarget(target, "kill-server");
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
  const result: DiscoveredSession[] = [];

  if (currentSessionBackend() === "sidecar") {
    try {
      await ensureSidecar();
      const client = getSidecarClient();
      const list = await client.listSessions();
      result.push(...list.map((s) => ({
        sessionId: s.sessionId,
        meta: withOptionalFields({
          shell: s.shell,
          cwd: s.cwdHostPath,
          createdAt: s.createdAt,
          backend: "sidecar",
          target: s.target,
          displayName: s.displayName,
          command: s.shell,
          cwdHostPath: s.cwdHostPath,
        }, {
          cwdGuestPath: s.cwdGuestPath,
        }) as SessionMeta,
      })));
    } catch {
      // Sidecar is not running; continue with any direct or legacy tmux sessions.
    }
  }

  for (const [sessionId, session] of sessions) {
    if (session.backend !== "direct") continue;
    result.push({
      sessionId,
      meta: withOptionalFields({
        shell: session.command || session.shell,
        cwd: session.cwdHostPath!,
        createdAt: session.createdAt!,
        backend: "direct",
        target: session.target,
        displayName: session.displayName,
        command: session.command,
        args: session.args,
        cwdHostPath: session.cwdHostPath,
      }, {
        cwdGuestPath: session.cwdGuestPath,
      }) as SessionMeta,
    });
  }

  let metaFiles: string[];
  try {
    metaFiles = fs
      .readdirSync(SESSION_DIR)
      .filter((f) => f.endsWith(".json"));
  } catch {
    metaFiles = [];
  }

  const tmuxSets = new Map<string, Set<string>>();
  for (const target of listKnownTmuxTargets(metaFiles)) {
    try {
      const raw = tmuxExecForTarget(
        target,
        "list-sessions",
        "-F",
        "#{session_name}",
      );
      tmuxSets.set(
        tmuxTargetKey(target),
        new Set(raw.split("\n").filter(Boolean)),
      );
    } catch {
      tmuxSets.set(tmuxTargetKey(target), new Set());
    }
  }

  for (const file of metaFiles) {
    const sessionId = file.replace(".json", "");
    const meta = readSessionMeta(sessionId);

    // Skip metadata from a different backend — it belongs to a
    // non-tmux session and must not be matched against tmux state.
    if (meta?.backend === "sidecar") continue;
    if (meta?.backend === "direct") {
      if (!sessions.has(sessionId)) {
        deleteSessionMeta(sessionId);
      }
      continue;
    }

    const target = typeof meta?.target === "string"
      ? meta.target as TerminalTarget
      : undefined;
    const tmuxSet = tmuxSets.get(tmuxTargetKey(target)) ?? new Set<string>();
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

  for (const [key, tmuxSet] of tmuxSets) {
    const target = key === "" ? undefined : key as TerminalTarget;
    for (const orphan of tmuxSet) {
      if (!orphan.startsWith("collab-")) continue;
      try {
        tmuxExecForTarget(target, "kill-session", "-t", orphan);
      } catch {
        // Already dead
      }
    }
  }

  return result;
}

export async function captureSession(
  sessionId: string,
  lines = 50,
): Promise<string> {
  const backend = sessionBackend(sessionId);

  if (backend === "sidecar") {
    try {
      const client = getSidecarClient();
      return await client.captureSession(sessionId, lines);
    } catch {
      return "";
    }
  }

  const name = tmuxSessionName(sessionId);
  try {
    const raw = tmuxExec(
      "capture-pane", "-t", name,
      "-p", "-S", `-${lines}`,
    );
    return stripTrailingBlanks(raw);
  } catch {
    return "";
  }
}

function getDirectForegroundProcess(session: PtySession): string | null {
  if (process.platform === "win32") {
    const fallback = session.target?.startsWith("wsl:")
      ? session.displayName
      : displayBasename(session.command || session.shell) || session.displayName;
    try {
      const { execFileSync } = require("node:child_process");
      const output = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          [
            `$children = Get-CimInstance Win32_Process -Filter "ParentProcessId = ${session.pty.pid}" | Sort-Object ProcessId;`,
            "if ($children.Count -gt 0) {",
            "  $children[-1].Name",
            "}",
          ].join(" "),
        ],
        { encoding: "utf8", timeout: 2000, windowsHide: true },
      ).trim();
      return output ? displayBasename(output) || output : fallback;
    } catch {
      return fallback;
    }
  }

  try {
    const { execFileSync } = require("node:child_process");
    const out = execFileSync(
      "ps",
      ["-o", "pid=,comm=", "-g", String(session.pty.pid)],
      { encoding: "utf8", timeout: 2000 },
    ).trim();
    const lines = out.split("\n").filter(Boolean);
    const last = lines[lines.length - 1]?.trim();
    return last
      ? displayBasename(last.replace(/^\d+\s+/, "")) || last
      : session.displayName;
  } catch {
    return session.displayName;
  }
}


export async function getForegroundProcess(
  sessionId: string,
): Promise<string | null> {
  const backend = sessionBackend(sessionId);
  if (backend === "sidecar") {
    try {
      const client = getSidecarClient();
      return await client.getForeground(sessionId);
    } catch {
      return null;
    }
  }

  if (backend === "direct") {
    const session = sessions.get(sessionId);
    return session ? getDirectForegroundProcess(session) : null;
  }

  const name = tmuxSessionName(sessionId);
  try {
    return tmuxExecForTarget(
      tmuxTargetForSession(sessionId),
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
  try {
    const { BrowserWindow } = require("electron");
    const wins = BrowserWindow.getAllWindows();
    for (const win of wins) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    }
  } catch {
    // Electron not available (e.g. during tests)
  }
}

export function scheduleForegroundCheck(sessionId: string): void {
  const existing = statusTimers.get(sessionId);
  if (existing) clearTimeout(existing);

  statusTimers.set(
    sessionId,
    setTimeout(() => {
      statusTimers.delete(sessionId);
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

function getAttachedSessionNames(
  target?: TerminalTarget,
): Set<string> {
  try {
    const raw = tmuxExecForTarget(
      target,
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
  const active = new Set(activeSessionIds);
  const attachedByTarget = new Map<string, Set<string>>();
  const discovered = await discoverSessions();

  for (const { sessionId, meta } of discovered) {
    if (active.has(sessionId)) continue;
    if ((meta.backend ?? "tmux") === "tmux") {
      const target = typeof meta.target === "string"
        ? meta.target as TerminalTarget
        : undefined;
      const key = tmuxTargetKey(target);
      if (!attachedByTarget.has(key)) {
        attachedByTarget.set(key, getAttachedSessionNames(target));
      }
      if (attachedByTarget.get(key)?.has(tmuxSessionName(sessionId))) {
        continue;
      }
    }
    await killSession(sessionId);
  }
}

export function verifyTmuxAvailable(): { ok: true } | { ok: false; message: string } {
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
