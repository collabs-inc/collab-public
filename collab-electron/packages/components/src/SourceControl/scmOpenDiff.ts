import type { GitDiffOpenParams } from "@collab/shared/git-types";

export function openScmFileDiff(
  workspacePath: string,
  relativePath: string,
  cached: boolean,
): void {
  const params: GitDiffOpenParams = {
    workspacePath,
    relativePath,
    left: { ref: "HEAD", label: "HEAD" },
    right: cached
      ? { ref: "index", label: "Index" }
      : { ref: "working", label: "Working Tree" },
  };
  window.api.openGitDiff(params);
}

export function openMergeConflictDiff(
  workspacePath: string,
  relativePath: string,
): void {
  window.api.openGitDiff({
    workspacePath,
    relativePath,
    left: { ref: ":1:", label: "Base" },
    right: { ref: "working", label: "Working Tree" },
    conflictStage: 1,
  });
}
