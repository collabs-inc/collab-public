#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
DIR="$ROOT/rebase-todo"
rm -rf "$DIR"
mkdir -p "$DIR"
cd "$DIR"

git init -q
git config user.email "fixture@collaborator.test"
git config user.name "SCM Fixture"

echo "v1" > file.txt
git add file.txt
git commit -q -m "main: v1"

git checkout -q -b feature
echo "v2" >> file.txt
git add file.txt
git commit -q -m "feature: v2"
echo "v3" >> file.txt
git add file.txt
git commit -q -m "feature: v3"

git checkout -q feature
GIT_SEQUENCE_EDITOR='sed -i.bak "2s/^pick .*/break/"' git rebase -i main || true
# Stops at `break` with git-rebase-todo present

echo "Fixture ready: $DIR (interactive rebase in progress on feature)"
