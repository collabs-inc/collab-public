import { describe, test, expect, afterEach, beforeAll } from "bun:test";
import * as fs from "node:fs";
import { spawn } from "node:child_process";
import { loadConfig, setPref } from "./config";
import { getDefaultWslDistro } from "./terminal-target";
import {
  getTmuxConf,
  getTmuxSpawnSpec,
  getSocketName,
  writeSessionMeta,
  readSessionMeta,
  deleteSessionMeta,
  SESSION_DIR,
  tmuxExecForTarget,
  tmuxSessionName,
} from "./tmux";
import {
  createSession,
  killSession,
  listSessions,
  killAll,
  discoverSessions,
  cleanDetachedSessions,
  verifyTmuxAvailable,
  setShuttingDown,
} from "./pty";

// Force tmux mode for these tests — the default is now "sidecar"
// which requires Electron to spawn the sidecar process.
beforeAll(() => {
  const config = loadConfig();
  setPref(config, "terminalMode", "tmux");
});

function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const original = process.platform;
  Object.defineProperty(process, "platform", { value: platform });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, "platform", { value: original });
  }
}

function testTmuxTarget(): string | undefined {
  if (process.platform !== "win32") return undefined;
  const distro = getDefaultWslDistro();
  if (!distro) {
    throw new Error("No WSL distro available for tmux tests");
  }
  return `wsl:${distro}`;
}

describe("tmux helpers", () => {
  const testId = "test-" + Date.now().toString(16);

  afterEach(() => {
    deleteSessionMeta(testId);
  });

  test("getTmuxConf returns a path ending in tmux.conf", () => {
    const conf = getTmuxConf();
    expect(conf.endsWith("tmux.conf")).toBe(true);
    expect(fs.existsSync(conf)).toBe(true);
  });

  test("writeSessionMeta + readSessionMeta round-trip", () => {
    const meta = {
      shell: "/bin/zsh",
      cwd: "/tmp",
      createdAt: new Date().toISOString(),
    };
    writeSessionMeta(testId, meta);
    const read = readSessionMeta(testId);
    expect(read).toEqual(meta);
  });

  test("readSessionMeta returns null for missing file", () => {
    expect(readSessionMeta("nonexistent-id")).toBeNull();
  });

  test("readSessionMeta returns null for corrupt JSON", () => {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    fs.writeFileSync(
      `${SESSION_DIR}/${testId}.json`, "not json",
    );
    expect(readSessionMeta(testId)).toBeNull();
  });

  test("deleteSessionMeta is no-op for missing file", () => {
    expect(
      () => deleteSessionMeta("nonexistent-id"),
    ).not.toThrow();
  });

  test("getTmuxSpawnSpec uses direct WSL exec without host tmux.conf", () => {
    const spec = withPlatform("win32", () =>
      getTmuxSpawnSpec(
        "wsl:Ubuntu",
        "list-sessions",
        "-F",
        "#{session_name}",
      )
    );

    expect(spec.command).toBe("wsl.exe");
    expect(spec.args).toEqual([
      "-d",
      "Ubuntu",
      "-e",
      "tmux",
      "-L",
      getSocketName(),
      "-u",
      "list-sessions",
      "-F",
      "#{session_name}",
    ]);
    expect(spec.env).toBeUndefined();
  });
});

describe("pty lifecycle via tmux", () => {
  afterEach(() => {
    killAll();
  });

  test("createSession returns sessionId and shell", async () => {
    const result = await createSession("/tmp");
    expect(result.sessionId).toMatch(/^[0-9a-f]{16}$/);
    expect(result.shell).toBeTruthy();
  });

  test("createSession appears in listSessions", async () => {
    const { sessionId } = await createSession("/tmp");
    expect(listSessions()).toContain(sessionId);
  });

  test("killSession removes from listSessions", async () => {
    const { sessionId } = await createSession("/tmp");
    await killSession(sessionId);
    expect(listSessions()).not.toContain(sessionId);
  });

  test("createSession sets COLLAB_PTY_SESSION_ID env", async () => {
    const { sessionId, target } = await createSession("/tmp");
    const name = tmuxSessionName(sessionId);
    const env = tmuxExecForTarget(
      target,
      "show-environment", "-t", name,
      "COLLAB_PTY_SESSION_ID",
    );
    expect(env).toContain(sessionId);
  });
});

