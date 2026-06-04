import { useCallback, useEffect, useState } from "react";
import type { GitWorktree } from "@collab/shared/git-types";
import { ChangeSectionHeader } from "./ChangeSectionHeader";

interface WorktreesSectionProps {
  workspacePath: string;
  onError: (msg: string) => void;
}

export function WorktreesSection({
  workspacePath,
  onError,
}: WorktreesSectionProps) {
  const [trees, setTrees] = useState<GitWorktree[]>([]);

  const load = useCallback(async () => {
    try {
      const list = await window.api.gitWorktreeList(workspacePath);
      setTrees(list);
    } catch {
      setTrees([]);
    }
  }, [workspacePath]);

  useEffect(() => {
    void load();
  }, [load]);

  if (trees.length <= 1) return null;

  const addWorktree = async () => {
    const wtPath = await window.api.openFolder();
    if (!wtPath) return;
    const branch = window.prompt("Branch name for worktree:");
    if (!branch?.trim()) return;
    try {
      await window.api.gitWorktreeAdd(
        workspacePath,
        wtPath,
        branch.trim(),
      );
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to add worktree");
    }
  };

  return (
    <ChangeSectionHeader title="Worktrees" count={trees.length}>
      <button
        type="button"
        className="scm-worktree-add"
        onClick={() => void addWorktree()}
      >
        Add worktree…
      </button>
      {trees.map((w) => (
        <div key={w.path} className="scm-worktree-row">
          <span className="scm-worktree-branch">{w.branch || "(detached)"}</span>
          <span className="scm-worktree-path">{w.path}</span>
        </div>
      ))}
    </ChangeSectionHeader>
  );
}
