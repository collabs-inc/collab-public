// src/main/sidecar/client.test.ts
//
// Integration tests for SidecarClient against a real SidecarServer.
// Must run with node (not bun) because node-pty requires node's libuv.
//
// Run: cd collab-electron && npx tsx --test src/main/sidecar/client.test.ts

import { describe, it, afterEach } from "node:test";
import * as assert from "node:assert/strict";
import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SidecarServer } from "./server";
import { SidecarClient } from "./client";
import { SIDECAR_VERSION } from "./protocol";

// Short temp dir to stay under macOS 104-byte sun_path limit
const TEST_DIR = path.join(os.tmpdir(), `cc-${process.pid}`);
const CONTROL_SOCK = process.platform === "win32"
  ? `\\\\.\\pipe\\cc-${process.pid}-ctrl`
  : path.join(TEST_DIR, "ctrl.sock");
const SESSION_DIR = path.join(TEST_DIR, "s");
const PID_PATH = path.join(TEST_DIR, "pid");
const TOKEN = "client-test-token";
const TEST_CWD = process.platform === "win32" ? os.tmpdir() : "/tmp";
const TEST_SHELL = process.platform === "win32"
  ? {
    command: "powershell.exe",
    args: ["-NoLogo"],
    displayName: "PowerShell",
    target: "powershell",
    echo: (marker: string) => `Write-Output '${marker}'\n`,
    exit: "exit\n",
  }
  : {
    command: "/bin/sh",
    args: [],
    displayName: "sh",
    target: "shell",
    echo: (marker: string) => `echo ${marker}\n`,
    exit: "exit\n",
  };

let server: SidecarServer | null = null;
let client: SidecarClient | null = null;

