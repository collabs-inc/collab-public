// src/main/sidecar/protocol.ts
import { join } from "node:path";
import { COLLAB_DIR } from "../paths";
import { makeEndpointPath } from "../ipc-endpoint";

export const SIDECAR_SOCKET_PATH = makeEndpointPath("pty-sidecar");
export const SIDECAR_PID_PATH = join(COLLAB_DIR, "pty-sidecar.pid");
export const SESSION_SOCKET_DIR = join(COLLAB_DIR, "pty-sessions");

export function sessionSocketPath(sessionId: string): string {
  if (process.platform === "win32") {
    return makeEndpointPath(`pty-session-${sessionId}`);
  }
  return join(SESSION_SOCKET_DIR, `${sessionId}.sock`);
}

// Ring buffer default: 8 MB per session
export const DEFAULT_RING_BUFFER_BYTES = 8 * 1024 * 1024;



// JSON-RPC 2.0 types
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export function makeRequest(
  id: number,
  method: string,
  params?: Record<string, unknown>,
): string {
  const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
  return JSON.stringify(msg) + "\n";
}

export function makeResponse(id: number, result: unknown): string {
  const msg: JsonRpcResponse = { jsonrpc: "2.0", id, result };
  return JSON.stringify(msg) + "\n";
}

export function makeError(
  id: number,
  code: number,
  message: string,
): string {
  const msg: JsonRpcResponse = {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
  return JSON.stringify(msg) + "\n";
}

export function makeNotification(
  method: string,
  params?: Record<string, unknown>,
): string {
  const msg: JsonRpcNotification = { jsonrpc: "2.0", method, params };
  return JSON.stringify(msg) + "\n";
}

// PID file format
export interface PidFileData {
  pid: number;
  token: string;
}

// session.create params/result
export interface SessionCreateParams {
  command: string;
  args: string[];
  displayName: string;
  target: string;
  cwdHostPath: string;
  cwdGuestPath?: string;
  /** @deprecated Backward compat: old sidecars expect this instead of command/args. */
  shell?: string;
  cwd: string;
  cols: number;
  rows: number;
  env?: Record<string, string>;
}

export interface SessionCreateResult {
  sessionId: string;
  socketPath: string;
}

// session.reconnect params/result
export interface SessionReconnectParams {
  sessionId: string;
  cols: number;
  rows: number;
}

export interface SessionReconnectResult {
  sessionId: string;
  socketPath: string;
}

// session.list result
export interface SessionInfo {
  sessionId: string;
  shell: string;
  displayName: string;
  target: string;
  cwd: string;
  cwdHostPath: string;
  cwdGuestPath?: string;
  pid: number;
  createdAt: string;
}

// sidecar.ping result
export interface PingResult {
  pid: number;
  uptime: number;
  token: string;
}
