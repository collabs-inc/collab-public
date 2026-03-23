import { execFile } from "node:child_process";
import { accessSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  GitChangeStatus,
  GitFileChange,
  GitStatusResult,
  GitBranch,
  GitRemote,
  GitStash,
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

// -- Push / Pull / Fetch --

export async function gitPush(cwd: string): Promise<void> {
  assertGitRepo(cwd);
  await git(["push"], cwd);
}

export async function gitPushSetUpstream(
  cwd: string,
  remote: string,
  branch: string,
): Promise<void> {
  assertGitRepo(cwd);
  await git(["push", "-u", remote, branch], cwd);
}

export async function gitPull(cwd: string): Promise<void> {
  assertGitRepo(cwd);
  await git(["pull"], cwd);
}

export async function gitFetch(cwd: string): Promise<void> {
  assertGitRepo(cwd);
  await git(["fetch", "--all"], cwd);
}

export async function gitRemotes(
  cwd: string,
): Promise<GitRemote[]> {
  assertGitRepo(cwd);
  const raw = await git(["remote", "-v"], cwd);
  const map = new Map<string, GitRemote>();

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
    if (!match) continue;
    const [, name, url, type] = match;
    let remote = map.get(name!);
    if (!remote) {
      remote = { name: name!, fetchUrl: "", pushUrl: "" };
      map.set(name!, remote);
    }
    if (type === "fetch") remote.fetchUrl = url!;
    else remote.pushUrl = url!;
  }

  return Array.from(map.values());
}

export async function gitHasUpstream(cwd: string): Promise<boolean> {
  assertGitRepo(cwd);
  try {
    await git(
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      cwd,
    );
    return true;
  } catch {
    return false;
  }
}

// -- Branch operations --

export async function gitBranches(
  cwd: string,
): Promise<GitBranch[]> {
  assertGitRepo(cwd);
  const raw = await git(
    [
      "branch",
      "-a",
      "--format=%(refname:short)|%(HEAD)|%(upstream:short)",
    ],
    cwd,
  );

  const branches: GitBranch[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("|");
    const name = parts[0]!.trim();
    const isCurrent = parts[1]?.trim() === "*";
    const upstream = parts[2]?.trim() || undefined;
    const isRemote = name.startsWith("origin/") || name.includes("/");

    // Skip HEAD pointers like "origin/HEAD"
    if (name.endsWith("/HEAD")) continue;

    branches.push({ name, current: isCurrent, upstream, isRemote });
  }

  return branches;
}

export async function gitCheckout(
  cwd: string,
  branch: string,
): Promise<void> {
  assertGitRepo(cwd);
  await git(["checkout", branch], cwd);
}

export async function gitCreateBranch(
  cwd: string,
  name: string,
  startPoint?: string,
): Promise<void> {
  assertGitRepo(cwd);
  const args = ["checkout", "-b", name];
  if (startPoint) args.push(startPoint);
  await git(args, cwd);
}

export async function gitDeleteBranch(
  cwd: string,
  name: string,
): Promise<void> {
  assertGitRepo(cwd);
  await git(["branch", "-d", name], cwd);
}

// -- Stash operations --

export async function gitStashSave(
  cwd: string,
  message?: string,
): Promise<void> {
  assertGitRepo(cwd);
  const args = ["stash", "push"];
  if (message) args.push("-m", message);
  await git(args, cwd);
}

export async function gitStashList(
  cwd: string,
): Promise<GitStash[]> {
  assertGitRepo(cwd);
  let raw: string;
  try {
    raw = await git(
      ["stash", "list", "--format=%gd|%s|%ai"],
      cwd,
    );
  } catch {
    return [];
  }

  const stashes: GitStash[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("|");
    if (parts.length < 3) continue;
    const ref = parts[0]!; // stash@{0}
    const indexMatch = ref.match(/\{(\d+)\}/);
    const index = indexMatch ? parseInt(indexMatch[1]!, 10) : 0;
    stashes.push({
      index,
      message: parts[1]!.trim(),
      date: parts[2]!.trim(),
    });
  }

  return stashes;
}

export async function gitStashPop(
  cwd: string,
  index: number,
): Promise<void> {
  assertGitRepo(cwd);
  await git(["stash", "pop", `stash@{${index}}`], cwd);
}

export async function gitStashApply(
  cwd: string,
  index: number,
): Promise<void> {
  assertGitRepo(cwd);
  await git(["stash", "apply", `stash@{${index}}`], cwd);
}

export async function gitStashDrop(
  cwd: string,
  index: number,
): Promise<void> {
  assertGitRepo(cwd);
  await git(["stash", "drop", `stash@{${index}}`], cwd);
}

// -- Show file at ref --

export async function gitShowFile(
  cwd: string,
  ref: string,
  filePath: string,
): Promise<string> {
  assertGitRepo(cwd);
  // ref = "HEAD" for committed, "" or ":" for index
  const spec = ref ? `${ref}:${filePath}` : `:${filePath}`;
  try {
    return await git(["show", spec], cwd);
  } catch {
    // File doesn't exist at that ref (new file)
    return "";
  }
}
