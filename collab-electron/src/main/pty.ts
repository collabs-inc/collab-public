/**
 * PTY Session Management
 *
 * Platform-agnostic terminal session management using the TerminalBackend
 * abstraction layer. Delegates to tmux-based backend on macOS/Linux and
 * direct node-pty backend on Windows.
 */

import { createTerminalBackend, type SessionMeta, type DiscoveredSession } from "./terminal-backend";

// Create the platform-specific backend instance
const backend = createTerminalBackend();

// Re-export setShuttingDown for external use
export function setShuttingDown(value: boolean): void {
  backend.setShuttingDown(value);
}

/**
 * Create a new terminal session
 * @param cwd - Working directory for the session
 * @param senderWebContentsId - WebContents ID for event routing
 * @param cols - Initial column count
 * @param rows - Initial row count
 * @returns Session ID and shell path
 */
export function createSession(
  cwd?: string,
  senderWebContentsId?: number,
  cols?: number,
  rows?: number,
): { sessionId: string; shell: string } {
  return backend.createSession(cwd, senderWebContentsId, cols, rows);
}

/**
 * Reconnect to an existing session (after app restart)
 * @param sessionId - Session to reconnect to
 * @param cols - New column count
 * @param rows - New row count
 * @param senderWebContentsId - WebContents ID for event routing
 * @returns Reconnection result with scrollback
 */
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
  return backend.reconnectSession(sessionId, cols, rows, senderWebContentsId);
}

/**
 * Write data to the terminal session
 * @param sessionId - Target session
 * @param data - Data to write
 */
export function writeToSession(
  sessionId: string,
  data: string,
): void {
  backend.writeToSession(sessionId, data);
}

/**
 * Send raw key sequences to the terminal
 * @param sessionId - Target session
 * @param data - Key data to send
 */
export function sendRawKeys(
  sessionId: string,
  data: string,
): void {
  backend.sendRawKeys(sessionId, data);
}

/**
 * Resize the terminal session
 * @param sessionId - Target session
 * @param cols - New column count
 * @param rows - New row count
 */
export function resizeSession(
  sessionId: string,
  cols: number,
  rows: number,
): void {
  backend.resizeSession(sessionId, cols, rows);
}

/**
 * Kill a terminal session
 * @param sessionId - Session to kill
 */
export function killSession(sessionId: string): void {
  backend.killSession(sessionId);
}

/**
 * List all active session IDs
 */
export function listSessions(): string[] {
  return backend.listSessions();
}

/**
 * Kill all sessions immediately
 */
export function killAll(): void {
  backend.killAll();
}

/**
 * Kill all sessions and wait for cleanup with timeout
 */
export function killAllAndWait(): Promise<void> {
  return backend.killAllAndWait();
}

/**
 * Destroy all terminal resources
 */
export function destroyAll(): void {
  backend.destroyAll();
}

/**
 * Discover existing sessions from persistent storage
 */
export function discoverSessions(): DiscoveredSession[] {
  return backend.discoverSessions();
}

/**
 * Verify terminal backend is available (for health checks)
 */
export function verifyTmuxAvailable(): void {
  backend.verifyAvailable();
}

// Re-export types for backward compatibility
export type { SessionMeta, DiscoveredSession };
