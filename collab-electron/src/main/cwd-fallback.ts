import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Return the nearest ancestor of `dir` that exists and is a directory.
 *
 * A terminal spawned with a non-existent cwd dies immediately — the
 * shell process is created but its `chdir()` into the missing directory
 * fails, so it exits 1 before producing any output. Callers normalize
 * the requested cwd through this first so a stale path (moved repo,
 * deleted worktree) lands the shell in the closest surviving directory
 * instead of silently killing the tile.
 *
 * @param dir Requested working directory (absolute or relative).
 * @param fallback Returned when no ancestor exists. Defaults to home.
 */
export function nearestExistingDir(
  dir: string,
  fallback: string = os.homedir(),
): string {
  let current = path.resolve(dir);
  for (;;) {
    try {
      if (fs.statSync(current).isDirectory()) return current;
    } catch {
      // Path does not exist — walk up to its parent.
    }
    const parent = path.dirname(current);
    if (parent === current) return fallback; // reached filesystem root
    current = parent;
  }
}
