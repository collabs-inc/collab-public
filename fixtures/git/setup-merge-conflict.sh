#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
DIR="$ROOT/merge-conflict"
rm -rf "$DIR"
mkdir -p "$DIR"
cd "$DIR"

git init -q
git config user.email "fixture@collaborator.test"
git config user.name "SCM Fixture"

echo "base" > base.txt
git add base.txt
git commit -q -m "initial on main"

git checkout -q -b feature
echo "feature line" >> base.txt
git add base.txt
git commit -q -m "feature change"

git checkout -q main
echo "main line" >> base.txt
git add base.txt
git commit -q -m "main change"

git merge feature || true
# Leaves MERGE_HEAD and conflict in base.txt

echo "Fixture ready: $DIR (merge conflict on base.txt)"
