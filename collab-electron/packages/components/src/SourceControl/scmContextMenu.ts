import type { GitRepoState } from "@collab/shared/git-types";

export type ScmContextTarget =
  | { kind: "file"; section: string; path: string; absPath: string; cached?: boolean }
  | { kind: "stash"; index: number; message: string }
  | { kind: "section"; section: string }
  | { kind: "header" };

export async function showScmContextMenu(
  target: ScmContextTarget,
): Promise<string | null> {
  const items = buildScmContextMenuItems(target);
  if (items.length === 0) return null;
  return window.api.showContextMenu(items);
}

export function buildScmContextMenuItems(
  target: ScmContextTarget,
): Array<{ id: string; label: string; enabled?: boolean }> {
  if (target.kind === "file") {
    const isMerge = target.section === "merge";
    const items = [
      { id: "open-changes", label: "Open Changes" },
      { id: "open-file", label: "Open File" },
    ];
    if (target.section === "staged") {
      items.push({ id: "unstage", label: "Unstage" });
    } else if (target.section !== "merge") {
      items.push({ id: "stage", label: "Stage" });
    }
    if (isMerge) {
      items.push(
        { id: "accept-current", label: "Accept Current" },
        { id: "accept-incoming", label: "Accept Incoming" },
        { id: "mark-resolved", label: "Mark Resolved" },
      );
    } else if (target.section !== "untracked") {
      items.push({ id: "discard", label: "Discard Changes" });
    }
    items.push(
      { id: "compare-branch", label: "Compare with Branch…" },
      { id: "copy-path", label: "Copy Path" },
      { id: "reveal", label: "Reveal in Finder" },
    );
    return items;
  }

  if (target.kind === "stash") {
    return [
      { id: "stash-pop", label: "Pop" },
      { id: "stash-apply", label: "Apply" },
      { id: "stash-drop", label: "Drop" },
      { id: "copy-message", label: "Copy Message" },
    ];
  }

  if (target.kind === "section") {
    if (target.section === "staged") {
      return [{ id: "unstage-all", label: "Unstage All" }];
    }
    if (target.section === "changes") {
      return [
        { id: "stage-all", label: "Stage All" },
        { id: "discard-all", label: "Discard All" },
        { id: "stash-all", label: "Stash All" },
      ];
    }
    return [];
  }

  return [
    { id: "refresh", label: "Refresh" },
    { id: "pull", label: "Pull" },
    { id: "push", label: "Push" },
    { id: "fetch", label: "Fetch" },
    { id: "view-history", label: "View History" },
    { id: "open-gitignore", label: "Open .gitignore" },
  ];
}

export function repoStateLabel(state: GitRepoState): string {
  switch (state) {
    case "merging":
      return "Merge in progress";
    case "rebasing":
      return "Rebase in progress";
    case "interactive-rebase":
      return "Interactive rebase in progress";
    case "cherry-picking":
      return "Cherry-pick in progress";
    case "reverting":
      return "Revert in progress";
    default:
      return "";
  }
}
