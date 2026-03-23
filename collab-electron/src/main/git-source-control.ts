import { execFile } from "node:child_process";
import { accessSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  GitChangeStatus,
  GitFileChange,
  GitStatusResult,
} from "@collab/shared/git-types";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 50 * 1024 * 1024;

async function git(
  args: string[],
  cwd: string,
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: MAX_BUFFER,
  });
  return stdout;
}

export function isGitRepo(cwd: string): boolean {
  try {
    accessSync(join(cwd, ".git"));
    return true;
  } catch {
    return false;
  }
}

function assertGitRepo(cwd: string): void {
  if (!isGitRepo(cwd)) {
    throw new Error("Not a git repository");
  }
}

/**
 * Parse `git status --porcelain=v2 --branch` output.
 *
 * Header lines start with `#`:
 *   # branch.oid <hash>
 *   # branch.head <name>
 *   # branch.upstream <remote>/<branch>
 *   # branch.ab +<ahead> -<behind>
 *
 * Changed entries start with `1` (ordinary) or `2` (rename/copy):
 *   1 XY <sub> <mH> <mI> <mW> <hH> <hI> <path>
 *   2 XY <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\t<origPath>
 *
 * Untracked entries start with `?`:
 *   ? <path>
 *
 * Unmerged entries start with `u`:
 *   u XY <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
 */
export async function gitStatus(
  cwd: string,
): Promise<GitStatusResult> {
  if (!isGitRepo(cwd)) {
    return {
      branch: "",
      ahead: 0,
      behind: 0,
      staged: [],
      unstaged: [],
      untracked: [],
      isGitRepo: false,
    };
  }

  const raw = await git(
    ["status", "--porcelain=v2", "--branch", "-uall"],
    cwd,
  );

  let branch = "";
  let upstream: string | undefined;
  let ahead = 0;
  let behind = 0;
  const staged: GitFileChange[] = [];
  const unstaged: GitFileChange[] = [];
  const untracked: GitFileChange[] = [];

  for (const line of raw.split("\n")) {
    if (!line) continue;

    // Header lines
    if (line.startsWith("# branch.head ")) {
      branch = line.slice("# branch.head ".length);
    } else if (line.startsWith("# branch.upstream ")) {
      upstream = line.slice("# branch.upstream ".length);
    } else if (line.startsWith("# branch.ab ")) {
      const match = line.match(/\+(\d+) -(\d+)/);
      if (match) {
        ahead = parseInt(match[1]!, 10);
        behind = parseInt(match[2]!, 10);
      }
    }

    // Untracked
    else if (line.startsWith("? ")) {
      const path = line.slice(2);
      untracked.push({
        path,
        absPath: join(cwd, path),
        status: "?",
      });
    }

    // Unmerged
    else if (line.startsWith("u ")) {
      const parts = line.split(" ");
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      const path = parts.slice(10).join(" ");
      unstaged.push({
        path,
        absPath: join(cwd, path),
        status: "U",
      });
    }

    // Ordinary changed entry
    else if (line.startsWith("1 ")) {
      const parts = line.split(" ");
      const xy = parts[1]!;
      // parts[8] onwards is the path (may contain spaces)
      const path = parts.slice(8).join(" ");
      const indexStatus = xy[0]!;
      const worktreeStatus = xy[1]!;

      if (indexStatus !== ".") {
        staged.push({
          path,
          absPath: join(cwd, path),
          status: mapStatus(indexStatus),
        });
      }
      if (worktreeStatus !== ".") {
        unstaged.push({
          path,
          absPath: join(cwd, path),
          status: mapStatus(worktreeStatus),
        });
      }
    }

    // Rename/copy entry
    else if (line.startsWith("2 ")) {
      const parts = line.split("\t");
      const meta = parts[0]!.split(" ");
      const xy = meta[1]!;
      const newPath = parts[0]!.split(" ").slice(9).join(" ");
      const oldPath = parts[1]!;
      const indexStatus = xy[0]!;
      const worktreeStatus = xy[1]!;

      if (indexStatus !== ".") {
        staged.push({
          path: newPath,
          absPath: join(cwd, newPath),
          status: "R",
          oldPath,
        });
      }
      if (worktreeStatus !== ".") {
        unstaged.push({
          path: newPath,
          absPath: join(cwd, newPath),
          status: "R",
          oldPath,
        });
      }
    }
  }

  return {
    branch,
    upstream,
    ahead,
    behind,
    staged,
    unstaged,
    untracked,
    isGitRepo: true,
  };
}

