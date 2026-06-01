/**
 * Smoke tests for git-source-control against repo-root fixtures.
 * Run: bun test src/main/git-source-control.fixture.test.ts
 * Prerequisite: ./fixtures/git/setup-all.sh from repository root.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../",
);
const FIXTURES = join(REPO_ROOT, "fixtures/git");

const {
  isGitRepo,
  gitStatus,
  gitRepoState,
  gitStage,
  gitUnstage,
  gitCommit,
  gitBranches,
  gitTags,
  gitRemotes,
  gitStashList,
  gitLog,
  gitRebaseTodoList,
  gitSubmoduleStatus,
  gitWorktreeList,
  gitDiff,
  gitHasUpstream,
} = await import("./git-source-control.ts");

function fixturePath(name: string): string {
  const p = join(FIXTURES, name);
  if (!existsSync(p)) {
    throw new Error(
      `Missing fixture ${name}. Run ./fixtures/git/setup-all.sh from repo root.`,
    );
  }
  return p;
}

describe("fixture repos exist", () => {
  test("setup-all outputs are present", () => {
    for (const name of [
      "dirty-worktree",
      "merge-conflict",
      "rebase-todo",
      "submodule",
    ]) {
      expect(isGitRepo(fixturePath(name))).toBe(true);
    }
  });
});

describe("dirty-worktree", () => {
  const cwd = () => fixturePath("dirty-worktree");

  test("gitStatus: staged, unstaged, untracked, ahead", async () => {
    const s = await gitStatus(cwd());
    expect(s.isGitRepo).toBe(true);
    expect(s.branch).toBe("main");
    expect(s.ahead).toBe(2);
    expect(s.staged.some((f) => f.path === "README.md")).toBe(true);
    expect(s.unstaged.some((f) => f.path === "src/app.ts")).toBe(true);
    expect(s.untracked.some((f) => f.path === "notes.txt")).toBe(true);
    expect(s.repoState).toBe("clean");
  });

  test("gitRepoState: clean", () => {
    expect(gitRepoState(cwd())).toBe("clean");
  });

  test("gitBranches includes main and feature/login", async () => {
    const branches = await gitBranches(cwd());
    const names = branches.map((b) => b.name);
    expect(names).toContain("main");
    expect(names).toContain("feature/login");
  });

  test("gitTags lists v1.0.0", async () => {
    const tags = await gitTags(cwd());
    expect(tags.some((t) => t.name === "v1.0.0")).toBe(true);
  });

  test("gitRemotes lists origin", async () => {
    const remotes = await gitRemotes(cwd());
    expect(remotes.some((r) => r.name === "origin")).toBe(true);
  });

  test("gitStashList has entries", async () => {
    const stashes = await gitStashList(cwd());
    expect(stashes.length).toBeGreaterThanOrEqual(2);
  });

  test("gitHasUpstream on main", async () => {
    expect(await gitHasUpstream(cwd())).toBe(true);
  });

  test("gitLog returns commits", async () => {
    const log = await gitLog(cwd(), { limit: 5 });
    expect(log.length).toBeGreaterThan(0);
    expect(log[0]?.hash).toMatch(/^[a-f0-9]{40}$/);
  });

  test("gitDiff on unstaged file", async () => {
    const diff = await gitDiff(cwd(), "src/app.ts", false);
    expect(diff.length).toBeGreaterThan(0);
  });
});

describe("merge-conflict", () => {
  const cwd = () => fixturePath("merge-conflict");

  test("gitRepoState: merging", () => {
    expect(gitRepoState(cwd())).toBe("merging");
  });

  test("gitStatus reports unmerged base.txt", async () => {
    const s = await gitStatus(cwd());
    expect(s.repoState).toBe("merging");
    expect(s.merge.some((f) => f.path === "base.txt")).toBe(true);
  });
});

describe("rebase-todo", () => {
  const cwd = () => fixturePath("rebase-todo");

  test("gitRepoState: interactive-rebase", () => {
    expect(gitRepoState(cwd())).toBe("interactive-rebase");
  });

  test("gitRebaseTodoList parses todo (backup when paused at break)", async () => {
    const items = await gitRebaseTodoList(cwd());
    expect(items.length).toBe(2);
    expect(items.every((i) => i.action === "pick")).toBe(true);
    expect(items[0]?.hash).toMatch(/^[a-f0-9]+$/);
    expect(items.some((i) => i.subject.includes("feature: v3"))).toBe(true);
  });
});

describe("submodule", () => {
  const cwd = () => fixturePath("submodule");

  test("gitSubmoduleStatus lists child", async () => {
    const subs = await gitSubmoduleStatus(cwd());
    expect(subs.some((s) => s.path === "child")).toBe(true);
  });

  test("gitWorktreeList has main worktree", async () => {
    const trees = await gitWorktreeList(cwd());
    expect(trees.length).toBeGreaterThanOrEqual(1);
  });
});

describe("mutating git ops (temp repo)", () => {
  let tmp: string;

  async function gitInRepo(args: string[]): Promise<void> {
    const proc = Bun.spawn(["git", ...args], {
      cwd: tmp,
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    if (code !== 0) {
      const err = await new Response(proc.stderr).text();
      throw new Error(err.trim() || `git ${args.join(" ")} failed`);
    }
  }

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), "git-scm-smoke-"));
    await gitInRepo(["init", "-b", "main"]);
    await gitInRepo(["config", "user.email", "test@example.com"]);
    await gitInRepo(["config", "user.name", "SCM Smoke"]);
    const f = join(tmp, "file.txt");
    await Bun.write(f, "v1\n");
    await gitInRepo(["add", "file.txt"]);
    await gitInRepo(["commit", "-m", "initial"]);
    await Bun.write(f, "v2\n");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("stage, unstage, commit", async () => {
    let s = await gitStatus(tmp);
    expect(s.unstaged.some((f) => f.path === "file.txt")).toBe(true);

    await gitStage(tmp, ["file.txt"]);
    s = await gitStatus(tmp);
    expect(s.staged.some((f) => f.path === "file.txt")).toBe(true);

    await gitUnstage(tmp, ["file.txt"]);
    s = await gitStatus(tmp);
    expect(s.unstaged.some((f) => f.path === "file.txt")).toBe(true);

    await gitStage(tmp, ["file.txt"]);
    await gitCommit(tmp, "second commit");
    s = await gitStatus(tmp);
    expect(s.staged).toHaveLength(0);
    expect(s.unstaged).toHaveLength(0);
  });
});
