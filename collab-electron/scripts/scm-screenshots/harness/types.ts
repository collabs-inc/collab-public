import type {
  GitBranch,
  GitConfigDisplay,
  GitLogEntry,
  GitRebaseTodoItem,
  GitRemote,
  GitStash,
  GitStatusResult,
  GitSubmodule,
  GitTag,
} from "@collab/shared/git-types";

export interface ScenarioPayload {
  workspacePath: string;
  status: GitStatusResult;
  branches: GitBranch[];
  tags: GitTag[];
  remotes: GitRemote[];
  stashes: GitStash[];
  log: GitLogEntry[];
  rebaseTodo: GitRebaseTodoItem[];
  submodules: GitSubmodule[];
  hasUpstream: boolean;
  configDisplay: GitConfigDisplay;
  gpgSignEnabled: boolean;
  aiCanGenerate: { available: boolean; agent?: string };
  monacoOriginal?: string;
  monacoModified?: string;
}

export interface FixtureData {
  [key: string]: ScenarioPayload | GitConfigDisplay | MonacoDiffPayload;
  settingsGit: GitConfigDisplay;
  monacoDiff: MonacoDiffPayload;
}

export interface MonacoDiffPayload {
  filePath: string;
  original: string;
  modified: string;
}
