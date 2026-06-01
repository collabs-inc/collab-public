import type { FixtureData, ScenarioPayload } from "./types";

const noop = () => undefined;
const noopUnsub = () => noop;
const asyncVoid = async () => {};
const asyncNull = async () => null;

function buildMock(payload: ScenarioPayload) {
  const { status, workspacePath } = payload;

  return {
    gitStatus: async () => status,
    gitHasUpstream: async () => payload.hasUpstream,
    gitBranches: async () => payload.branches,
    gitTags: async () => payload.tags,
    gitRemotes: async () => payload.remotes,
    gitStashList: async () => payload.stashes,
    gitLog: async () => payload.log,
    gitLogFiles: async () => [],
    gitRebaseTodoList: async () => payload.rebaseTodo,
    gitRebaseTodoWrite: asyncVoid,
    gitSubmoduleStatus: async () => payload.submodules,
    gitGpgSignEnabled: async () => payload.gpgSignEnabled,
    gitConfigDisplay: async () => payload.configDisplay,
    aiCanGenerate: async () => payload.aiCanGenerate,
    gitStage: asyncVoid,
    gitUnstage: asyncVoid,
    gitStageAll: asyncVoid,
    gitUnstageAll: asyncVoid,
    gitDiscard: asyncVoid,
    gitDiscardAll: asyncVoid,
    gitCommit: async () => ({ hash: "abc1234" }),
    gitPush: asyncVoid,
    gitPull: asyncVoid,
    gitFetch: asyncVoid,
    gitInit: asyncVoid,
    gitCheckout: asyncVoid,
    gitCreateBranch: asyncVoid,
    gitDeleteBranch: asyncVoid,
    gitStashSave: asyncVoid,
    gitStashPop: asyncVoid,
    gitStashApply: asyncVoid,
    gitStashDrop: asyncVoid,
    gitMergeContinue: asyncVoid,
    gitMergeAbort: asyncVoid,
    gitCherryPickContinue: asyncVoid,
    gitCherryPickAbort: asyncVoid,
    gitRevertContinue: asyncVoid,
    gitRevertAbort: asyncVoid,
    gitRebaseContinue: asyncVoid,
    gitRebaseAbort: asyncVoid,
    gitRebaseSkip: asyncVoid,
    gitCheckoutOurs: asyncVoid,
    gitCheckoutTheirs: asyncVoid,
    gitAdd: asyncVoid,
    gitMerge: asyncVoid,
    gitRebase: asyncVoid,
    gitPushSetUpstream: asyncVoid,
    gitGenerateCommitMessage: async () => ({
      message: "feat: example commit message",
      model: "fixture",
    }),
    gitSubmoduleUpdate: asyncVoid,
    gitWorktreeList: async () => [],
    gitWorktreeAdd: asyncVoid,
    gitRemoteAdd: asyncVoid,
    gitRemoteRemove: asyncVoid,
    gitClone: async () => ({ path: workspacePath }),
    gitRevertCommit: asyncVoid,
    gitCherryPick: asyncVoid,
    gitReset: asyncVoid,
    gitReadBlob: async (_ws: string, ref: string) =>
      ref === "HEAD" ? payload.monacoOriginal ?? "" : payload.monacoModified ?? "",
    gitDiff: async () => "",
    openGitDiff: noop,
    openFolder: asyncNull,
    revealInFinder: noop,
    showContextMenu: async () => null,
    createGraphTile: noop,
    startReplay: noop,
    onFsChanged: noopUnsub,
    getConfig: async () => ({ workspaces: [workspacePath] }),
    confirm: (msg: string) => window.confirm(msg),
  };
}

export function installMockApi(
  allData: FixtureData,
  scenario: string,
): ScenarioPayload {
  const payload = allData[scenario];
  if (!payload) {
    throw new Error(`Unknown scenario: ${scenario}`);
  }
  (window as unknown as { api: ReturnType<typeof buildMock> }).api =
    buildMock({
      ...payload,
      monacoOriginal: allData.monacoDiff?.original,
      monacoModified: allData.monacoDiff?.modified,
    });
  return payload;
}