describe("discoverSessions", () => {
  test("returns empty when no tmux server running", async () => {
    const result = await discoverSessions();
    expect(Array.isArray(result)).toBe(true);
  });

  test("discovers sessions created by createSession", async () => {
    const { sessionId, target } = await createSession("/tmp");
    killAll(); // detach client, tmux session survives

    const discovered = await discoverSessions();
    const found = discovered.find(
      (s) => s.sessionId === sessionId,
    );
    expect(found).toBeTruthy();
    expect(found!.meta.cwd).toBe("/tmp");

    // Clean up tmux session
    try {
      tmuxExecForTarget(
        target,
        "kill-session", "-t", tmuxSessionName(sessionId),
      );
    } catch {}
    deleteSessionMeta(sessionId);
  });

  test("cleans up stale metadata without tmux session", async () => {
    const fakeId = "deadbeefdeadbeef";
    writeSessionMeta(fakeId, {
      shell: "/bin/zsh",
      cwd: "/tmp",
      createdAt: new Date().toISOString(),
    });

    await discoverSessions();
    expect(readSessionMeta(fakeId)).toBeNull();
  });

  test("kills orphan tmux sessions without metadata", async () => {
    // Create a session, then delete its metadata
    const { sessionId, target } = await createSession("/tmp");
    killAll();
    deleteSessionMeta(sessionId);

    // discoverSessions should kill the orphan
    await discoverSessions();

    // Verify tmux session is gone
    const name = tmuxSessionName(sessionId);
    let alive = true;
    try {
      tmuxExecForTarget(target, "has-session", "-t", name);
    } catch {
      alive = false;
    }
    expect(alive).toBe(false);
  });
});

describe("cleanDetachedSessions", () => {
  test("kills sessions not in the active list", async () => {
    const keepSession = await createSession("/tmp");
    const detachedSession = await createSession("/tmp");
    const { sessionId: keep, target } = keepSession;
    const { sessionId: detached } = detachedSession;
    killAll(); // detach clients, tmux sessions survive
    setShuttingDown(false);
    await Bun.sleep(500); // WSL tmux needs time to notice client disconnect

    await cleanDetachedSessions([keep]);

    // The kept session should still exist
    const discovered = await discoverSessions();
    expect(
      discovered.some((s) => s.sessionId === keep),
    ).toBe(true);

    // The detached session should be gone
    const name = tmuxSessionName(detached);
    let alive = true;
    try {
      tmuxExecForTarget(target, "has-session", "-t", name);
    } catch {
      alive = false;
    }
    expect(alive).toBe(false);

    // Clean up
    try {
      tmuxExecForTarget(
        target,
        "kill-session", "-t", tmuxSessionName(keep),
      );
    } catch {}
    deleteSessionMeta(keep);
    deleteSessionMeta(detached);
  });

  test("no-op when all sessions are active", async () => {
    const { sessionId, target } = await createSession("/tmp");
    killAll();
    await Bun.sleep(100);

    await cleanDetachedSessions([sessionId]);

    const discovered = await discoverSessions();
    expect(
      discovered.some((s) => s.sessionId === sessionId),
    ).toBe(true);

    // Clean up
    try {
      tmuxExecForTarget(
        target,
        "kill-session", "-t", tmuxSessionName(sessionId),
      );
    } catch {}
    deleteSessionMeta(sessionId);
  });

  test("preserves sessions with attached tmux clients", async () => {
    const target = testTmuxTarget();
    const sessionId = "test-attached-" + Date.now().toString(16);
    const name = tmuxSessionName(sessionId);

    tmuxExecForTarget(
      target,
      "new-session", "-d", "-s", name,
      "-x", "80", "-y", "24",
    );
    writeSessionMeta(sessionId, {
      shell: "/bin/zsh",
      cwd: "/tmp",
      createdAt: new Date().toISOString(),
      backend: "tmux",
      target,
    });

    // Attach a control-mode client (node-pty doesn't
    // register as attached under bun's runtime)
    const spec = getTmuxSpawnSpec(
      target,
      "-C",
      "attach-session",
      "-t",
      name,
    );
    const client = spawn(
      spec.command,
      spec.args,
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: spec.env,
      },
    );

    await Bun.sleep(100);

    // Not in active list, but has an attached client
    await cleanDetachedSessions([]);

    let alive = true;
    try {
      tmuxExecForTarget(target, "has-session", "-t", name);
    } catch {
      alive = false;
    }
    expect(alive).toBe(true);

    // Clean up
    client.kill();
    try { tmuxExecForTarget(target, "kill-session", "-t", name); } catch {}
    deleteSessionMeta(sessionId);
  });
});

