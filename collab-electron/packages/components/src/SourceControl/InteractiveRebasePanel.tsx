import { useCallback, useEffect, useState } from "react";
import type { GitRebaseAction, GitRebaseTodoItem } from "@collab/shared/git-types";

const ACTIONS: GitRebaseAction[] = [
  "pick",
  "reword",
  "edit",
  "squash",
  "fixup",
  "drop",
];

interface InteractiveRebasePanelProps {
  workspacePath: string;
  onRefresh: () => void;
  onError: (msg: string) => void;
}

export function InteractiveRebasePanel({
  workspacePath,
  onRefresh,
  onError,
}: InteractiveRebasePanelProps) {
  const [items, setItems] = useState<GitRebaseTodoItem[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await window.api.gitRebaseTodoList(workspacePath);
      setItems(list);
    } catch (err) {
      onError(
        err instanceof Error ? err.message : "Failed to load rebase todo",
      );
    }
  }, [workspacePath, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (next: GitRebaseTodoItem[]) => {
    setItems(next);
    try {
      await window.api.gitRebaseTodoWrite(workspacePath, next);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to save todo");
    }
  };

  const move = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[index], next[j]] = [next[j]!, next[index]!];
    void save(next);
  };

  const setAction = (index: number, action: GitRebaseAction) => {
    const next = items.map((item, i) =>
      i === index ? { ...item, action } : item,
    );
    void save(next);
  };

  const handleContinue = async () => {
    setBusy(true);
    try {
      await window.api.gitRebaseContinue(workspacePath);
      onRefresh();
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Continue failed");
    } finally {
      setBusy(false);
    }
  };

  const handleAbort = async () => {
    if (
      !window.confirm("Abort interactive rebase?")
    ) {
      return;
    }
    setBusy(true);
    try {
      await window.api.gitRebaseAbort(workspacePath);
      onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Abort failed");
    } finally {
      setBusy(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="scm-rebase-panel scm-empty-inline">
        No rebase todo loaded
      </div>
    );
  }

  return (
    <div className="scm-rebase-panel">
      <div className="scm-rebase-toolbar">
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleContinue()}
        >
          Continue
        </button>
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={() => void handleAbort()}
        >
          Abort
        </button>
      </div>
      <ul className="scm-rebase-list">
        {items.map((item, index) => (
          <li key={`${item.hash}-${index}`} className="scm-rebase-item">
            <div className="scm-rebase-order">
              <button
                type="button"
                title="Move up"
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                title="Move down"
                disabled={index === items.length - 1}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
            </div>
            <select
              value={item.action}
              onChange={(e) =>
                setAction(index, e.target.value as GitRebaseAction)
              }
            >
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <span className="scm-rebase-hash">{item.hash.slice(0, 7)}</span>
            <span className="scm-rebase-subject">{item.subject}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
