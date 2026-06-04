#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
for script in setup-merge-conflict.sh setup-submodule.sh setup-rebase-todo.sh setup-dirty-worktree.sh; do
  bash "$ROOT/$script"
done
echo "All git SCM fixtures created under $ROOT"
