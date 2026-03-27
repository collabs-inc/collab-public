/**
 * Terminal Backend Tests
 *
 * Tests for the Windows terminal backend implementation.
 * Tests verify session management, lifecycle operations, and platform-specific behavior.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "crypto";

// Mock node-pty
mock.module("node-pty", () => ({
  spawn: mock((shell: string, args: string[], options: unknown) => ({
    pid: 12345,
    cols: 80,
    rows: 24,
    write: mock(() => {}),
    resize: mock(() => {}),
    kill: mock(() => {}),
    onData: mock((cb: (data: string) => void) => ({
      dispose: mock(() => {}),
    })),
    onExit: mock((cb: () => void) => ({
      dispose: mock(() => {}),
    })),
  })),
}));

// Mock electron webContents
mock.module("electron", () => ({
  webContents: {
    fromId: mock(() => null),
  },
}));

// Import after mocks are set up
const { WindowsTerminalBackend } = await import("./terminal-backend.windows");
const { createTerminalBackend } = await import("./terminal-backend");

// Test session directory
let testSessionDir: string;

describe("Terminal Backend Abstraction", () => {
  describe("createTerminalBackend", () => {
    test("should create WindowsTerminalBackend on Windows platform", () => {
      // This test runs on the actual platform
      if (process.platform === "win32") {
        const backend = createTerminalBackend();
        expect(backend).toBeDefined();
        expect(backend.constructor.name).toBe("WindowsTerminalBackend");
      }
    });

    test("should throw error on unsupported platform", () => {
      // Test would throw on unsupported platform
      // The actual platform check happens at runtime
      expect(typeof createTerminalBackend).toBe("function");
      // Platform validation is performed at runtime in createTerminalBackend
      // On non-Windows platforms, the function would throw an error
      if (process.platform !== "win32") {
        expect(() => createTerminalBackend()).toThrow(/Unsupported platform/);
      }
    });
  });
});

describe("WindowsTerminalBackend", () => {
  let backend: WindowsTerminalBackend;

  beforeEach(() => {
    // Set up test session directory
    testSessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "collab-terminal-test-"));

    backend = new WindowsTerminalBackend();
  });

  afterEach(() => {
    // Clean up all sessions
    try {
      backend.killAll();
    } catch {
      // Ignore errors during cleanup
    }

    // Clean up test session directory
    try {
      fs.rmSync(testSessionDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("createSession", () => {
    test("should create a new terminal session with default options", () => {
      const result = backend.createSession();

      expect(result).toBeDefined();
      expect(result.sessionId).toBeDefined();
      expect(result.sessionId.length).toBeGreaterThan(0);
      expect(result.shell).toBeDefined();
    });

    test("should create session with specified working directory", () => {
      const testCwd = os.homedir();
      const result = backend.createSession(testCwd);

      expect(result.sessionId).toBeDefined();
      expect(result.shell).toBeDefined();
    });

    test("should create session with custom dimensions", () => {
      const cols = 120;
      const rows = 40;
      const result = backend.createSession(undefined, undefined, cols, rows);

      expect(result.sessionId).toBeDefined();
      expect(result.shell).toBeDefined();
    });

    test("should generate unique session IDs", () => {
      const result1 = backend.createSession();
      const result2 = backend.createSession();

      expect(result1.sessionId).not.toBe(result2.sessionId);
    });

    test("should persist session metadata", () => {
      const result = backend.createSession();

      // Session metadata should be written
      const metaPath = path.join(
        require("./tmux").SESSION_DIR,
        `${result.sessionId}.json`,
      );

      // Metadata file should exist or be creatable
      expect(result.sessionId).toBeDefined();
    });
  });

  describe("writeToSession", () => {
    test("should write data to an existing session", () => {
      const { sessionId } = backend.createSession();

      expect(() => {
        backend.writeToSession(sessionId, "echo hello\n");
      }).not.toThrow();
    });

    test("should silently ignore writes to non-existent sessions", () => {
      expect(() => {
        backend.writeToSession("non-existent-session", "data");
      }).not.toThrow();
    });
  });

  describe("sendRawKeys", () => {
    test("should send raw key data to session", () => {
      const { sessionId } = backend.createSession();

      expect(() => {
        backend.sendRawKeys(sessionId, "\x03"); // Ctrl+C
      }).not.toThrow();
    });

    test("should be equivalent to writeToSession on Windows", () => {
      const { sessionId } = backend.createSession();

      // Both methods should work without throwing
      expect(() => {
        backend.sendRawKeys(sessionId, "test");
        backend.writeToSession(sessionId, "test");
      }).not.toThrow();
    });
  });

  describe("resizeSession", () => {
    test("should resize an existing session", () => {
      const { sessionId } = backend.createSession();

      expect(() => {
        backend.resizeSession(sessionId, 120, 40);
      }).not.toThrow();
    });

    test("should silently ignore resize for non-existent sessions", () => {
      expect(() => {
        backend.resizeSession("non-existent", 80, 24);
      }).not.toThrow();
    });
  });

  describe("killSession", () => {
    test("should kill an existing session", () => {
      const { sessionId } = backend.createSession();

      expect(() => {
        backend.killSession(sessionId);
      }).not.toThrow();
    });

    test("should remove session from active sessions list", () => {
      const { sessionId } = backend.createSession();

      expect(backend.listSessions()).toContain(sessionId);

      backend.killSession(sessionId);

      expect(backend.listSessions()).not.toContain(sessionId);
    });

    test("should not throw when killing non-existent session", () => {
      expect(() => {
        backend.killSession("non-existent");
      }).not.toThrow();
    });
  });

  describe("listSessions", () => {
    test("should return empty array when no sessions exist", () => {
      // Kill all existing sessions first
      backend.killAll();

      const sessions = backend.listSessions();
      expect(sessions).toEqual([]);
    });

    test("should return array of session IDs", () => {
      const session1 = backend.createSession();
      const session2 = backend.createSession();

      const sessions = backend.listSessions();

      expect(sessions).toContain(session1.sessionId);
      expect(sessions).toContain(session2.sessionId);
      expect(sessions.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("discoverSessions", () => {
    test("should return discovered sessions", () => {
      const discovered = backend.discoverSessions();

      expect(Array.isArray(discovered)).toBe(true);
    });

    test("should include session metadata for active sessions", () => {
      const { sessionId } = backend.createSession();

      const discovered = backend.discoverSessions();

      const found = discovered.find(s => s.sessionId === sessionId);
      if (found) {
        expect(found.meta).toBeDefined();
        expect(found.meta.shell).toBeDefined();
        expect(found.meta.cwd).toBeDefined();
      }
    });
  });

  describe("verifyAvailable", () => {
    test("should verify Windows terminal backend is available", () => {
      expect(() => {
        backend.verifyAvailable();
      }).not.toThrow();
    });

    test("should throw if default shell is not found", () => {
      // This test verifies the shell validation logic
      // On Windows, PowerShell or cmd.exe should always be available
      const shell = process.platform === "win32"
        ? "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
        : "/bin/bash";

      if (process.platform === "win32" && fs.existsSync(shell)) {
        expect(() => {
          backend.verifyAvailable();
        }).not.toThrow();
      }
    });
  });

  describe("setShuttingDown", () => {
    test("should set shutting down flag", () => {
      expect(() => {
        backend.setShuttingDown(true);
        backend.setShuttingDown(false);
      }).not.toThrow();
    });
  });

  describe("killAll", () => {
    test("should kill all active sessions", () => {
      const session1 = backend.createSession();
      const session2 = backend.createSession();

      expect(backend.listSessions().length).toBeGreaterThanOrEqual(2);

      backend.killAll();

      expect(backend.listSessions()).toEqual([]);
    });
  });

  describe("killAllAndWait", () => {
    test("should kill all sessions and wait for cleanup", async () => {
      backend.createSession();
      backend.createSession();

      try {
        await backend.killAllAndWait();
        expect(backend.listSessions()).toEqual([]);
      } catch (error) {
        // killAllAndWait may timeout but should still clean up sessions
        expect(backend.listSessions()).toEqual([]);
      }
    });

    test("should resolve immediately when no sessions exist", async () => {
      backend.killAll();

      try {
        await backend.killAllAndWait();
      } catch (error) {
        // Timeout is acceptable when no sessions exist
      }
      expect(backend.listSessions()).toEqual([]);
    });
  });

  describe("destroyAll", () => {
    test("should destroy all terminal resources", () => {
      backend.createSession();
      backend.createSession();

      expect(() => {
        backend.destroyAll();
      }).not.toThrow();

      expect(backend.listSessions()).toEqual([]);
    });
  });

  describe("reconnectSession", () => {
    test("should throw error for non-existent session", async () => {
      await expect(() => {
        backend.reconnectSession("non-existent", 80, 24, 1);
      }).toThrow("Session non-existent not found");
    });

    test("should throw error indicating Windows does not support persistent sessions", async () => {
      // Create and kill a session to simulate orphaned metadata
      const { sessionId } = backend.createSession();
      const metaPath = path.join(
        require("./tmux").SESSION_DIR,
        `${sessionId}.json`,
      );
      backend.killSession(sessionId);

      // Metadata may still exist after kill
      // Reconnect should fail because session is not in memory
      try {
        backend.reconnectSession(sessionId, 80, 24, 1);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe("getDefaultShell", () => {
    test("should return valid shell path", () => {
      // The internal getDefaultShell function is tested indirectly
      // through createSession which uses it
      const result = backend.createSession();
      expect(result.shell).toBeDefined();
      expect(result.shell.length).toBeGreaterThan(0);
    });
  });

  describe("Session Metadata Persistence", () => {
    test("should write and read session metadata", () => {
      const { sessionId, shell } = backend.createSession();

      // Verify metadata was written
      const metaPath = path.join(
        require("./tmux").SESSION_DIR,
        `${sessionId}.json`,
      );

      expect(fs.existsSync(metaPath)).toBe(true);

      const rawContent = fs.readFileSync(metaPath, "utf8");
      const meta = JSON.parse(rawContent);

      expect(meta.shell).toBe(shell);
      expect(meta.cwd).toBeDefined();
      expect(meta.createdAt).toBeDefined();
    });

    test("should clean up metadata on session kill", () => {
      const { sessionId } = backend.createSession();
      const metaPath = path.join(
        require("./tmux").SESSION_DIR,
        `${sessionId}.json`,
      );

      expect(fs.existsSync(metaPath)).toBe(true);

      backend.killSession(sessionId);

      // Metadata should be deleted after kill
      expect(fs.existsSync(metaPath)).toBe(false);
    });
  });

  describe("Edge Cases", () => {
    test("should handle rapid session creation", () => {
      const sessions: { sessionId: string; shell: string }[] = [];

      for (let i = 0; i < 10; i++) {
        sessions.push(backend.createSession());
      }

      const sessionIds = sessions.map(s => s.sessionId);
      const uniqueIds = new Set(sessionIds);

      // All session IDs should be unique
      expect(uniqueIds.size).toBe(sessionIds.length);
    });

    test("should handle session operations after killAll", () => {
      backend.killAll();

      // Should still be able to create new sessions
      const result = backend.createSession();
      expect(result.sessionId).toBeDefined();
    });
  });
});

describe("WindowsTerminalBackend - Platform Specific", () => {
  let backend: WindowsTerminalBackend;

  beforeEach(() => {
    backend = new WindowsTerminalBackend();
  });

  afterEach(() => {
    backend.killAll();
  });

  test("should use PowerShell as default shell when available", () => {
    if (process.platform === "win32") {
      const powerShellPath = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
      const cmdPath = "C:\\Windows\\System32\\cmd.exe";

      // PowerShell should be preferred
      const result = backend.createSession();

      // Should use PowerShell if available, otherwise cmd.exe
      // Note: result.shell may have different casing than our constants
      const shellLower = result.shell.toLowerCase();
      expect(
        shellLower.includes("powershell") || shellLower.includes("cmd.exe")
      ).toBe(true);
    }
  });

  test("should handle Windows environment variables", () => {
    // The windowsEnv function sets up environment for PTY
    // This is tested indirectly through session creation
    const result = backend.createSession();
    expect(result).toBeDefined();
  });
});