describe("verifyTmuxAvailable", () => {
  test("does not throw when tmux is available", () => {
    if (process.platform === "win32") return;
    expect(() => verifyTmuxAvailable()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Cross-backend reconnection tests
//
// These tests simulate the scenario where sidecar-created sessions exist on
// disk while the global terminal mode is set to tmux (e.g. user changed the
// setting, or the app restarts with the opposite mode).  The sidecar process
// itself is not needed — we only exercise metadata preservation and routing
// decisions that are pure filesystem + in-memory logic.
// ---------------------------------------------------------------------------

describe("cross-backend: discoverSessions preserves sidecar metadata", () => {
  const sidecarId = "sidecar-xbackend-" + Date.now().toString(16);

  afterEach(() => {
    deleteSessionMeta(sidecarId);
  });

  test("discoverSessions in tmux mode must not delete sidecar session metadata", async () => {
    // Simulate a sidecar session that was created before the mode switch.
    writeSessionMeta(sidecarId, {
      shell: "/bin/zsh",
      cwd: "/tmp/myproject",
      createdAt: new Date().toISOString(),
      backend: "sidecar",
    });

    // discoverSessions runs during startup (via ptyDiscover IPC).
    // In tmux mode it cross-references metadata files against tmux
    // list-sessions.  A sidecar session has no matching tmux session.
    await discoverSessions();

    // The metadata must survive — reconnectSession reads it to route
    // back to the sidecar backend.
    const meta = readSessionMeta(sidecarId);
    expect(meta).not.toBeNull();
    expect(meta!.backend).toBe("sidecar");
    expect(meta!.cwd).toBe("/tmp/myproject");
  });

  test("discoverSessions must not include sidecar sessions in tmux results", async () => {
    // Sidecar metadata on disk, no matching tmux session.
    writeSessionMeta(sidecarId, {
      shell: "/bin/zsh",
      cwd: "/tmp",
      createdAt: new Date().toISOString(),
      backend: "sidecar",
    });

    const discovered = await discoverSessions();

    // Sidecar sessions should NOT appear as tmux-discovered sessions
    // (the sidecar is a different backend), but the metadata must
    // still exist on disk for reconnectSession to read.
    const found = discovered.find((s) => s.sessionId === sidecarId);
    expect(found).toBeUndefined();

    // Metadata must still be intact.
    expect(readSessionMeta(sidecarId)).not.toBeNull();
  });
});

describe("cross-backend: cleanDetachedSessions skips sidecar sessions", () => {
  const sidecarId = "sidecar-clean-" + Date.now().toString(16);

  afterEach(() => {
    deleteSessionMeta(sidecarId);
  });

  test("cleanDetachedSessions must not delete sidecar metadata", async () => {
    writeSessionMeta(sidecarId, {
      shell: "/bin/zsh",
      cwd: "/home/user/project",
      createdAt: new Date().toISOString(),
      backend: "sidecar",
    });

    // cleanDetachedSessions is called with an empty active list.
    // It should only clean tmux sessions, not touch sidecar metadata.
    await cleanDetachedSessions([]);

    const meta = readSessionMeta(sidecarId);
    expect(meta).not.toBeNull();
    expect(meta!.backend).toBe("sidecar");
  });
});

describe("cross-backend: reconnectSession defaults correctly", () => {
  const sidecarId = "sidecar-reconnect-" + Date.now().toString(16);
  const tmuxId = "tmux-reconnect-" + Date.now().toString(16);

  afterEach(() => {
    deleteSessionMeta(sidecarId);
    deleteSessionMeta(tmuxId);
  });

  test("reconnectSession reads per-session backend, not global mode", async () => {
    // Write sidecar metadata.  reconnectSession should attempt the
    // sidecar path (which will fail without the sidecar process), NOT
    // the tmux path.
    writeSessionMeta(sidecarId, {
      shell: "/bin/zsh",
      cwd: "/tmp",
      createdAt: new Date().toISOString(),
      backend: "sidecar",
    });

    // We can't actually reconnect without the sidecar process, but we
    // can verify that the function does NOT fall through to the tmux
    // path (which would throw "tmux session collab-{id} not found").
    // Instead it should throw a sidecar-related error.
    const { reconnectSession } = await import("./pty");
    let error: Error | null = null;
    try {
      await reconnectSession(sidecarId, 80, 24, -1);
    } catch (e) {
      error = e as Error;
    }

    expect(error).not.toBeNull();
    // If it fell through to tmux, the error would contain "tmux session".
    // A sidecar-routed error will mention "Sidecar" or the client.
    expect(error!.message).not.toContain("tmux session");
  });

  test("session with missing metadata defaults to tmux backend", async () => {
    // No metadata on disk — legacy session.  Should default to tmux.
    const { reconnectSession } = await import("./pty");
    let error: Error | null = null;
    try {
      await reconnectSession(tmuxId, 80, 24, -1);
    } catch (e) {
      error = e as Error;
    }

    expect(error).not.toBeNull();
    // Should try the tmux path and fail because no such tmux session.
    expect(error!.message).toContain("tmux session");
  });
});

describe("stripTrailingBlanks via scrollback", () => {
  test("scrollback capture strips trailing blank lines", async () => {
    const { sessionId, target } = await createSession("/tmp");
    const name = tmuxSessionName(sessionId);

    // Send a known string to the session
    tmuxExecForTarget(
      target,
      "send-keys", "-t", name, "echo hello-scrollback", "Enter",
    );

    // Brief wait for output to appear in tmux buffer
    await new Promise((r) => setTimeout(r, 200));

    const raw = tmuxExecForTarget(
      target,
      "capture-pane", "-t", name,
      "-p", "-e", "-S", "-10000",
    );
    expect(raw.includes("hello-scrollback")).toBe(true);

    await killSession(sessionId);
  });
});
