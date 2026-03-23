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
      const status = await gitStatus(cwd);
      if (status.unstaged.length > 0 || status.untracked.length > 0) {
        diff = await gitDiffAll(cwd);
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
}
