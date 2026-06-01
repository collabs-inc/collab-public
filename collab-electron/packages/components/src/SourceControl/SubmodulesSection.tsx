import { useCallback, useEffect, useState } from "react";
import type { GitSubmodule } from "@collab/shared/git-types";
import { ChangeSectionHeader } from "./ChangeSectionHeader";

interface SubmodulesSectionProps {
  workspacePath: string;
  onRefresh: () => void;
  onError: (msg: string) => void;
}

export function SubmodulesSection({
  workspacePath,
  onRefresh,
  onError,
}: SubmodulesSectionProps) {
  const [subs, setSubs] = useState<GitSubmodule[]>([]);

  const load = useCallback(async () => {
    try {
      const list = await window.api.gitSubmoduleStatus(workspacePath);
      setSubs(list);
    } catch {
      setSubs([]);
    }
  }, [workspacePath]);

  useEffect(() => {
    void load();
  }, [load]);

  if (subs.length === 0) return null;

  const update = async (init?: boolean) => {
    try {
      await window.api.gitSubmoduleUpdate(workspacePath, init, true);
      onRefresh();
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Submodule update failed");
    }
  };

  return (
    <ChangeSectionHeader title="Submodules" count={subs.length}>
      {subs.map((s) => (
        <div key={s.path} className="scm-submodule-row">
          <span className="scm-submodule-path">
            {s.path}
            {s.dirty && <span className="scm-file-badge badge-M">dirty</span>}
          </span>
          <span className="scm-submodule-commit">{s.commit.slice(0, 7)}</span>
          <button type="button" onClick={() => void update(true)}>
            Update
          </button>
        </div>
      ))}
    </ChangeSectionHeader>
  );
}