afterEach(async () => {
  if (client) {
    client.disconnect();
    client = null;
  }
  if (server) {
    await server.shutdown();
    server = null;
  }
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

async function startServer(): Promise<void> {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  server = new SidecarServer({
    controlSocketPath: CONTROL_SOCK,
    sessionSocketDir: SESSION_DIR,
    pidFilePath: PID_PATH,
    token: TOKEN,
    idleTimeoutMs: 0,
  });
  await server.start();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("SidecarClient", () => {
  it("connects and pings", async () => {
    await startServer();
    client = new SidecarClient(CONTROL_SOCK);
    await client.connect();

    const ping = await client.ping();
    assert.equal(ping.version, SIDECAR_VERSION);
    assert.equal(ping.token, TOKEN);
  });

  it("creates session and receives data", async () => {
    await startServer();
    client = new SidecarClient(CONTROL_SOCK);
    await client.connect();

    const { sessionId, socketPath } = await client.createSession({
      command: TEST_SHELL.command,
      args: TEST_SHELL.args,
      displayName: TEST_SHELL.displayName,
      target: TEST_SHELL.target,
      cwdHostPath: TEST_CWD,
      cwd: TEST_CWD,
      cols: 80,
      rows: 24,
    });
    assert.match(sessionId, /^[0-9a-f]{16}$/);

    const chunks: Buffer[] = [];
    const dataSock = await client.attachDataSocket(
      socketPath,
      (data) => chunks.push(data),
    );

    dataSock.write(TEST_SHELL.echo("client-test"));

    // Wait until we see the expected output or timeout
    const deadline = Date.now() + 5000;
    while (
      !Buffer.concat(chunks).toString().includes("client-test")
      && Date.now() < deadline
    ) {
      await sleep(50);
    }

    assert.ok(Buffer.concat(chunks).toString().includes("client-test"));
    dataSock.destroy();
  });

  it("lists sessions", async () => {
    await startServer();
    client = new SidecarClient(CONTROL_SOCK);
    await client.connect();

    await client.createSession({
      command: TEST_SHELL.command,
      args: TEST_SHELL.args,
      displayName: TEST_SHELL.displayName,
      target: TEST_SHELL.target,
      cwdHostPath: TEST_CWD,
      cwd: TEST_CWD,
      cols: 80,
      rows: 24,
    });

    const sessions = await client.listSessions();
    assert.equal(sessions.length, 1);
  });

  it("kills session", async () => {
    await startServer();
    client = new SidecarClient(CONTROL_SOCK);
    await client.connect();

    const { sessionId } = await client.createSession({
      command: TEST_SHELL.command,
      args: TEST_SHELL.args,
      displayName: TEST_SHELL.displayName,
      target: TEST_SHELL.target,
      cwdHostPath: TEST_CWD,
      cwd: TEST_CWD,
      cols: 80,
      rows: 24,
    });

    await client.killSession(sessionId);

    const sessions = await client.listSessions();
    assert.equal(sessions.length, 0);
  });

  it("RPC timeout when server goes away", async () => {
    await startServer();
    client = new SidecarClient(CONTROL_SOCK);
    await client.connect();

    // Shut down the server abruptly by destroying all control sockets
    // and closing the server without sending responses
    await server!.shutdown();
    server = null;

    // The pending RPC should reject with connection-lost or timeout
    await assert.rejects(
      () => client!.ping(),
      (err: Error) => {
        assert.ok(
          err.message.includes("Sidecar connection lost")
          || err.message.includes("RPC timeout")
          || err.message.includes("Not connected"),
          `Unexpected error: ${err.message}`,
        );
        return true;
      },
    );
  });

  it("socket close rejects pending RPCs", async () => {
    await startServer();
    client = new SidecarClient(CONTROL_SOCK);
    await client.connect();

    // Access the client's internal socket and destroy it while
    // an RPC is in flight
    const rpcPromise = client.ping();

    // Destroy the underlying socket to simulate connection loss.
    // The socket is private, so we access it via the object index.
    const sock = (client as unknown as { socket: net.Socket }).socket;
    sock.destroy();

    await assert.rejects(
      () => rpcPromise,
      (err: Error) => {
        assert.ok(
          err.message.includes("Sidecar connection lost"),
          `Expected "Sidecar connection lost", got: ${err.message}`,
        );
        return true;
      },
    );
  });

  it("malformed JSON from server does not crash", async () => {
    // Create a fake server that sends garbage over the control socket
    const fakeSockPath = process.platform === "win32"
      ? `\\\\.\\pipe\\cc-${process.pid}-fake`
      : path.join(TEST_DIR, "fake.sock");
    fs.mkdirSync(TEST_DIR, { recursive: true });

    const fakeServer = net.createServer((conn) => {
      // Send malformed JSON followed by a valid ping response
      conn.on("data", (data) => {
        const line = data.toString().trim();
        let msg: { id?: number; method?: string };
        try {
          msg = JSON.parse(line);
        } catch {
          return;
        }
        // First, send garbage
        conn.write("NOT VALID JSON\n");
        conn.write("{broken\n");
        // Then send a valid response
        if (msg.method === "sidecar.ping") {
          conn.write(JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              pid: process.pid,
              uptime: 0,
              version: SIDECAR_VERSION,
              token: TOKEN,
            },
          }) + "\n");
        }
      });
    });

    await new Promise<void>((resolve) =>
      fakeServer.listen(fakeSockPath, resolve),
    );

    try {
      const fakeClient = new SidecarClient(fakeSockPath);
      await fakeClient.connect();

      // The client should skip the malformed lines and still
      // resolve the valid response
      const result = await fakeClient.ping();
      assert.equal(result.version, SIDECAR_VERSION);
      fakeClient.disconnect();
    } finally {
      await new Promise<void>((resolve) =>
        fakeServer.close(() => resolve()),
      );
    }
  });

  it("reconnects session and receives scrollback", async () => {
    await startServer();
    client = new SidecarClient(CONTROL_SOCK);
    await client.connect();

    const { sessionId, socketPath } = await client.createSession({
      command: TEST_SHELL.command,
      args: TEST_SHELL.args,
      displayName: TEST_SHELL.displayName,
      target: TEST_SHELL.target,
      cwdHostPath: TEST_CWD,
      cwd: TEST_CWD,
      cols: 80,
      rows: 24,
    });

    // Attach and write a marker
    const chunks1: Buffer[] = [];
    const dataSock1 = await client.attachDataSocket(
      socketPath,
      (data) => chunks1.push(data),
    );
    dataSock1.write(TEST_SHELL.echo("RECONNECT_MARKER"));

    const deadline1 = Date.now() + 5000;
    while (
      !Buffer.concat(chunks1).toString().includes("RECONNECT_MARKER")
      && Date.now() < deadline1
    ) {
      await sleep(50);
    }
    assert.ok(Buffer.concat(chunks1).toString().includes("RECONNECT_MARKER"));

    // Disconnect the data socket
    dataSock1.destroy();
    await sleep(100);

    // Reconnect the session
    const reconnResult = await client.reconnectSession(
      sessionId, 80, 24,
    );
    assert.equal(reconnResult.sessionId, sessionId);

    // Attach a new data socket — it should receive the scrollback
    const chunks2: Buffer[] = [];
    const dataSock2 = await client.attachDataSocket(
      reconnResult.socketPath,
      (data) => chunks2.push(data),
    );

    const deadline2 = Date.now() + 5000;
    while (
      !Buffer.concat(chunks2).toString().includes("RECONNECT_MARKER")
      && Date.now() < deadline2
    ) {
      await sleep(50);
    }

    assert.ok(
      Buffer.concat(chunks2).toString().includes("RECONNECT_MARKER"),
      "Scrollback should contain the marker from before disconnect",
    );
    dataSock2.destroy();
  });

  it("notification handler receives session.exited", async () => {
    await startServer();
    client = new SidecarClient(CONTROL_SOCK);
    await client.connect();

    const { sessionId, socketPath } = await client.createSession({
      command: TEST_SHELL.command,
      args: TEST_SHELL.args,
      displayName: TEST_SHELL.displayName,
      target: TEST_SHELL.target,
      cwdHostPath: TEST_CWD,
      cwd: TEST_CWD,
      cols: 80,
      rows: 24,
    });

    // Register notification handler before triggering exit
    const notifications: { method: string; params: Record<string, unknown> }[] = [];
    client.onNotification((method, params) => {
      notifications.push({ method, params });
    });

    // Attach data socket and send exit to terminate the shell
    const dataSock = await client.attachDataSocket(
      socketPath,
      () => {},
    );
    dataSock.write(TEST_SHELL.exit);

    // Wait for the notification
    const deadline = Date.now() + 5000;
    while (
      !notifications.some((n) => n.method === "session.exited")
      && Date.now() < deadline
    ) {
      await sleep(50);
    }

    const exitNotif = notifications.find(
      (n) => n.method === "session.exited",
    );
    assert.ok(exitNotif, "Should receive session.exited notification");
    assert.equal(exitNotif!.params.sessionId, sessionId);
    assert.equal(typeof exitNotif!.params.exitCode, "number");
    dataSock.destroy();
  });
});
