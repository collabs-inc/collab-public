# SCM QA results

Run date: 2026-06-01  
Branch: `dev` (PR #44)

## Automated (fixture + backend)

| Area | Result | Notes |
|------|--------|-------|
| Fixture setup (`setup-all.sh`) | **PASS** | merge-conflict, submodule, rebase-todo, dirty-worktree |
| `gitStatus` / `gitRepoState` | **PASS** | clean, merging, interactive-rebase states |
| Stage / unstage / commit | **PASS** | temp repo in `git-source-control.fixture.test.ts` |
| Branches / tags / remotes / stash | **PASS** | dirty-worktree fixture |
| Merge conflict detection | **PASS** | unmerged `base.txt` in merge-conflict |
| Rebase todo parse | **PASS** | Falls back to `git-rebase-todo.backup` when paused at `break` |
| Submodule / worktree list | **PASS** | submodule fixture |
| `gitLog` / `gitDiff` | **PASS** | dirty-worktree |
| `npm run build` (collab-electron) | **PASS** | electron-vite production build |
| Dark screenshots 01–10 | **PASS** | `bun scripts/capture-scm-screenshots.mjs` |

Test command:

```bash
./fixtures/git/setup-all.sh
cd collab-electron && bun test src/main/git-source-control.fixture.test.ts
```

## Manual only (Electron UI)

Per [SCM_TEST_MATRIX.md](../../SCM_TEST_MATRIX.md): context menus, real push/pull, clone flow, GPG sign commit, LFS badge, graph replay, partial hunk staging in live app. Screenshots use component harness + git bridge, not full Electron shell.

## Fix applied during QA

- `gitRebaseTodoList`: read `git-rebase-todo.backup` when primary todo is empty (interactive rebase paused at `break`).
