import { useCallback, useEffect, useState } from "react";
import { X } from "@phosphor-icons/react";
import type { GitRemote } from "@collab/shared/git-types";

interface RemoteManagerModalProps {
  workspacePath: string;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  onError: (msg: string) => void;
}

export function RemoteManagerModal({
  workspacePath,
  open,
  onClose,
  onChanged,
  onError,
}: RemoteManagerModalProps) {
  const [remotes, setRemotes] = useState<GitRemote[]>([]);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const list = await window.api.gitRemotes(workspacePath);
    setRemotes(list);
  }, [workspacePath]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!open) return null;

  const handleAdd = async () => {
    if (!newName.trim() || !newUrl.trim()) return;
    setBusy(true);
    try {
      await window.api.gitRemoteAdd(
        workspacePath,
        newName.trim(),
        newUrl.trim(),
      );
      setNewName("");
      setNewUrl("");
      await load();
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to add remote");
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (name: string) => {
    if (!window.confirm(`Remove remote "${name}"?`)) return;
    setBusy(true);
    try {
      await window.api.gitRemoteRemove(workspacePath, name);
      await load();
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to remove remote");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scm-modal-overlay" onClick={onClose}>
      <div
        className="scm-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="scm-modal-header">
          <h3>Manage Remotes</h3>
          <button type="button" className="scm-modal-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="scm-modal-body">
          <table className="scm-remote-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Fetch URL</th>
                <th>Push URL</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {remotes.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td className="scm-remote-url">{r.fetchUrl}</td>
                  <td className="scm-remote-url">{r.pushUrl || r.fetchUrl}</td>
                  <td>
                    <button
                      type="button"
                      className="scm-modal-link danger"
                      disabled={busy}
                      onClick={() => void handleRemove(r.name)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="scm-remote-add">
            <input
              placeholder="Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <input
              placeholder="URL"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              className="scm-remote-add-url"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleAdd()}
            >
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
