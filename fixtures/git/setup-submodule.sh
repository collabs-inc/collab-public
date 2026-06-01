#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
DIR="$ROOT/submodule"
CHILD="$DIR/child"
rm -rf "$DIR"
mkdir -p "$CHILD"
cd "$CHILD"

git init -q
git config user.email "fixture@collaborator.test"
git config user.name "SCM Fixture"
echo "child content" > README.md
git add README.md
git commit -q -m "child initial"

cd "$DIR"
git init -q
git config user.email "fixture@collaborator.test"
git config user.name "SCM Fixture"
git submodule add -q "$CHILD" child
git commit -q -m "add child submodule"

echo "Fixture ready: $DIR (submodule at child/)"
