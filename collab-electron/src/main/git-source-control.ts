import { execFile } from "node:child_process";
import {
  accessSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type {
  GitChangeStatus,
  GitCloneOptions,
  GitCloneResult,
  GitConfigDisplay,
  GitDiffHunk,
  GitFileChange,
  GitLogEntry,
  GitLogFileChange,
  GitRebaseAction,
  GitRebaseTodoItem,
  GitRepoState,
  GitStatusResult,
  GitBranch,
  GitRemote,
  GitStash,
  GitSubmodule,
  GitTag,
  GitWorktree,
} from "@collab/shared/git-types";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 50 * 1024 * 1024;

async function git(
  args: string[],
  cwd: string,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: MAX_BUFFER,
    });
    return stdout;
  } catch (err) {
    const execErr = err as { stderr?: string; message?: string };
    const msg = (execErr.stderr ?? execErr.message ?? "Git command failed")
      .trim();
    throw new Error(msg);
  }
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
      merge: [],
      isGitRepo: false,
      hasCommits: false,
      repoState: "clean",
    };
  }

  let hasCommits = false;
  try {
    await git(["rev-parse", "HEAD"], cwd);
    hasCommits = true;
  } catch {
    hasCommits = false;
  }

  const raw = await git(
    ["status", "--porcelain=v2", "--branch", "-uall", "-z"],
    cwd,
  );

  let branch = "";
  let upstream: string | undefined;
  let ahead = 0;
  let behind = 0;
  const staged: GitFileChange[] = [];
  const unstaged: GitFileChange[] = [];
  const untracked: GitFileChange[] = [];
  const merge: GitFileChange[] = [];

  for (const line of raw.split("\0")) {
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

    // Unmerged (merge conflicts)
    else if (line.startsWith("u ")) {
      const parts = line.split(" ");
      const path = parts.slice(10).join(" ");
      merge.push({
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

  const repoState = gitRepoState(cwd);

  const allPaths = [
    ...staged,
    ...unstaged,
    ...untracked,
    ...merge,
  ].map((f) => f.path);
  const lfsPaths = await gitPathsUsingLfs(cwd, [...new Set(allPaths)]);
  const withLfs = (files: GitFileChange[]) =>
    files.map((f) => (lfsPaths.has(f.path) ? { ...f, lfs: true } : f));

  return {
    branch,
    upstream,
    ahead,
    behind,
    staged: withLfs(staged),
    unstaged: withLfs(unstaged),
    untracked: withLfs(untracked),
    merge: withLfs(merge),
    isGitRepo: true,
    hasCommits,
    repoState,
  };
}

export function gitRepoState(cwd: string): GitRepoState {
  const gitDir = join(cwd, ".git");
  if (!existsSync(gitDir)) return "clean";

  if (existsSync(join(gitDir, "MERGE_HEAD"))) return "merging";
  if (existsSync(join(gitDir, "CHERRY_PICK_HEAD"))) return "cherry-picking";
  if (existsSync(join(gitDir, "REVERT_HEAD"))) return "reverting";

  const rebaseMerge = join(gitDir, "rebase-merge");
  const rebaseApply = join(gitDir, "rebase-apply");
  if (existsSync(rebaseMerge) || existsSync(rebaseApply)) {
    if (existsSync(join(rebaseMerge, "git-rebase-todo"))) {
      return "interactive-rebase";
    }
    return "rebasing";
  }

  return "clean";
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
    ["status", "--porcelain", "-z", "--", ...paths],
    cwd,
  );

  const untrackedPaths: string[] = [];
  const trackedPaths: string[] = [];

  for (const entry of statusRaw.split("\0")) {
    if (!entry) continue;
    const status = entry.slice(0, 2);
    let filePath = entry.slice(3);
    const arrow = filePath.indexOf(" -> ");
    if (arrow !== -1) {
      filePath = filePath.slice(arrow + 4);
    }
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
  options?: { amend?: boolean; sign?: boolean },
): Promise<{ hash: string }> {
  assertGitRepo(cwd);
  if (!message.trim()) {
    throw new Error("Commit message cannot be empty");
  }
  const args = ["commit", "-m", message];
  if (options?.amend) args.push("--amend");
  if (options?.sign) args.push("-S");
  const output = await git(args, cwd);
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

export async function gitInit(cwd: string): Promise<void> {
  await git(["init"], cwd);
}

export async function gitPush(
  cwd: string,
  remote?: string,
): Promise<void> {
  assertGitRepo(cwd);
  if (remote) await git(["push", remote], cwd);
  else await git(["push"], cwd);
}

export async function gitPushSetUpstream(
  cwd: string,
  remote: string,
  branch: string,
): Promise<void> {
  assertGitRepo(cwd);
  await git(["push", "-u", remote, branch], cwd);
}

export async function gitPull(
  cwd: string,
  remote?: string,
): Promise<void> {
  assertGitRepo(cwd);
  if (remote) await git(["pull", remote], cwd);
  else await git(["pull"], cwd);
}

export async function gitFetch(
  cwd: string,
  remote?: string,
): Promise<void> {
  assertGitRepo(cwd);
  if (remote) await git(["fetch", remote], cwd);
  else await git(["fetch", "--all"], cwd);
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

export async function gitHasUpstream(
  cwd: string,
  _remote?: string,
): Promise<boolean> {
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
      "for-each-ref",
      "--format=%(refname:short)|%(refname)|%(HEAD)|%(upstream:short)",
      "refs/heads",
      "refs/remotes",
    ],
    cwd,
  );

  const branches: GitBranch[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("|");
    const name = parts[0]!.trim();
    const refname = parts[1]!.trim();
    const isCurrent = parts[2]?.trim() === "*";
    const upstream = parts[3]?.trim() || undefined;
    const isRemote = refname.startsWith("refs/remotes/");

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

export async function gitTags(cwd: string): Promise<GitTag[]> {
  assertGitRepo(cwd);
  const raw = await git(["tag", "-l"], cwd);
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((name) => ({ name }));
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
  // ref = "HEAD", "index", ":1:path" conflict stage, or empty for index
  let spec: string;
  if (ref.startsWith(":")) {
    spec = `${ref}${filePath}`;
  } else if (ref === "index" || ref === "") {
    spec = `:${filePath}`;
  } else if (ref === "working") {
    const { readFile } = await import("node:fs/promises");
    try {
      return await readFile(join(cwd, filePath), "utf8");
    } catch {
      return "";
    }
  } else {
    spec = `${ref}:${filePath}`;
  }
  try {
    return await git(["show", spec], cwd);
  } catch {
    return "";
  }
}

// -- Read blob / diff refs --

export async function gitReadBlob(
  cwd: string,
  ref: string,
  filePath: string,
): Promise<string> {
  return gitShowFile(cwd, ref, filePath);
}

export async function gitDiffRefs(
  cwd: string,
  leftRef: string,
  rightRef: string,
  filePath: string,
): Promise<string> {
  assertGitRepo(cwd);
  const args = ["diff"];
  if (leftRef && rightRef) {
    args.push(`${leftRef}..${rightRef}`);
  }
  args.push("--", filePath);
  try {
    return await git(args, cwd);
  } catch {
    return "";
  }
}

// -- Clone --

function repoNameFromCloneUrl(url: string): string {
  const cleaned = url.replace(/\.git$/, "").replace(/\/$/, "");
  const parts = cleaned.split(/[/:]/).filter(Boolean);
  return parts[parts.length - 1] || "repository";
}

export async function gitClone(
  url: string,
  parentDir: string,
  options?: GitCloneOptions,
): Promise<GitCloneResult> {
  const folderName = repoNameFromCloneUrl(url);
  const target = join(parentDir, folderName);
  const args = ["clone"];
  if (options?.depth) args.push("--depth", String(options.depth));
  if (options?.branch) args.push("--branch", options.branch);
  args.push(url, target);
  await git(args, parentDir);
  return { path: target };
}

// -- Remote CRUD --

export async function gitRemoteAdd(
  cwd: string,
  name: string,
  url: string,
): Promise<void> {
  assertGitRepo(cwd);
  await git(["remote", "add", name, url], cwd);
}

export async function gitRemoteRemove(
  cwd: string,
  name: string,
): Promise<void> {
  assertGitRepo(cwd);
  await git(["remote", "remove", name], cwd);
}

export async function gitRemoteRename(
  cwd: string,
  oldName: string,
  newName: string,
): Promise<void> {
  assertGitRepo(cwd);
  await git(["remote", "rename", oldName, newName], cwd);
}

export async function gitRemoteSetUrl(
  cwd: string,
  name: string,
  url: string,
  push = false,
): Promise<void> {
  assertGitRepo(cwd);
  const args = ["remote", "set-url"];
  if (push) args.push("--push");
  args.push(name, url);
  await git(args, cwd);
}

// -- Conflict resolution --

export async function gitCheckoutOurs(
  cwd: string,
  paths: string[],
): Promise<void> {
  assertGitRepo(cwd);
  await git(["checkout", "--ours", "--", ...paths], cwd);
}

export async function gitCheckoutTheirs(
  cwd: string,
  paths: string[],
): Promise<void> {
  assertGitRepo(cwd);
  await git(["checkout", "--theirs", "--", ...paths], cwd);
}

export async function gitAdd(
  cwd: string,
  paths: string[],
): Promise<void> {
  await gitStage(cwd, paths);
}

export async function gitMergeAbort(cwd: string): Promise<void> {
  assertGitRepo(cwd);
  await git(["merge", "--abort"], cwd);
}

export async function gitMergeContinue(cwd: string): Promise<void> {
  assertGitRepo(cwd);
  await git(["merge", "--continue"], cwd);
}

export async function gitCherryPickAbort(cwd: string): Promise<void> {
  assertGitRepo(cwd);
  await git(["cherry-pick", "--abort"], cwd);
}

export async function gitCherryPickContinue(cwd: string): Promise<void> {
  assertGitRepo(cwd);
  await git(["cherry-pick", "--continue"], cwd);
}

export async function gitRevertAbort(cwd: string): Promise<void> {
  assertGitRepo(cwd);
  await git(["revert", "--abort"], cwd);
}

export async function gitRevertContinue(cwd: string): Promise<void> {
  assertGitRepo(cwd);
  await git(["revert", "--continue"], cwd);
}

// -- History --

export async function gitLog(
  cwd: string,
  options?: { maxCount?: number; ref?: string },
): Promise<GitLogEntry[]> {
  assertGitRepo(cwd);
  const max = options?.maxCount ?? 50;
  const ref = options?.ref ?? "HEAD";
  const raw = await git(
    [
      "log",
      ref,
      `-n${max}`,
      "--format=%H|%h|%s|%an|%ai|%P",
    ],
    cwd,
  );
  const entries: GitLogEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("|");
    if (parts.length < 6) continue;
    const parents = parts[5]!.trim()
      ? parts[5]!.trim().split(" ")
      : [];
    entries.push({
      hash: parts[0]!,
      shortHash: parts[1]!,
      subject: parts[2]!,
      author: parts[3]!,
      date: parts[4]!,
      parents,
    });
  }
  return entries;
}

export async function gitLogFiles(
  cwd: string,
  hash: string,
): Promise<GitLogFileChange[]> {
  assertGitRepo(cwd);
  const raw = await git(
    ["show", "--name-status", "--format=", hash],
    cwd,
  );
  const files: GitLogFileChange[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    files.push({ status: parts[0]!, path: parts[1]! });
  }
  return files;
}

export async function gitRevert(
  cwd: string,
  hash: string,
): Promise<void> {
  assertGitRepo(cwd);
  await git(["revert", "--no-edit", hash], cwd);
}

export async function gitCherryPick(
  cwd: string,
  hash: string,
): Promise<void> {
  assertGitRepo(cwd);
  await git(["cherry-pick", hash], cwd);
}

export async function gitReset(
  cwd: string,
  mode: "soft" | "mixed" | "hard",
  ref: string,
): Promise<void> {
  assertGitRepo(cwd);
  await git(["reset", `--${mode}`, ref], cwd);
}

// -- Merge / rebase --

export async function gitMerge(
  cwd: string,
  branch: string,
): Promise<void> {
  assertGitRepo(cwd);
  await git(["merge", branch], cwd);
}

export async function gitRebase(
  cwd: string,
  onto: string,
): Promise<void> {
  assertGitRepo(cwd);
  await git(["rebase", onto], cwd);
}

export async function gitRebaseContinue(cwd: string): Promise<void> {
  assertGitRepo(cwd);
  await git(["rebase", "--continue"], cwd);
}

export async function gitRebaseAbort(cwd: string): Promise<void> {
  assertGitRepo(cwd);
  await git(["rebase", "--abort"], cwd);
}

export async function gitRebaseSkip(cwd: string): Promise<void> {
  assertGitRepo(cwd);
  await git(["rebase", "--skip"], cwd);
}

const REBASE_ACTIONS = new Set<GitRebaseAction>([
  "pick",
  "reword",
  "edit",
  "squash",
  "fixup",
  "drop",
]);

function parseRebaseTodoLines(raw: string): GitRebaseTodoItem[] {
  const items: GitRebaseTodoItem[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(
      /^(pick|reword|edit|squash|fixup|drop)\s+([a-f0-9]+)\s*(.*)$/i,
    );
    if (!match) continue;
    const action = match[1]!.toLowerCase() as GitRebaseAction;
    if (!REBASE_ACTIONS.has(action)) continue;
    items.push({
      action,
      hash: match[2]!,
      subject: match[3]?.trim() ?? "",
      raw: line,
    });
  }
  return items;
}

export async function gitRebaseTodoList(
  cwd: string,
): Promise<GitRebaseTodoItem[]> {
  assertGitRepo(cwd);
  const rebaseDir = join(cwd, ".git", "rebase-merge");
  const todoPath = join(rebaseDir, "git-rebase-todo");
  if (!existsSync(todoPath)) return [];

  let raw = readFileSync(todoPath, "utf8");
  let items = parseRebaseTodoLines(raw);

  // Paused at `break` (or similar): git empties git-rebase-todo; remaining picks
  // stay in git-rebase-todo.backup until continue.
  if (items.length === 0) {
    const backupPath = join(rebaseDir, "git-rebase-todo.backup");
    if (existsSync(backupPath)) {
      raw = readFileSync(backupPath, "utf8");
      items = parseRebaseTodoLines(raw);
    }
  }

  return items;
}

export async function gitRebaseTodoWrite(
  cwd: string,
  items: GitRebaseTodoItem[],
): Promise<void> {
  assertGitRepo(cwd);
  const todoPath = join(cwd, ".git", "rebase-merge", "git-rebase-todo");
  if (!existsSync(todoPath)) {
    throw new Error("No interactive rebase in progress");
  }
  const existing = readFileSync(todoPath, "utf8");
  const headerLines: string[] = [];
  for (const line of existing.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) headerLines.push(line);
    else break;
  }
  const body = items
    .map((item) => `${item.action} ${item.hash} ${item.subject}`.trimEnd())
    .join("\n");
  const rest = existing
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return (
        t &&
        !t.startsWith("#") &&
        !/^(pick|reword|edit|squash|fixup|drop)\s/i.test(t)
      );
    })
    .join("\n");
  const output = [headerLines.join("\n"), body, rest]
    .filter(Boolean)
    .join("\n");
  writeFileSync(todoPath, output.endsWith("\n") ? output : `${output}\n`);
}

export async function gitRebaseStartInteractive(
  cwd: string,
  onto: string | null,
  count: number,
): Promise<void> {
  assertGitRepo(cwd);
  if (onto) {
    await git(["rebase", "-i", onto], cwd);
  } else {
    await git(["rebase", "-i", `HEAD~${count}`], cwd);
  }
}

// -- Submodules --

export async function gitSubmoduleStatus(
  cwd: string,
): Promise<GitSubmodule[]> {
  assertGitRepo(cwd);
  if (!existsSync(join(cwd, ".gitmodules"))) return [];
  let raw: string;
  try {
    raw = await git(
      ["submodule", "status", "--recursive"],
      cwd,
    );
  } catch {
    return [];
  }
  const subs: GitSubmodule[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const match = line.match(
      /^([ +\-])([a-f0-9]+)\s+(\S+)(?:\s+\((.+)\))?/,
    );
    if (!match) continue;
    const dirty = match[1] === "+" || match[1] === "U";
    const path = match[3]!;
    let url = "";
    let branch: string | undefined;
    try {
      url = (
        await git(["config", "-f", ".gitmodules", "--get", `submodule.${path}.url`], cwd)
      ).trim();
      branch = (
        await git(
          ["config", "-f", ".gitmodules", "--get", `submodule.${path}.branch`],
          cwd,
        )
      ).trim() || undefined;
    } catch {
      /* optional */
    }
    subs.push({
      path,
      url,
      branch,
      commit: match[2]!,
      dirty,
    });
  }
  return subs;
}

export async function gitSubmoduleUpdate(
  cwd: string,
  init?: boolean,
  recursive?: boolean,
): Promise<void> {
  assertGitRepo(cwd);
  const args = ["submodule", "update"];
  if (init) args.push("--init");
  if (recursive) args.push("--recursive");
  await git(args, cwd);
}

// -- Worktrees --

export async function gitWorktreeList(
  cwd: string,
): Promise<GitWorktree[]> {
  assertGitRepo(cwd);
  const raw = await git(["worktree", "list", "--porcelain"], cwd);
  const trees: GitWorktree[] = [];
  let current: Partial<GitWorktree> = {};
  for (const line of raw.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.path) trees.push(current as GitWorktree);
      current = {
        path: line.slice("worktree ".length),
        branch: "",
        head: "",
        bare: false,
        locked: false,
      };
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      current.branch = line
        .slice("branch ".length)
        .replace("refs/heads/", "");
    } else if (line === "bare") {
      current.bare = true;
    } else if (line.startsWith("locked")) {
      current.locked = true;
    }
  }
  if (current.path) trees.push(current as GitWorktree);
  return trees;
}

