import type { GitRepoState } from "@collab/shared/git-types";
import { repoStateLabel } from "./scmContextMenu";

interface MergeBannerProps {
  repoState: GitRepoState;
  onContinue: () => void;
  onAbort: () => void;
  onSkip?: () => void;
  busy?: boolean;
}

export function MergeBanner({
  repoState,
  onContinue,
  onAbort,
  onSkip,
  busy,
}: MergeBannerProps) {
  if (repoState === "clean") return null;

  const label = repoStateLabel(repoState);
  const showSkip =
    onSkip &&
    (repoState === "rebasing" ||
      repoState === "interactive-rebase" ||
      repoState === "cherry-picking");

  return (
    <div className="scm-merge-banner">
      <span className="scm-merge-banner-text">{label}</span>
      <div className="scm-merge-banner-actions">
        <button
          type="button"
          className="scm-merge-banner-btn"
          disabled={busy}
          onClick={onContinue}
        >
          Continue
        </button>
        {showSkip && (
          <button
            type="button"
            className="scm-merge-banner-btn"
            disabled={busy}
            onClick={onSkip}
          >
            Skip
          </button>
        )}
        <button
          type="button"
          className="scm-merge-banner-btn danger"
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                "Abort the current operation? Uncommitted changes may be lost.",
              )
            ) {
              onAbort();
            }
          }}
        >
          Abort
        </button>
      </div>
    </div>
  );
}
