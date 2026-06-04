// src/main/sidecar/log.ts
// Minimal append-only logger for the sidecar process. The sidecar runs
// detached as a plain Node process (ELECTRON_RUN_AS_NODE) and is often
// reused across app launches, so its stdout/stderr is not reliably
// captured by the main process. This writes its own session log file so
// PTY spawn/exit events are always recorded.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Directory is passed from main via env so it matches the app's COLLAB_DIR
// in both dev (per-worktree) and packaged builds. Falls back to the
// production default if spawned without it.
const LOG_DIR =
  process.env.COLLAB_SIDECAR_LOG_DIR
  || path.join(os.homedir(), ".collaborator", "logs");

const sessionTimestamp = new Date()
  .toISOString()
  .replaceAll(":", "-")
  .replace(/\.\d+Z$/, "");

let logPath: string | null | undefined;

function resolveLogPath(): string | null {
  if (logPath !== undefined) return logPath;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    logPath = path.join(LOG_DIR, `sidecar-${sessionTimestamp}.log`);
  } catch {
    logPath = null;
  }
  return logPath;
}

/** Append a single structured event line. Never throws. */
export function slog(
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const target = resolveLogPath();
  if (!target) return;
  const line =
    `[${new Date().toISOString()}] ${event} ${JSON.stringify(fields)}\n`;
  try {
    fs.appendFileSync(target, line);
  } catch {
    // Best effort — logging must never crash the sidecar.
  }
}