export async function gitWorktreeAdd(
  cwd: string,
  wtPath: string,
  branch: string,
): Promise<void> {
  assertGitRepo(cwd);
  await git(["worktree", "add", wtPath, branch], cwd);
}

export async function gitWorktreeRemove(
  cwd: string,
  wtPath: string,
): Promise<void> {
  assertGitRepo(cwd);
  await git(["worktree", "remove", wtPath], cwd);
}

// -- Partial staging --

export async function gitDiffHunks(
  cwd: string,
  filePath: string,
  cached = false,
): Promise<GitDiffHunk[]> {
  assertGitRepo(cwd);
  const args = ["diff", "--unified=3"];
  if (cached) args.push("--cached");
  args.push("--", filePath);
  let diff: string;
  try {
    diff = await git(args, cwd);
  } catch {
    return [];
  }
  return parseUnifiedDiffHunks(diff);
}

function parseUnifiedDiffHunks(diff: string): GitDiffHunk[] {
  const hunks: GitDiffHunk[] = [];
  const lines = diff.split("\n");
  let i = 0;
  let hunkIndex = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith("@@")) {
      const header = line;
      const patchLines = [line];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("@@")) {
        patchLines.push(lines[i]!);
        i++;
      }
      hunks.push({
        index: hunkIndex++,
        header,
        patch: patchLines.join("\n"),
      });
    } else {
      i++;
    }
  }
  return hunks;
}

