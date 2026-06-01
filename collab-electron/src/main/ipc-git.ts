import { ipcMain } from "electron";
import { realpathSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "./config";
import type { GitDiffOpenParams } from "@collab/shared/git-types";
import {
  gitStatus,
  gitStage,
  gitUnstage,
  gitStageAll,
  gitUnstageAll,
  gitDiscard,
  gitDiscardAll,
  gitCommit,
  gitDiff,
  gitDiffAll,
  gitDiffCached,
  gitInit,
  gitPush,
  gitPushSetUpstream,
  gitPull,
  gitFetch,
  gitRemotes,
  gitHasUpstream,
  gitBranches,
  gitTags,
  gitCheckout,
  gitCreateBranch,
  gitDeleteBranch,
  gitStashSave,
  gitStashList,
  gitStashPop,
  gitStashApply,
  gitStashDrop,
  gitShowFile,
  gitReadBlob,
  gitDiffRefs,
  gitClone,
  gitRemoteAdd,
  gitRemoteRemove,
  gitRemoteRename,
  gitRemoteSetUrl,
  gitCheckoutOurs,
  gitCheckoutTheirs,
  gitAdd,
  gitMergeAbort,
  gitMergeContinue,
  gitCherryPickAbort,
  gitCherryPickContinue,
  gitRevertAbort,
  gitRevertContinue,
  gitLog,
  gitLogFiles,
  gitRevert,
  gitCherryPick,
  gitReset,
  gitMerge,
  gitRebase,
  gitRebaseContinue,
  gitRebaseAbort,
  gitRebaseSkip,
  gitRebaseTodoList,
  gitRebaseTodoWrite,
  gitRebaseStartInteractive,
  gitSubmoduleStatus,
  gitSubmoduleUpdate,
  gitWorktreeList,
  gitWorktreeAdd,
  gitWorktreeRemove,
  gitDiffHunks,
  gitApplyCached,
  gitApplyWorking,
  gitCheckIgnore,
  gitConfigDisplay,
  gitGpgSignEnabled,
} from "./git-source-control";
import {
  getAvailableAgent,
  canGenerate,
  generateCommitMessageViaCli,
  generateCommitMessageViaApi,
  validateApiKey,
} from "./ai-commit";
import {
  initWorkspaceFiles,
  startSingleWorkspaceServices,
} from "./ipc-workspace";
import { saveConfig } from "./config";

export interface IpcGitContext {
  config: () => AppConfig;
  forwardToWebview?: (
    target: string,
    channel: string,
    ...args: unknown[]
  ) => void;
  onWorkspaceAdded?: (path: string) => void;
  setFileFilter?: (f: unknown) => void;
  trackEvent?: (
    name: string,
    props?: Record<string, unknown>,
  ) => void;
}

function resolveWorkspacePath(
  config: AppConfig,
  workspacePath?: string,
): string {
  if (workspacePath?.trim()) {
    return workspacePath;
  }
  return config.workspaces[0] ?? "";
}

function requireWorkspace(
  config: AppConfig,
  workspacePath?: string,
): string {
  const cwd = resolveWorkspacePath(config, workspacePath);
  if (!cwd) throw new Error("No active workspace");
  return cwd;
}

const emptyStatus = {
  branch: "",
  ahead: 0,
  behind: 0,
  staged: [],
  unstaged: [],
  untracked: [],
  merge: [],
  isGitRepo: false,
  hasCommits: false,
  repoState: "clean" as const,
};

function forwardGitDiff(
  ctx: IpcGitContext,
  params: GitDiffOpenParams,
): void {
  ctx.forwardToWebview?.("viewer", "git-diff-open", params);
}

export function registerGitHandlers(ctx: IpcGitContext): void {
  ipcMain.handle(
    "git:status",
    async (_event, workspacePath?: string) => {
      const cwd = resolveWorkspacePath(ctx.config(), workspacePath);
      if (!cwd) return emptyStatus;
      return gitStatus(cwd);
    },
  );

  ipcMain.handle(
    "git:stage",
    async (_event, workspacePath: string, paths: string[]) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitStage(cwd, paths);
    },
  );

  ipcMain.handle(
    "git:unstage",
    async (_event, workspacePath: string, paths: string[]) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitUnstage(cwd, paths);
    },
  );

  ipcMain.handle(
    "git:stage-all",
    async (_event, workspacePath?: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitStageAll(cwd);
    },
  );

  ipcMain.handle(
    "git:unstage-all",
    async (_event, workspacePath?: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitUnstageAll(cwd);
    },
  );

  ipcMain.handle(
    "git:discard",
    async (_event, workspacePath: string, paths: string[]) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitDiscard(cwd, paths);
    },
  );

  ipcMain.handle(
    "git:discard-all",
    async (_event, workspacePath?: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitDiscardAll(cwd);
    },
  );

  ipcMain.handle(
    "git:commit",
    async (
      _event,
      workspacePath: string,
      message: string,
      options?: { amend?: boolean; sign?: boolean },
    ) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      return gitCommit(cwd, message, options);
    },
  );

  ipcMain.handle(
    "git:diff",
    async (
      _event,
      workspacePath: string,
      filePath: string,
      cached: boolean,
    ) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      return gitDiff(cwd, filePath, cached);
    },
  );

  ipcMain.handle(
    "git:generate-commit-message",
    async (_event, workspacePath?: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);

      let diff = await gitDiffCached(cwd);
      if (!diff.trim()) {
        diff = await gitDiffAll(cwd);
      }
      if (!diff.trim()) {
        const status = await gitStatus(cwd);
        if (status.untracked.length > 0 || status.unstaged.length > 0) {
          await gitStageAll(cwd);
          diff = await gitDiffCached(cwd);
          await gitUnstageAll(cwd);
        }
      }
      if (!diff.trim()) {
        throw new Error("No changes found to generate a message from.");
      }

      const agent = getAvailableAgent();
      if (agent) {
        return generateCommitMessageViaCli(agent, diff);
      }

      const apiKey = ctx.config().ui?.["ai.apiKey"];
      if (typeof apiKey === "string" && apiKey) {
        return generateCommitMessageViaApi(apiKey, diff);
      }

      throw new Error(
        "No AI agent found. Install Claude Code, Codex, or Gemini CLI — or add an API key in Settings → AI.",
      );
    },
  );

  ipcMain.handle(
    "ai:validate-key",
    async (_event, key: string) => {
      return { valid: await validateApiKey(key) };
    },
  );

  ipcMain.handle("ai:has-key", () => {
    const key = ctx.config().ui?.["ai.apiKey"];
    return typeof key === "string" && key.length > 0;
  });

  ipcMain.handle("ai:can-generate", () => {
    const apiKey = ctx.config().ui?.["ai.apiKey"];
    return canGenerate(typeof apiKey === "string" ? apiKey : undefined);
  });

  ipcMain.handle(
    "git:init",
    async (_event, workspacePath?: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitInit(cwd);
    },
  );

  ipcMain.handle(
    "git:push",
    async (_event, workspacePath?: string, remote?: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitPush(cwd, remote);
    },
  );

  ipcMain.handle(
    "git:push-set-upstream",
    async (
      _event,
      workspacePath: string,
      remote: string,
      branch: string,
    ) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitPushSetUpstream(cwd, remote, branch);
    },
  );

  ipcMain.handle(
    "git:pull",
    async (_event, workspacePath?: string, remote?: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitPull(cwd, remote);
    },
  );

  ipcMain.handle(
    "git:fetch",
    async (_event, workspacePath?: string, remote?: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitFetch(cwd, remote);
    },
  );

  ipcMain.handle(
    "git:remotes",
    async (_event, workspacePath?: string) => {
      const cwd = resolveWorkspacePath(ctx.config(), workspacePath);
      if (!cwd) return [];
      return gitRemotes(cwd);
    },
  );

  ipcMain.handle(
    "git:has-upstream",
    async (_event, workspacePath?: string) => {
      const cwd = resolveWorkspacePath(ctx.config(), workspacePath);
      if (!cwd) return false;
      return gitHasUpstream(cwd);
    },
  );

  ipcMain.handle(
    "git:branches",
    async (_event, workspacePath?: string) => {
      const cwd = resolveWorkspacePath(ctx.config(), workspacePath);
      if (!cwd) return [];
      return gitBranches(cwd);
    },
  );

  ipcMain.handle(
    "git:tags",
    async (_event, workspacePath?: string) => {
      const cwd = resolveWorkspacePath(ctx.config(), workspacePath);
      if (!cwd) return [];
      return gitTags(cwd);
    },
  );

  ipcMain.handle(
    "git:checkout",
    async (_event, workspacePath: string, branch: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitCheckout(cwd, branch);
    },
  );

  ipcMain.handle(
    "git:create-branch",
    async (
      _event,
      workspacePath: string,
      name: string,
      startPoint?: string,
    ) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitCreateBranch(cwd, name, startPoint);
    },
  );

  ipcMain.handle(
    "git:delete-branch",
    async (_event, workspacePath: string, name: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitDeleteBranch(cwd, name);
    },
  );

  ipcMain.handle(
    "git:stash-save",
    async (_event, workspacePath: string, message?: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitStashSave(cwd, message);
    },
  );

  ipcMain.handle(
    "git:stash-list",
    async (_event, workspacePath?: string) => {
      const cwd = resolveWorkspacePath(ctx.config(), workspacePath);
      if (!cwd) return [];
      return gitStashList(cwd);
    },
  );

  ipcMain.handle(
    "git:stash-pop",
    async (_event, workspacePath: string, index: number) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitStashPop(cwd, index);
    },
  );

  ipcMain.handle(
    "git:stash-apply",
    async (_event, workspacePath: string, index: number) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitStashApply(cwd, index);
    },
  );

  ipcMain.handle(
    "git:stash-drop",
    async (_event, workspacePath: string, index: number) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitStashDrop(cwd, index);
    },
  );

  ipcMain.handle(
    "git:show-file",
    async (
      _event,
      workspacePath: string,
      ref: string,
      filePath: string,
    ) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      return gitShowFile(cwd, ref, filePath);
    },
  );

  ipcMain.handle(
    "git:read-blob",
    async (
      _event,
      workspacePath: string,
      ref: string,
      filePath: string,
    ) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      return gitReadBlob(cwd, ref, filePath);
    },
  );

  ipcMain.handle(
    "git:diff-refs",
    async (
      _event,
      workspacePath: string,
      leftRef: string,
      rightRef: string,
      filePath: string,
    ) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      return gitDiffRefs(cwd, leftRef, rightRef, filePath);
    },
  );

  ipcMain.on(
    "git:open-diff",
    (_event, params: GitDiffOpenParams) => {
      forwardGitDiff(ctx, params);
    },
  );

  ipcMain.handle(
    "git:clone",
    async (
      _event,
      url: string,
      parentDir: string,
      options?: { branch?: string; depth?: number },
    ) => {
      if (!url.trim()) throw new Error("Clone URL is required");
      if (!parentDir.trim()) throw new Error("Parent directory is required");
      const result = await gitClone(url.trim(), parentDir, options);
      const chosen = realpathSync(result.path);
      const appConfig = ctx.config();

      if (!appConfig.workspaces.includes(chosen)) {
        const collabDir = join(chosen, ".collaborator");
        const isNew = !existsSync(collabDir);
        if (isNew) initWorkspaceFiles(chosen);
        appConfig.workspaces.push(chosen);
        saveConfig(appConfig);
        ctx.trackEvent?.("workspace_added", { is_new: isNew, cloned: true });
        startSingleWorkspaceServices(chosen, (f) => {
          ctx.setFileFilter?.(f);
        });
        ctx.forwardToWebview?.("nav", "workspace-added", chosen);
      }

      return result;
    },
  );

  ipcMain.handle(
    "git:remote-add",
    async (
      _event,
      workspacePath: string,
      name: string,
      url: string,
    ) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitRemoteAdd(cwd, name, url);
    },
  );

  ipcMain.handle(
    "git:remote-remove",
    async (_event, workspacePath: string, name: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitRemoteRemove(cwd, name);
    },
  );

  ipcMain.handle(
    "git:remote-rename",
    async (
      _event,
      workspacePath: string,
      oldName: string,
      newName: string,
    ) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitRemoteRename(cwd, oldName, newName);
    },
  );

  ipcMain.handle(
    "git:remote-set-url",
    async (
      _event,
      workspacePath: string,
      name: string,
      url: string,
      push?: boolean,
    ) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitRemoteSetUrl(cwd, name, url, push);
    },
  );

  ipcMain.handle(
    "git:checkout-ours",
    async (_event, workspacePath: string, paths: string[]) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitCheckoutOurs(cwd, paths);
    },
  );

  ipcMain.handle(
    "git:checkout-theirs",
    async (_event, workspacePath: string, paths: string[]) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitCheckoutTheirs(cwd, paths);
    },
  );

  ipcMain.handle(
    "git:add",
    async (_event, workspacePath: string, paths: string[]) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitAdd(cwd, paths);
    },
  );

  ipcMain.handle(
    "git:merge-abort",
    async (_event, workspacePath?: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitMergeAbort(cwd);
    },
  );

  ipcMain.handle(
    "git:merge-continue",
    async (_event, workspacePath?: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitMergeContinue(cwd);
    },
  );

  ipcMain.handle(
    "git:cherry-pick-abort",
    async (_event, workspacePath?: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitCherryPickAbort(cwd);
    },
  );

  ipcMain.handle(
    "git:cherry-pick-continue",
    async (_event, workspacePath?: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitCherryPickContinue(cwd);
    },
  );

  ipcMain.handle(
    "git:revert-abort",
    async (_event, workspacePath?: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitRevertAbort(cwd);
    },
  );

  ipcMain.handle(
    "git:revert-continue",
    async (_event, workspacePath?: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitRevertContinue(cwd);
    },
  );

  ipcMain.handle(
    "git:log",
    async (
      _event,
      workspacePath?: string,
      options?: { maxCount?: number; ref?: string },
    ) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      return gitLog(cwd, options);
    },
  );

  ipcMain.handle(
    "git:log-files",
    async (_event, workspacePath: string, hash: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      return gitLogFiles(cwd, hash);
    },
  );

  ipcMain.handle(
    "git:revert",
    async (_event, workspacePath: string, hash: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitRevert(cwd, hash);
    },
  );

  ipcMain.handle(
    "git:cherry-pick",
    async (_event, workspacePath: string, hash: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitCherryPick(cwd, hash);
    },
  );

  ipcMain.handle(
    "git:reset",
    async (
      _event,
      workspacePath: string,
      mode: "soft" | "mixed" | "hard",
      ref: string,
    ) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitReset(cwd, mode, ref);
    },
  );

  ipcMain.handle(
    "git:merge",
    async (_event, workspacePath: string, branch: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitMerge(cwd, branch);
    },
  );

  ipcMain.handle(
    "git:rebase",
    async (_event, workspacePath: string, onto: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitRebase(cwd, onto);
    },
  );

  ipcMain.handle(
    "git:rebase-continue",
    async (_event, workspacePath?: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitRebaseContinue(cwd);
    },
  );

  ipcMain.handle(
    "git:rebase-abort",
    async (_event, workspacePath?: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitRebaseAbort(cwd);
    },
  );

  ipcMain.handle(
    "git:rebase-skip",
    async (_event, workspacePath?: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitRebaseSkip(cwd);
    },
  );

  ipcMain.handle(
    "git:rebase-todo-list",
    async (_event, workspacePath?: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      return gitRebaseTodoList(cwd);
    },
  );

  ipcMain.handle(
    "git:rebase-todo-write",
    async (
      _event,
      workspacePath: string,
      items: Parameters<typeof gitRebaseTodoWrite>[1],
    ) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitRebaseTodoWrite(cwd, items);
    },
  );

  ipcMain.handle(
    "git:rebase-start-interactive",
    async (
      _event,
      workspacePath: string,
      onto: string | null,
      count: number,
    ) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitRebaseStartInteractive(cwd, onto, count);
    },
  );

  ipcMain.handle(
    "git:submodule-status",
    async (_event, workspacePath?: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      return gitSubmoduleStatus(cwd);
    },
  );

  ipcMain.handle(
    "git:submodule-update",
    async (
      _event,
      workspacePath?: string,
      init?: boolean,
      recursive?: boolean,
    ) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitSubmoduleUpdate(cwd, init, recursive);
    },
  );

  ipcMain.handle(
    "git:worktree-list",
    async (_event, workspacePath?: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      return gitWorktreeList(cwd);
    },
  );

  ipcMain.handle(
    "git:worktree-add",
    async (
      _event,
      workspacePath: string,
      wtPath: string,
      branch: string,
    ) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitWorktreeAdd(cwd, wtPath, branch);
    },
  );

  ipcMain.handle(
    "git:worktree-remove",
    async (_event, workspacePath: string, wtPath: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitWorktreeRemove(cwd, wtPath);
    },
  );

  ipcMain.handle(
    "git:diff-hunks",
    async (
      _event,
      workspacePath: string,
      filePath: string,
      cached?: boolean,
    ) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      return gitDiffHunks(cwd, filePath, cached);
    },
  );

  ipcMain.handle(
    "git:apply-cached",
    async (_event, workspacePath: string, patch: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitApplyCached(cwd, patch);
    },
  );

  ipcMain.handle(
    "git:apply-working",
    async (
      _event,
      workspacePath: string,
      patch: string,
      reverse?: boolean,
    ) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      await gitApplyWorking(cwd, patch, reverse);
    },
  );

  ipcMain.handle(
    "git:check-ignore",
    async (_event, workspacePath: string, paths: string[]) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      return gitCheckIgnore(cwd, paths);
    },
  );

  ipcMain.handle(
    "git:config-display",
    async (_event, workspacePath?: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      return gitConfigDisplay(cwd);
    },
  );

  ipcMain.handle(
    "git:gpg-sign-enabled",
    async (_event, workspacePath?: string) => {
      const cwd = requireWorkspace(ctx.config(), workspacePath);
      return gitGpgSignEnabled(cwd);
    },
  );
}
