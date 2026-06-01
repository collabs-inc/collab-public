#!/usr/bin/env bun
/**
 * Local HTTP bridge so the SCM screenshot harness can call real git helpers.
 */
import { createServer } from "node:http";
import { URL } from "node:url";

const PORT = Number(process.env.SCM_SCREENSHOT_GIT_BRIDGE_PORT ?? 9876);

const git = await import("../src/main/git-source-control.ts");

const STUBS = {
  aiCanGenerate: async () => ({ available: false }),
  aiGenerateCommitMessage: async () => "",
  onFsChanged: () => () => {},
  showContextMenu: async () => null,
  openGitDiff: async () => {},
  createGraphTile: async () => {},
  startReplay: async () => {},
  confirm: () => true,
  getConfig: async () => ({
    workspaces: [process.env.SCM_SCREENSHOT_WORKSPACE ?? ""],
  }),
};

const HANDLERS = {
  gitStatus: (cwd) => git.gitStatus(cwd),
  gitStage: (cwd, paths) => git.gitStage(cwd, paths),
  gitUnstage: (cwd, paths) => git.gitUnstage(cwd, paths),
  gitStageAll: (cwd) => git.gitStageAll(cwd),
  gitUnstageAll: (cwd) => git.gitUnstageAll(cwd),
  gitDiscard: (cwd, paths) => git.gitDiscard(cwd, paths),
  gitDiscardAll: (cwd) => git.gitDiscardAll(cwd),
  gitCommit: (cwd, message, options) => git.gitCommit(cwd, message, options),
  gitDiff: (cwd, filePath, cached) => git.gitDiff(cwd, filePath, cached),
  gitInit: (cwd) => git.gitInit(cwd),
  gitPush: (cwd, remote) => git.gitPush(cwd, remote),
  gitPushSetUpstream: (cwd, remote, branch) =>
    git.gitPushSetUpstream(cwd, remote, branch),
  gitPull: (cwd, remote) => git.gitPull(cwd, remote),
  gitFetch: (cwd, remote) => git.gitFetch(cwd, remote),
  gitRemotes: (cwd) => git.gitRemotes(cwd),
  gitHasUpstream: (cwd) => git.gitHasUpstream(cwd),
  gitBranches: (cwd) => git.gitBranches(cwd),
  gitTags: (cwd) => git.gitTags(cwd),
  gitCheckout: (cwd, branch) => git.gitCheckout(cwd, branch),
  gitCreateBranch: (cwd, name, startPoint) =>
    git.gitCreateBranch(cwd, name, startPoint),
  gitDeleteBranch: (cwd, name) => git.gitDeleteBranch(cwd, name),
  gitStashSave: (cwd, message) => git.gitStashSave(cwd, message),
  gitStashList: (cwd) => git.gitStashList(cwd),
  gitStashPop: (cwd, index) => git.gitStashPop(cwd, index),
  gitStashApply: (cwd, index) => git.gitStashApply(cwd, index),
  gitStashDrop: (cwd, index) => git.gitStashDrop(cwd, index),
  gitShowFile: (cwd, ref, path) => git.gitShowFile(cwd, ref, path),
  gitReadBlob: (cwd, ref, path) => git.gitReadBlob(cwd, ref, path),
  gitDiffRefs: (cwd, path, left, right) =>
    git.gitDiffRefs(cwd, path, left, right),
  gitRemoteAdd: (cwd, name, url) => git.gitRemoteAdd(cwd, name, url),
  gitRemoteRemove: (cwd, name) => git.gitRemoteRemove(cwd, name),
  gitRemoteRename: (cwd, oldName, newName) =>
    git.gitRemoteRename(cwd, oldName, newName),
  gitRemoteSetUrl: (cwd, name, url, push) =>
    git.gitRemoteSetUrl(cwd, name, url, push),
  gitCheckoutOurs: (cwd, paths) => git.gitCheckoutOurs(cwd, paths),
  gitCheckoutTheirs: (cwd, paths) => git.gitCheckoutTheirs(cwd, paths),
  gitAdd: (cwd, paths) => git.gitAdd(cwd, paths),
  gitMergeAbort: (cwd) => git.gitMergeAbort(cwd),
  gitMergeContinue: (cwd) => git.gitMergeContinue(cwd),
  gitCherryPickAbort: (cwd) => git.gitCherryPickAbort(cwd),
  gitCherryPickContinue: (cwd) => git.gitCherryPickContinue(cwd),
  gitRevertAbort: (cwd) => git.gitRevertAbort(cwd),
  gitRevertContinue: (cwd) => git.gitRevertContinue(cwd),
  gitLog: (cwd, options) => git.gitLog(cwd, options),
  gitLogFiles: (cwd, hash) => git.gitLogFiles(cwd, hash),
  gitRevertCommit: (cwd, hash) => git.gitRevertCommit(cwd, hash),
  gitCherryPick: (cwd, hash) => git.gitCherryPick(cwd, hash),
  gitReset: (cwd, mode, hash) => git.gitReset(cwd, mode, hash),
  gitMerge: (cwd, branch) => git.gitMerge(cwd, branch),
  gitRebase: (cwd, onto) => git.gitRebase(cwd, onto),
  gitRebaseContinue: (cwd) => git.gitRebaseContinue(cwd),
  gitRebaseAbort: (cwd) => git.gitRebaseAbort(cwd),
  gitRebaseSkip: (cwd) => git.gitRebaseSkip(cwd),
  gitRebaseTodoList: (cwd) => git.gitRebaseTodoList(cwd),
  gitRebaseTodoWrite: (cwd, items) => git.gitRebaseTodoWrite(cwd, items),
  gitRebaseStartInteractive: (cwd, onto, count) =>
    git.gitRebaseStartInteractive(cwd, onto, count),
  gitSubmoduleStatus: (cwd) => git.gitSubmoduleStatus(cwd),
  gitSubmoduleUpdate: (cwd, init, recursive) =>
    git.gitSubmoduleUpdate(cwd, init, recursive),
  gitWorktreeList: (cwd) => git.gitWorktreeList(cwd),
  gitConfigDisplay: (cwd) => git.gitConfigDisplay(cwd),
  gitGpgSignEnabled: (cwd) => git.gitGpgSignEnabled(cwd),
  gitGenerateCommitMessage: async () => "",
  gitDiffHunks: (cwd, path, cached) => git.gitDiffHunks(cwd, path, cached),
  gitCheckIgnore: (cwd, paths) => git.gitCheckIgnore(cwd, paths),
  gitPathsUsingLfs: (cwd, paths) => git.gitPathsUsingLfs(cwd, paths),
  gitLfsAvailable: () => git.gitLfsAvailable(),
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () =>
      resolve(Buffer.concat(chunks).toString("utf8")),
    );
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST" || req.url !== "/rpc") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  try {
    const body = JSON.parse(await readBody(req));
    const { method, args = [] } = body;
    const handler = HANDLERS[method] ?? STUBS[method];
    if (!handler) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Unknown method: ${method}` }));
      return;
    }
    const result = await handler(...args);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ result }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`SCM git bridge listening on http://127.0.0.1:${PORT}`);
});