export async function gitApplyCached(
  cwd: string,
  patch: string,
): Promise<void> {
  assertGitRepo(cwd);
  await execFileAsync(
    "git",
    ["apply", "--cached", "-"],
    { cwd, input: patch, maxBuffer: MAX_BUFFER },
  );
}

export async function gitApplyWorking(
  cwd: string,
  patch: string,
  reverse = false,
): Promise<void> {
  assertGitRepo(cwd);
  const args = ["apply"];
  if (reverse) args.push("-R");
  await execFileAsync(
    "git",
    [...args, "-"],
    { cwd, input: patch, maxBuffer: MAX_BUFFER },
  );
}

export async function gitCheckIgnore(
  cwd: string,
  paths: string[],
): Promise<string[]> {
  assertGitRepo(cwd);
  if (paths.length === 0) return [];
  try {
    const raw = await git(["check-ignore", "-v", "--", ...paths], cwd);
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// -- LFS --

export async function gitLfsAvailable(): Promise<boolean> {
  try {
    await execFileAsync("git", ["lfs", "version"], {
      maxBuffer: MAX_BUFFER,
    });
    return true;
  } catch {
    return false;
  }
}

export async function gitLfsTrackedPaths(
  cwd: string,
): Promise<Set<string>> {
  assertGitRepo(cwd);
  if (!(await gitLfsAvailable())) return new Set();
  try {
    const raw = await git(["lfs", "status", "--porcelain"], cwd);
    const paths = new Set<string>();
    for (const line of raw.split("\n")) {
      const match = line.match(/^\S+\s+(\S+)/);
      if (match) paths.add(match[1]!);
    }
    return paths;
  } catch {
    return new Set();
  }
}

/** Paths with `filter=lfs` in .gitattributes (for SCM badges). */
export async function gitPathsUsingLfs(
  cwd: string,
  paths: string[],
): Promise<Set<string>> {
  if (paths.length === 0 || !isGitRepo(cwd)) return new Set();
  try {
    const raw = await git(["check-attr", "filter", "--", ...paths], cwd);
    const lfs = new Set<string>();
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const match = trimmed.match(/^(.+): filter: (.*)$/);
      if (match?.[2] === "lfs") lfs.add(match[1]!);
    }
    return lfs;
  } catch {
    return new Set();
  }
}

// -- Config display --

export async function gitConfigDisplay(
  cwd: string,
): Promise<GitConfigDisplay> {
  assertGitRepo(cwd);
  const read = async (key: string) => {
    try {
      return (await git(["config", "--get", key], cwd)).trim();
    } catch {
      return "";
    }
  };
  const gpgSign = (await read("commit.gpgsign")) === "true";
  return {
    userName: await read("user.name"),
    userEmail: await read("user.email"),
    credentialHelper: await read("credential.helper"),
    gpgSign,
  };
}

export async function gitGpgSignEnabled(cwd: string): Promise<boolean> {
  const cfg = await gitConfigDisplay(cwd);
  return cfg.gpgSign;
}
