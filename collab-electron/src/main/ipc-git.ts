import { ipcMain } from "electron";
import type { AppConfig } from "./config";
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
  gitPush,
  gitPushSetUpstream,
  gitPull,
  gitFetch,
  gitRemotes,
  gitHasUpstream,
  gitBranches,
  gitCheckout,
  gitCreateBranch,
  gitDeleteBranch,
  gitStashSave,
  gitStashList,
  gitStashPop,
  gitStashApply,
  gitStashDrop,
  gitShowFile,
} from "./git-source-control";
import {
  getAvailableAgent,
  canGenerate,
  generateCommitMessageViaCli,
  generateCommitMessageViaApi,
  validateApiKey,
} from "./ai-commit";

export interface IpcGitContext {
  config: () => AppConfig;
}

function activeWorkspacePath(config: AppConfig): string {
  return config.workspaces[0] ?? "";
}

export function registerGitHandlers(ctx: IpcGitContext): void {
  ipcMain.handle("git:status", async () => {
    const cwd = activeWorkspacePath(ctx.config());
    if (!cwd) {
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
    return gitStatus(cwd);
  });

  ipcMain.handle(
    "git:stage",
    async (_event, paths: string[]) => {
      const cwd = activeWorkspacePath(ctx.config());
      if (!cwd) throw new Error("No active workspace");
      await gitStage(cwd, paths);
    },
  );

  ipcMain.handle(
    "git:unstage",
    async (_event, paths: string[]) => {
      const cwd = activeWorkspacePath(ctx.config());
      if (!cwd) throw new Error("No active workspace");
      await gitUnstage(cwd, paths);
    },
  );

  ipcMain.handle("git:stage-all", async () => {
    const cwd = activeWorkspacePath(ctx.config());
    if (!cwd) throw new Error("No active workspace");
    await gitStageAll(cwd);
  });

  ipcMain.handle("git:unstage-all", async () => {
    const cwd = activeWorkspacePath(ctx.config());
    if (!cwd) throw new Error("No active workspace");
    await gitUnstageAll(cwd);
  });

  ipcMain.handle(
    "git:discard",
    async (_event, paths: string[]) => {
      const cwd = activeWorkspacePath(ctx.config());
      if (!cwd) throw new Error("No active workspace");
      await gitDiscard(cwd, paths);
    },
  );

  ipcMain.handle("git:discard-all", async () => {
    const cwd = activeWorkspacePath(ctx.config());
    if (!cwd) throw new Error("No active workspace");
    await gitDiscardAll(cwd);
  });

  ipcMain.handle(
    "git:commit",
    async (_event, message: string) => {
      const cwd = activeWorkspacePath(ctx.config());
      if (!cwd) throw new Error("No active workspace");
      return gitCommit(cwd, message);
    },
  );

  ipcMain.handle(
    "git:diff",
    async (_event, filePath: string, cached: boolean) => {
      const cwd = activeWorkspacePath(ctx.config());
      if (!cwd) throw new Error("No active workspace");
      return gitDiff(cwd, filePath, cached);
    },
  );

  ipcMain.handle("git:generate-commit-message", async () => {
    const cwd = activeWorkspacePath(ctx.config());
    if (!cwd) throw new Error("No active workspace");

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
  });

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

  ipcMain.handle("git:push", async () => {
    const cwd = activeWorkspacePath(ctx.config());
    if (!cwd) throw new Error("No active workspace");
    await gitPush(cwd);
  });

  ipcMain.handle(
    "git:push-set-upstream",
    async (_event, remote: string, branch: string) => {
      const cwd = activeWorkspacePath(ctx.config());
      if (!cwd) throw new Error("No active workspace");
      await gitPushSetUpstream(cwd, remote, branch);
    },
  );

  ipcMain.handle("git:pull", async () => {
    const cwd = activeWorkspacePath(ctx.config());
    if (!cwd) throw new Error("No active workspace");
    await gitPull(cwd);
  });

  ipcMain.handle("git:fetch", async () => {
    const cwd = activeWorkspacePath(ctx.config());
    if (!cwd) throw new Error("No active workspace");
    await gitFetch(cwd);
  });

  ipcMain.handle("git:remotes", async () => {
    const cwd = activeWorkspacePath(ctx.config());
    if (!cwd) return [];
    return gitRemotes(cwd);
  });

  ipcMain.handle("git:has-upstream", async () => {
    const cwd = activeWorkspacePath(ctx.config());
    if (!cwd) return false;
    return gitHasUpstream(cwd);
  });

  ipcMain.handle("git:branches", async () => {
    const cwd = activeWorkspacePath(ctx.config());
    if (!cwd) return [];
    return gitBranches(cwd);
  });

  ipcMain.handle(
    "git:checkout",
    async (_event, branch: string) => {
      const cwd = activeWorkspacePath(ctx.config());
      if (!cwd) throw new Error("No active workspace");
      await gitCheckout(cwd, branch);
    },
  );

  ipcMain.handle(
    "git:create-branch",
    async (_event, name: string, startPoint?: string) => {
      const cwd = activeWorkspacePath(ctx.config());
      if (!cwd) throw new Error("No active workspace");
      await gitCreateBranch(cwd, name, startPoint);
    },
  );

  ipcMain.handle(
    "git:delete-branch",
    async (_event, name: string) => {
      const cwd = activeWorkspacePath(ctx.config());
      if (!cwd) throw new Error("No active workspace");
      await gitDeleteBranch(cwd, name);
    },
  );

  ipcMain.handle(
    "git:stash-save",
    async (_event, message?: string) => {
      const cwd = activeWorkspacePath(ctx.config());
      if (!cwd) throw new Error("No active workspace");
      await gitStashSave(cwd, message);
    },
  );

  ipcMain.handle("git:stash-list", async () => {
    const cwd = activeWorkspacePath(ctx.config());
    if (!cwd) return [];
    return gitStashList(cwd);
  });

  ipcMain.handle(
    "git:stash-pop",
    async (_event, index: number) => {
      const cwd = activeWorkspacePath(ctx.config());
      if (!cwd) throw new Error("No active workspace");
      await gitStashPop(cwd, index);
    },
  );

  ipcMain.handle(
    "git:stash-apply",
    async (_event, index: number) => {
      const cwd = activeWorkspacePath(ctx.config());
      if (!cwd) throw new Error("No active workspace");
      await gitStashApply(cwd, index);
    },
  );

  ipcMain.handle(
    "git:stash-drop",
    async (_event, index: number) => {
      const cwd = activeWorkspacePath(ctx.config());
      if (!cwd) throw new Error("No active workspace");
      await gitStashDrop(cwd, index);
    },
  );

  ipcMain.handle(
    "git:show-file",
    async (_event, ref: string, filePath: string) => {
      const cwd = activeWorkspacePath(ctx.config());
      if (!cwd) throw new Error("No active workspace");
      return gitShowFile(cwd, ref, filePath);
    },
  );
}
