import { useState } from "react";
import { X } from "@phosphor-icons/react";

interface CloneRepositoryModalProps {
  open: boolean;
  onClose: () => void;
  onCloned: (path: string) => void;
  onError: (msg: string) => void;
}

export function CloneRepositoryModal({
  open,
  onClose,
  onCloned,
  onError,
}: CloneRepositoryModalProps) {
  const [url, setUrl] = useState("");
  const [parentDir, setParentDir] = useState("");
  const [branch, setBranch] = useState("");
  const [cloning, setCloning] = useState(false);

  if (!open) return null;

  const handlePickParent = async () => {
    const picked = await window.api.openFolder();
    if (picked) setParentDir(picked);
  };

  const handleClone = async () => {
    if (!url.trim() || !parentDir.trim()) {
      onError("URL and parent folder are required");
      return;
    }
    setCloning(true);
    try {
      const result = await window.api.gitClone(
        url.trim(),
        parentDir.trim(),
        branch.trim() ? { branch: branch.trim() } : undefined,
      );
      onCloned(result.path);
      onClose();
      setUrl("");
      setBranch("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Clone failed");
    } finally {
      setCloning(false);
    }
  };

  return (
    <div className="scm-modal-overlay" onClick={onClose}>
      <div className="scm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="scm-modal-header">
          <h3>Clone Repository</h3>
          <button type="button" className="scm-modal-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="scm-modal-body scm-clone-form">
          <label>
            Repository URL
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/org/repo.git"
            />
          </label>
          <label>
            Parent directory
            <div className="scm-clone-parent">
              <input
                value={parentDir}
                onChange={(e) => setParentDir(e.target.value)}
                placeholder="/path/to/parent"
              />
              <button type="button" onClick={() => void handlePickParent()}>
                Browse…
              </button>
            </div>
          </label>
          <label>
            Branch (optional)
            <input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
            />
          </label>
          <button
            type="button"
            className="scm-init-button"
            disabled={cloning}
            onClick={() => void handleClone()}
          >
            {cloning ? "Cloning…" : "Clone"}
          </button>
        </div>
      </div>
    </div>
  );
}
