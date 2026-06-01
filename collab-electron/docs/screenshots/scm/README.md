# SCM screenshots

PNG captures of the Source Control UI (Phase 0–2) for PR #44 review. Rendered with real `@collab/components` styles, dark theme, and live `git` data from `fixtures/git/`.

## Regenerating

From the repository root:

```bash
./fixtures/git/setup-all.sh
cd collab-electron
bun scripts/capture-scm-screenshots.mjs
```

Requires Bun, Chromium (installed automatically via Playwright on first run), and `git` on `PATH`.

## Files

| File | What it shows |
|------|----------------|
| `01-scm-overview.png` | Full SCM panel: branch header, sync bar, commit box, staged/unstaged/untracked changes (`fixtures/git/dirty-worktree`) |
| `02-commit-box.png` | Commit message area with sample text, Amend, Commit / Commit & Push / Commit & Sync |
| `03-branch-picker.png` | Branch picker dropdown with local branches and tags |
| `04-sync-remotes.png` | **Manage Remotes** modal (origin + backup from dirty-worktree fixture) |
| `05-merge-conflicts.png` | Merge-in-progress banner and conflicted `base.txt` (`fixtures/git/merge-conflict`) |
| `06-history.png` | History section expanded with commit list and selected commit file list |
| `07-interactive-rebase.png` | Interactive rebase todo list with actions (`fixtures/git/rebase-todo`) |
| `08-stash.png` | Stashes section expanded with saved stashes |
| `09-viewer-diff.png` | Viewer-style Monaco side-by-side diff for `base.txt` during merge |
| `10-settings-git.png` | Settings → Git read-only config (`user.name`, `user.email`, etc.) |
