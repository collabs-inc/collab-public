# SCM test matrix

Manual QA checklist for Source Control (Phase 0–2).

## Foundation

- [ ] `git status` shows `repoState` (clean, merging, rebasing, interactive-rebase, cherry-picking, reverting)
- [ ] Selected remote in SyncBar matches Commit & Push / Commit & Sync
- [ ] Refresh updates counts and branch

## Phase A — Viewer diff

- [ ] Click staged/unstaged file opens Monaco diff in viewer tile
- [ ] Header shows path and ref labels; Esc closes diff
- [ ] Compare with Branch opens branch picker and diff

## Phase B — Clone & remotes

- [ ] Clone Repository from non-repo workspace adds workspace
- [ ] Manage remotes: add, remove (with confirm)

## Phase C — Conflicts

- [ ] Merge banner shows Continue / Abort during merge
- [ ] Accept Current / Incoming / Mark Resolved on conflict files
- [ ] Commit disabled while conflicts exist

## Phase D — Context menus

- [ ] Right-click file: stage, unstage, discard, open changes, reveal
- [ ] SCM header menu: refresh, pull, push, open .gitignore

## Phase E — History

- [ ] History section lists commits; context menu revert/cherry-pick/reset
- [ ] Open Graph starts replay

## Phase F — Interactive rebase

- [ ] During `git rebase -i`, todo list appears with reorder and action dropdowns
- [ ] Continue / Abort work

## Phase G — Submodules & worktrees

- [ ] Submodules listed when `.gitmodules` exists; Update runs
- [ ] Worktrees listed when multiple exist

## Phase H — Partial staging

- [ ] Stage hunk from diff viewer (when hunks available)

## Phase I — Signing & config

- [ ] Sign commit checkbox when `commit.gpgsign` configured
- [ ] Settings → Git shows read-only user.name, email, credential.helper

## Fixtures

From repo root, run `./fixtures/git/setup-all.sh` (see `fixtures/git/README.md`). Open a generated folder as a workspace:

| Path | Covers |
|------|--------|
| `fixtures/git/merge-conflict` | Phase C — merge banner, conflict markers in `base.txt` |
| `fixtures/git/submodule` | Phase G — `child` submodule |
| `fixtures/git/rebase-todo` | Phase F — interactive rebase paused at `break` |
| `fixtures/git/dirty-worktree` | Overview — staged/unstaged/untracked, tags, stashes, sync bar |

## Phase I — LFS badge

- [ ] Repo with `*.bin filter=lfs diff=lfs merge=lfs -text` in `.gitattributes` shows **LFS** badge on matching changed files
- [ ] Badge absent when `git-lfs` is not installed or path is not LFS-tracked
