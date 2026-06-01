#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
DIR="$ROOT/dirty-worktree"
BARE="$ROOT/_bare-dirty.git"
rm -rf "$DIR" "$BARE"
mkdir -p "$DIR"
cd "$DIR"

git init -q
git config user.email "fixture@collaborator.test"
git config user.name "SCM Fixture"

mkdir -p src
echo 'export function greet() { return "hello"; }' > src/app.ts
git add src/app.ts
git commit -q -m "initial commit"

git branch -M main
git clone --bare -q . "$BARE"
git remote add origin "$BARE"
git push -q -u origin main

git checkout -q -b feature/login
echo '// wip' >> src/app.ts
git add src/app.ts
git commit -q -m "feature: login scaffold"

git checkout -q main
echo 'export const VERSION = "1.0.0";' > src/version.ts
git add src/version.ts
git commit -q -m "chore: add version constant"
git tag -a v1.0.0 -m "release 1.0.0"

echo 'scratch' > spike.txt
git add spike.txt
git commit -q -m "spike: parser experiment"
echo 'more spike' >> spike.txt
git stash push -q -m "wip: spike parser"
git reset --hard HEAD~1

echo 'notes' > notes-only.txt
git add notes-only.txt
git commit -q -m "docs: notes"
echo 'extra notes' >> notes-only.txt
git stash push -q -m "wip: local experiments"
git reset --hard HEAD~1

git remote add backup "$BARE"
git commit -q --allow-empty -m "ahead of origin"

echo 'console.log("debug");' >> src/app.ts
echo '# readme' > README.md
git add README.md
echo 'draft notes' > notes.txt

echo "Fixture ready: $DIR (staged/unstaged/untracked, tags, stashes, 2 remotes, ahead)"