function mapStatus(char: string): GitChangeStatus {
  switch (char) {
    case "M":
      return "M";
    case "A":
      return "A";
    case "D":
      return "D";
    case "R":
      return "R";
    case "C":
      return "A"; // copy treated as add
    case "U":
      return "U";
    default:
      return "M";
  }
}

export async function gitStage(
  cwd: string,
  paths: string[],
): Promise<void> {
  assertGitRepo(cwd);
  if (paths.length === 0) return;
  await git(["add", "--", ...paths], cwd);
}

export async function gitUnstage(
  cwd: string,
  paths: string[],
): Promise<void> {
  assertGitRepo(cwd);
  if (paths.length === 0) return;
  await git(["restore", "--staged", "--", ...paths], cwd);
}

export async function gitStageAll(cwd: string): Promise<void> {
  assertGitRepo(cwd);
  await git(["add", "-A"], cwd);
}

export async function gitUnstageAll(cwd: string): Promise<void> {
  assertGitRepo(cwd);
  try {
    await git(["reset", "HEAD"], cwd);
  } catch {
    // reset HEAD fails on repos with no commits; use rm --cached instead
    await git(["rm", "--cached", "-r", "."], cwd);
  }
}

export async function gitDiscard(
  cwd: string,
  paths: string[],
): Promise<void> {
  assertGitRepo(cwd);
  if (paths.length === 0) return;

  // Separate tracked (checkout) vs untracked (clean) files
  const statusRaw = await git(
    ["status", "--porcelain", "--", ...paths],
    cwd,
  );

  const untrackedPaths: string[] = [];
  const trackedPaths: string[] = [];

  for (const line of statusRaw.split("\n")) {
    if (!line) continue;
    const status = line.slice(0, 2);
    const filePath = line.slice(3);
    if (status === "??") {
      untrackedPaths.push(filePath);
    } else {
      trackedPaths.push(filePath);
    }
  }

  if (trackedPaths.length > 0) {
    await git(["checkout", "--", ...trackedPaths], cwd);
  }
  if (untrackedPaths.length > 0) {
    await git(["clean", "-f", "--", ...untrackedPaths], cwd);
  }
}

export async function gitDiscardAll(cwd: string): Promise<void> {
  assertGitRepo(cwd);
  await git(["checkout", "--", "."], cwd);
  await git(["clean", "-fd"], cwd);
}

export async function gitCommit(
  cwd: string,
  message: string,
): Promise<{ hash: string }> {
  assertGitRepo(cwd);
  if (!message.trim()) {
    throw new Error("Commit message cannot be empty");
  }
  const output = await git(["commit", "-m", message], cwd);
  // Extract short hash from output like "[branch abc1234] message"
  const match = output.match(/\[.+\s+([a-f0-9]+)\]/);
  const hash = match?.[1] ?? "";
  return { hash };
}

export async function gitDiff(
  cwd: string,
  filePath: string,
  cached: boolean,
): Promise<string> {
  assertGitRepo(cwd);
  const args = ["diff"];
  if (cached) args.push("--cached");
  args.push("--", filePath);
  return git(args, cwd);
}

export async function gitDiffAll(cwd: string): Promise<string> {
  assertGitRepo(cwd);
  return git(["diff"], cwd);
}

export async function gitDiffCached(cwd: string): Promise<string> {
  assertGitRepo(cwd);
  return git(["diff", "--cached"], cwd);
}
