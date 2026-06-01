const BRIDGE =
  import.meta.env.VITE_SCM_GIT_BRIDGE ?? "http://127.0.0.1:9876";

export async function rpc<T>(method: string, ...args: unknown[]): Promise<T> {
  const res = await fetch(`${BRIDGE}/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, args }),
  });
  const json = (await res.json()) as { result?: T; error?: string };
  if (!res.ok || json.error) {
    throw new Error(json.error ?? `RPC ${method} failed`);
  }
  return json.result as T;
}

function bind<T extends (...a: never[]) => unknown>(method: string) {
  return (...args: Parameters<T>) => rpc(method, ...args);
}

export function installMockApi(workspacePath: string) {
  const w = window as Window & { api: Record<string, unknown> };
  w.api = {
    gitStatus: (p: string) => rpc("gitStatus", p),
    gitStage: bind("gitStage"),
    gitUnstage: bind("gitUnstage"),
    gitStageAll: (p: string) => rpc("gitStageAll", p),
    gitUnstageAll: (p: string) => rpc("gitUnstageAll", p),
    gitDiscard: bind("gitDiscard"),
    gitDiscardAll: (p: string) => rpc("gitDiscardAll", p),
    gitCommit: bind("gitCommit"),
    gitDiff: bind("gitDiff"),
    gitInit: (p: string) => rpc("gitInit", p),
    gitPush: bind("gitPush"),
    gitPushSetUpstream: bind("gitPushSetUpstream"),
    gitPull: bind("gitPull"),
    gitFetch: bind("gitFetch"),
    gitRemotes: (p: string) => rpc("gitRemotes", p),
    gitHasUpstream: (p: string) => rpc("gitHasUpstream", p),
    gitBranches: (p: string) => rpc("gitBranches", p),
    gitTags: (p: string) => rpc("gitTags", p),
    gitCheckout: bind("gitCheckout"),
    gitCreateBranch: bind("gitCreateBranch"),
    gitDeleteBranch: bind("gitDeleteBranch"),
    gitStashSave: bind("gitStashSave"),
    gitStashList: (p: string) => rpc("gitStashList", p),
    gitStashPop: bind("gitStashPop"),
    gitStashApply: bind("gitStashApply"),
    gitStashDrop: bind("gitStashDrop"),
    gitShowFile: bind("gitShowFile"),
    gitReadBlob: bind("gitReadBlob"),
    gitDiffRefs: bind("gitDiffRefs"),
    gitRemoteAdd: bind("gitRemoteAdd"),
    gitRemoteRemove: bind("gitRemoteRemove"),
    gitRemoteRename: bind("gitRemoteRename"),
    gitRemoteSetUrl: bind("gitRemoteSetUrl"),
    gitCheckoutOurs: bind("gitCheckoutOurs"),
    gitCheckoutTheirs: bind("gitCheckoutTheirs"),
    gitAdd: bind("gitAdd"),
    gitMergeAbort: (p?: string) => rpc("gitMergeAbort", p ?? workspacePath),
    gitMergeContinue: (p?: string) =>
      rpc("gitMergeContinue", p ?? workspacePath),
    gitCherryPickAbort: (p?: string) =>
      rpc("gitCherryPickAbort", p ?? workspacePath),
    gitCherryPickContinue: (p?: string) =>
      rpc("gitCherryPickContinue", p ?? workspacePath),
    gitRevertAbort: (p?: string) =>
      rpc("gitRevertAbort", p ?? workspacePath),
    gitRevertContinue: (p?: string) =>
      rpc("gitRevertContinue", p ?? workspacePath),
    gitLog: bind("gitLog"),
    gitLogFiles: bind("gitLogFiles"),
    gitRevertCommit: bind("gitRevertCommit"),
    gitCherryPick: bind("gitCherryPick"),
    gitReset: bind("gitReset"),
    gitMerge: bind("gitMerge"),
    gitRebase: bind("gitRebase"),
    gitRebaseContinue: (p?: string) =>
      rpc("gitRebaseContinue", p ?? workspacePath),
    gitRebaseAbort: (p?: string) =>
      rpc("gitRebaseAbort", p ?? workspacePath),
    gitRebaseSkip: (p?: string) =>
      rpc("gitRebaseSkip", p ?? workspacePath),
    gitRebaseTodoList: (p?: string) =>
      rpc("gitRebaseTodoList", p ?? workspacePath),
    gitRebaseTodoWrite: bind("gitRebaseTodoWrite"),
    gitRebaseStartInteractive: bind("gitRebaseStartInteractive"),
    gitSubmoduleStatus: (p?: string) =>
      rpc("gitSubmoduleStatus", p ?? workspacePath),
    gitSubmoduleUpdate: bind("gitSubmoduleUpdate"),
    gitWorktreeList: (p?: string) =>
      rpc("gitWorktreeList", p ?? workspacePath),
    gitConfigDisplay: (p?: string) =>
      rpc("gitConfigDisplay", p ?? workspacePath),
    gitGpgSignEnabled: (p?: string) =>
      rpc("gitGpgSignEnabled", p ?? workspacePath),
    gitGenerateCommitMessage: () => rpc("gitGenerateCommitMessage"),
    gitDiffHunks: bind("gitDiffHunks"),
    gitCheckIgnore: bind("gitCheckIgnore"),
    gitPathsUsingLfs: bind("gitPathsUsingLfs"),
    gitLfsAvailable: () => rpc("gitLfsAvailable"),
    aiCanGenerate: () => rpc("aiCanGenerate"),
    onFsChanged: () => () => {},
    showContextMenu: () => rpc("showContextMenu"),
    openGitDiff: () => rpc("openGitDiff"),
    createGraphTile: () => rpc("createGraphTile"),
    startReplay: () => rpc("startReplay"),
    getConfig: () =>
      rpc("getConfig").then((c: { workspaces?: string[] }) => ({
        workspaces: [workspacePath],
      })),
    confirm: () => true,
  };
}
