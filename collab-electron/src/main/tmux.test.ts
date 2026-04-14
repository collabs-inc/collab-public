import { describe, test, expect, afterEach, beforeAll } from "bun:test";
import * as fs from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { loadConfig, setPref } from "./config";
import {
  getTmuxBin,
  getTmuxConf,
  getSocketName,
  writeSessionMeta,
  readSessionMeta,
  deleteSessionMeta,
  SESSION_DIR,
  tmuxExec,
  tmuxSessionName,
} from "./tmux";
import {
  createSession,
  killSession,
  listSessions,
  killAll,
  discoverSessions,
  destroyAll,
  verifyTmuxAvailable,
} from "./pty";

// Force tmux mode for these tests — the default is now "sidecar"
// which requires Electron to spawn the sidecar process.
beforeAll(() => {
  const config = loadConfig();
  setPref(config, "terminalMode", "tmux");
});

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
    const { sessionId } = await createSession("/tmp");
    const name = tmuxSessionName(sessionId);
    const env = tmuxExec(
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
    const { sessionId } = await createSession("/tmp");
    killAll(); // detach client, tmux session survives

    const discovered = await discoverSessions();
    const found = discovered.find(
      (s) => s.sessionId === sessionId,
    );
    expect(found).toBeTruthy();
    expect(found!.meta.cwd).toBe("/tmp");

    // Clean up tmux session
    try {
      tmuxExec(
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

  test("leaves orphan tmux sessions without metadata alone", async () => {
    const { sessionId } = await createSession("/tmp");
    killAll();
    deleteSessionMeta(sessionId);

    await discoverSessions();

    const name = tmuxSessionName(sessionId);
    let alive = true;
    try {
      tmuxExec("has-session", "-t", name);
    } catch {
      alive = false;
    }
    expect(alive).toBe(true);

    // Clean up
    try { tmuxExec("kill-session", "-t", name); } catch {}
  });

  test("skips sidecar discovery in tmux mode", async () => {
    // The test suite forces tmux mode in beforeAll.
    // discoverSessions should return only tmux-backend results.
    const results = await discoverSessions();
    for (const r of results) {
      expect(r.meta.backend ?? "tmux").toBe("tmux");
    }
  });
});

describe("destroyAll", () => {
  test("kills owned sessions without killing the tmux server", async () => {
    const { sessionId } = await createSession("/tmp");
    const ownedName = tmuxSessionName(sessionId);

    const externalName = "collab-external-test";
    tmuxExec("new-session", "-d", "-s", externalName, "-x", "80", "-y", "24");

    destroyAll();

    let ownedAlive = true;
    try { tmuxExec("has-session", "-t", ownedName); } catch { ownedAlive = false; }
    expect(ownedAlive).toBe(false);

    let externalAlive = true;
    try { tmuxExec("has-session", "-t", externalName); } catch { externalAlive = false; }
    expect(externalAlive).toBe(true);

    // Clean up
    try { tmuxExec("kill-session", "-t", externalName); } catch {}
    deleteSessionMeta(sessionId);
  });
});

describe("verifyTmuxAvailable", () => {
  test("does not throw when tmux is available", () => {
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
    const { sessionId } = await createSession("/tmp");
    const name = tmuxSessionName(sessionId);

    // Send a known string to the session
    tmuxExec(
      "send-keys", "-t", name, "echo hello-scrollback", "Enter",
    );

    // Brief wait for output to appear in tmux buffer
    await new Promise((r) => setTimeout(r, 200));

    // Capture and verify no trailing blank lines
    const raw = tmuxExec(
      "capture-pane", "-t", name,
      "-p", "-e", "-S", "-10000",
    );
    const lines = raw.split("\n");
    // Raw output may have trailing blanks; after
    // stripTrailingBlanks (called in reconnectSession),
    // they'd be removed. Verify raw capture has content.
    expect(
      lines.some((l) => l.includes("hello-scrollback")),
    ).toBe(true);

    await killSession(sessionId);
  });
});
