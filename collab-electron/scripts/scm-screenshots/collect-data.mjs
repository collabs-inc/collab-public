#!/usr/bin/env bun
/**
 * Collect real git API payloads from fixtures for the SCM screenshot harness.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "../../..");
const fixturesRoot = join(repoRoot, "fixtures/git");
const outDir = join(scriptDir, "harness");
const outFile = join(outDir, "fixture-data.json");

const {
  gitStatus,
  gitBranches,
  gitTags,
  gitRemotes,
  gitStashList,
  gitLog,
  gitRebaseTodoList,
  gitSubmoduleStatus,
  gitHasUpstream,
  gitConfigDisplay,
  gitGpgSignEnabled,
} = await import("../../src/main/git-source-control.ts");

const scenarios = {
  "dirty-worktree": join(fixturesRoot, "dirty-worktree"),
  "merge-conflict": join(fixturesRoot, "merge-conflict"),
  "rebase-todo": join(fixturesRoot, "rebase-todo"),
  submodule: join(fixturesRoot, "submodule"),
};

async function collect(workspacePath) {
  const [
    status,
    branches,
    tags,
    remotes,
    stashes,
    log,
    rebaseTodo,
    submodules,
    hasUpstream,
    configDisplay,
    gpgSignEnabled,
  ] = await Promise.all([
    gitStatus(workspacePath),
    gitBranches(workspacePath),
    gitTags(workspacePath),
    gitRemotes(workspacePath),
    gitStashList(workspacePath),
    gitLog(workspacePath, { maxCount: 12 }),
    gitRebaseTodoList(workspacePath).catch(() => []),
    gitSubmoduleStatus(workspacePath).catch(() => []),
    gitHasUpstream(workspacePath),
    gitConfigDisplay(workspacePath),
    gitGpgSignEnabled(workspacePath),
  ]);

  return {
    workspacePath,
    status,
    branches,
    tags,
    remotes,
    stashes,
    log,
    rebaseTodo,
    submodules,
    hasUpstream,
    configDisplay,
    gpgSignEnabled,
    aiCanGenerate: { available: true, agent: "Claude Code" },
  };
}

const data = {};
for (const [name, path] of Object.entries(scenarios)) {
  data[name] = await collect(path);
}

data.settingsGit = data["dirty-worktree"].configDisplay;

data.monacoDiff = {
  filePath: join(fixturesRoot, "dirty-worktree/src/app.ts"),
  original: 'export function greet() {\n  return "hello";\n}\n',
  modified:
    'export function greet() {\n  return "hello";\n}\nconsole.log("debug");\n',
};

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, JSON.stringify(data, null, 2));
console.log(`Wrote ${outFile}`);
