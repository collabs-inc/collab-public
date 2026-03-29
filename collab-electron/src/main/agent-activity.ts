import { relative, isAbsolute, resolve } from "node:path";

export interface AgentInteraction {
  filePath: string;
  type: "read" | "write";
  timestamp: number;
}

export interface AgentSession {
  sessionId: string;
  cwd: string;
  startedAt: number;
  interactions: AgentInteraction[];
  ptySessionId: string | null;
}

type AgentEvent =
  | { kind: "session-started"; sessionId: string }
  | {
      kind: "file-touched";
      sessionId: string;
      filePath: string;
      touchType: "read" | "write";
      timestamp: number;
    }
  | { kind: "session-ended"; sessionId: string };

type NotifyFn = (event: AgentEvent) => void;

const sessions = new Map<string, AgentSession>();
let notifyFn: NotifyFn | null = null;
let workspacePath: string | null = null;

export function setNotifyFn(fn: NotifyFn): void {
  notifyFn = fn;
}

export function setWorkspacePath(path: string): void {
  workspacePath = path;
}

export function sessionStart(params: {
  session_id: string;
  cwd: string;
}): void {
  if (sessions.has(params.session_id)) return;
  const session: AgentSession = {
    sessionId: params.session_id,
    cwd: params.cwd,
    startedAt: Date.now(),
    interactions: [],
    ptySessionId: null,
  };
  sessions.set(params.session_id, session);
  notifyFn?.({ kind: "session-started", sessionId: params.session_id });
}

export function fileTouched(params: {
  session_id: string;
  tool_name: string;
  file_path: string | null;
}): void {
  if (params.file_path === null) return;

  const session = sessions.get(params.session_id);
  if (!session) return;

  const absolutePath = isAbsolute(params.file_path)
    ? params.file_path
    : resolve(session.cwd, params.file_path);

  if (!workspacePath) return;

  const rel = relative(workspacePath, absolutePath);
  if (rel.startsWith("..") || isAbsolute(rel)) return;

  const touchType = params.tool_name === "Read" ? "read" : "write";
  const timestamp = Date.now();

  session.interactions.push({
    filePath: rel,
    type: touchType,
    timestamp,
  });

  if (session.interactions.length > 1000) {
    session.interactions = session.interactions.slice(-1000);
  }

  notifyFn?.({
    kind: "file-touched",
    sessionId: params.session_id,
    filePath: rel,
    touchType,
    timestamp,
  });
}

export function sessionEnd(params: { session_id: string }): void {
  if (!sessions.has(params.session_id)) return;
  sessions.delete(params.session_id);
  notifyFn?.({ kind: "session-ended", sessionId: params.session_id });
}

export function getSession(
  sessionId: string,
): AgentSession | undefined {
  return sessions.get(sessionId);
}

export function linkPtySession(
  sessionId: string,
  ptySessionId: string,
): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.ptySessionId = ptySessionId;
  }
}

export function getPtySessionId(
  sessionId: string,
): string | null {
  return sessions.get(sessionId)?.ptySessionId ?? null;
}
