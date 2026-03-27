/**
 * Terminal Backend Abstraction Layer
 *
 * Provides a platform-agnostic interface for terminal/PTY operations.
 * Implementations exist for macOS (tmux-based) and Windows (node-pty direct).
 */

/**
 * Session metadata stored for persistence across restarts
 */
export interface SessionMeta {
  shell: string;
  cwd: string;
  createdAt: string;
}

/**
 * Discovered session from persistent storage
 */
export interface DiscoveredSession {
  sessionId: string;
  meta: SessionMeta;
}

/**
 * Result of reconnecting to an existing session
 */
export interface ReconnectResult {
  sessionId: string;
  shell: string;
  meta: SessionMeta | null;
  scrollback: string;
}

/**
 * Terminal backend interface - defines the contract for platform-specific
 * terminal implementations.
 */
export interface TerminalBackend {
  /**
   * Create a new terminal session
   * @param cwd - Working directory for the session
   * @param senderWebContentsId - WebContents ID for event routing
   * @param cols - Initial column count
   * @param rows - Initial row count
   * @returns Session ID and shell path
   */
  createSession(
    cwd?: string,
    senderWebContentsId?: number,
    cols?: number,
    rows?: number,
  ): { sessionId: string; shell: string };

  /**
   * Reconnect to an existing session (after app restart)
   * @param sessionId - Session to reconnect to
   * @param cols - New column count
   * @param rows - New row count
   * @param senderWebContentsId - WebContents ID for event routing
   * @returns Reconnection result with scrollback
   */
  reconnectSession(
    sessionId: string,
    cols: number,
    rows: number,
    senderWebContentsId: number,
  ): ReconnectResult;

  /**
   * Write data to the terminal session
   * @param sessionId - Target session
   * @param data - Data to write
   */
  writeToSession(sessionId: string, data: string): void;

  /**
   * Send raw key sequences to the terminal
   * @param sessionId - Target session
   * @param data - Key data to send
   */
  sendRawKeys(sessionId: string, data: string): void;

  /**
   * Resize the terminal session
   * @param sessionId - Target session
   * @param cols - New column count
   * @param rows - New row count
   */
  resizeSession(sessionId: string, cols: number, rows: number): void;

  /**
   * Kill a terminal session
   * @param sessionId - Session to kill
   */
  killSession(sessionId: string): void;

  /**
   * List all active session IDs
   */
  listSessions(): string[];

  /**
   * Kill all sessions and wait for cleanup
   */
  killAll(): void;

  /**
   * Kill all sessions and wait with timeout
   */
  killAllAndWait(): Promise<void>;

  /**
   * Destroy all terminal resources
   */
  destroyAll(): void;

  /**
   * Discover existing sessions from persistent storage
   */
  discoverSessions(): DiscoveredSession[];

  /**
   * Verify terminal backend is available (for health checks)
   */
  verifyAvailable(): void;

  /**
   * Set shutting down flag
   */
  setShuttingDown(value: boolean): void;
}

/**
 * Factory function to create the appropriate terminal backend
 * based on the current platform.
 */
export function createTerminalBackend(): TerminalBackend {
  const platform = process.platform;

  if (platform === "win32") {
    // Lazy import to avoid loading Windows module on macOS
    const { WindowsTerminalBackend } = require("./terminal-backend.windows");
    return new WindowsTerminalBackend();
  } else if (platform === "darwin" || platform === "linux") {
    // macOS and Linux use tmux-based backend
    const { TmuxTerminalBackend } = require("./terminal-backend.tmux");
    return new TmuxTerminalBackend();
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }
}

// Export platform-specific backends for direct access if needed
export { TmuxTerminalBackend } from "./terminal-backend.tmux";
