# Git SCM QA fixtures

Scripts build local repos under this directory for manual SCM testing in Collaborator. Generated repos are gitignored; only scripts and this README are tracked.

## Prerequisites

- `git` on PATH
- Optional: `git-lfs` (for LFS badge checks in any repo with `.gitattributes`)

## Setup

From the repository root:

```bash
./fixtures/git/setup-all.sh
```

Or individually:

| Script | Output dir | Use case |
|--------|------------|----------|
| `setup-merge-conflict.sh` | `merge-conflict/` | Merge in progress with conflict in `base.txt` |
| `setup-submodule.sh` | `submodule/` | Parent repo with nested `child` submodule |
| `setup-rebase-todo.sh` | `rebase-todo/` | Interactive rebase paused (`feature` onto `main`) |
| `setup-dirty-worktree.sh` | `dirty-worktree/` | Staged/unstaged/untracked, tags, stashes, two remotes, ahead |

## Open in Collaborator

Add the fixture directory as a workspace folder (e.g. `fixtures/git/merge-conflict`) and run through [SCM_TEST_MATRIX.md](../../collab-electron/docs/SCM_TEST_MATRIX.md).

## Reset

Delete a fixture folder and re-run its setup script.
