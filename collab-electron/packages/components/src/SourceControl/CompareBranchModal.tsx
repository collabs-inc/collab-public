import { useEffect, useState } from "react";
import { X } from "@phosphor-icons/react";
import type { GitBranch } from "@collab/shared/git-types";

interface CompareBranchModalProps {
  workspacePath: string;
  relativePath: string;
  open: boolean;
  onClose: () => void;
}

export function CompareBranchModal({
  workspacePath,
  relativePath,
  open,
  onClose,
}: CompareBranchModalProps) {
  const [branches, setBranches] = useState<GitBranch[]>([]);

  useEffect(() => {
    if (!open) return;
    window.api
      .gitBranches(workspacePath)
      .then((list) =>
        setBranches(list.filter((b) => !b.isRemote && !b.current)),
      )
      .catch(() => setBranches([]));
  }, [open, workspacePath]);

  if (!open) return null;

  const compare = (branchName: string) => {
    window.api.openGitDiff({
      workspacePath,
      relativePath,
      left: { ref: branchName, label: branchName },
      right: { ref: "working", label: "Working Tree" },
    });
    onClose();
  };

  return (
    <div className="scm-modal-overlay" onClick={onClose}>
      <div className="scm-modal scm-modal-narrow" onClick={(e) => e.stopPropagation()}>
        <div className="scm-modal-header">
          <h3>Compare with Branch</h3>
          <button type="button" className="scm-modal-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="scm-modal-body scm-branch-list">
          {branches.length === 0 && (
            <span className="scm-empty-inline">No other branches</span>
          )}
          {branches.map((b) => (
            <button
              key={b.name}
              type="button"
              className="scm-branch-pick"
              onClick={() => compare(b.name)}
            >
              {b.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
