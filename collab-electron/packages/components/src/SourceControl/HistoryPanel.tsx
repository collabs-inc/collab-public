import { useCallback, useEffect, useState } from "react";
import { CaretDown, CaretRight, Graph } from "@phosphor-icons/react";
import type { GitLogEntry, GitLogFileChange } from "@collab/shared/git-types";
interface HistoryPanelProps {
  workspacePath: string;
  expanded: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  onError: (msg: string) => void;
}

export function HistoryPanel({
  workspacePath,
  expanded,
  onToggle,
  onRefresh,
  onError,
}: HistoryPanelProps) {
  const [commits, setCommits] = useState<GitLogEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [files, setFiles] = useState<GitLogFileChange[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await window.api.gitLog(workspacePath, {
        maxCount: 30,
      });
      setCommits(list);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, [workspacePath, onError]);

  useEffect(() => {
    if (expanded) void load();
  }, [expanded, load]);

  const selectCommit = async (entry: GitLogEntry) => {
    setSelected(entry.hash);
    try {
      const f = await window.api.gitLogFiles(workspacePath, entry.hash);
      setFiles(f);
    } catch {
      setFiles([]);
    }
  };

  const menuFor = async (entry: GitLogEntry) => {
    const choice = await window.api.showContextMenu([
      { id: "view", label: "View Changes" },
      { id: "revert", label: "Revert" },
      { id: "cherry-pick", label: "Cherry Pick" },
      { id: "reset-soft", label: "Reset (soft) to here" },
      { id: "reset-mixed", label: "Reset (mixed) to here" },
      { id: "reset-hard", label: "Reset (hard) to here" },
      { id: "open-graph", label: "Open Graph" },
    ]);
    if (!choice) return;
    try {
      switch (choice) {
        case "view":
          if (files[0]) {
            window.api.openGitDiff({
              workspacePath,
              relativePath: files[0].path,
              left: { ref: `${entry.hash}^`, label: "Parent" },
              right: { ref: entry.hash, label: entry.shortHash },
            });
          }
          break;
        case "revert":
          await window.api.gitRevertCommit(workspacePath, entry.hash);
          break;
        case "cherry-pick":
          await window.api.gitCherryPick(workspacePath, entry.hash);
          break;
        case "reset-soft":
          await window.api.gitReset(workspacePath, "soft", entry.hash);
          break;
        case "reset-mixed":
          await window.api.gitReset(workspacePath, "mixed", entry.hash);
          break;
        case "reset-hard":
          if (
            window.confirm(
              "Hard reset will discard all uncommitted changes. Continue?",
            )
          ) {
            await window.api.gitReset(workspacePath, "hard", entry.hash);
          }
          break;
        case "open-graph":
          window.api.createGraphTile(workspacePath);
          void window.api.startReplay({ workspacePath });
          break;
      }
      onRefresh();
      if (expanded) await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Operation failed");
    }
  };

  return (
    <div className="scm-history">
      <button
        type="button"
        className="scm-history-toggle"
        onClick={onToggle}
      >
        {expanded ? (
          <CaretDown size={12} weight="bold" />
        ) : (
          <CaretRight size={12} weight="bold" />
        )}
        <Graph size={14} />
        <span>History</span>
        {loading && <span className="scm-history-loading">…</span>}
      </button>
      {expanded && (
        <div className="scm-history-list">
          {commits.map((c) => (
            <div key={c.hash} className="scm-history-entry">
              <button
                type="button"
                className={`scm-history-row${selected === c.hash ? " selected" : ""}`}
                onClick={() => void selectCommit(c)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  void menuFor(c);
                }}
              >
                <span className="scm-history-hash">{c.shortHash}</span>
                <span className="scm-history-subject">{c.subject}</span>
              </button>
              {selected === c.hash && files.length > 0 && (
                <ul className="scm-history-files">
                  {files.map((f) => (
                    <li key={f.path}>
                      <span className="scm-history-file-status">
                        {f.status}
                      </span>
                      {f.path}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
