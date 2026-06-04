export type GitChangeStatus = "M" | "A" | "D" | "R" | "U" | "?";

export type GitRepoState =
  | "clean"
  | "merging"
  | "rebasing"
  | "interactive-rebase"
  | "cherry-picking"
  | "reverting";

export interface GitFileChange {
  path: string;
  absPath: string;
  status: GitChangeStatus;
  oldPath?: string;
  lfs?: boolean;
}

export interface GitStatusResult {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  staged: GitFileChange[];
  unstaged: GitFileChange[];
  untracked: GitFileChange[];
  merge: GitFileChange[];
  isGitRepo: boolean;
  hasCommits: boolean;
  repoState: GitRepoState;
}

export interface GitTag {
  name: string;
}

export interface GitBranch {
  name: string;
  current: boolean;
  upstream?: string;
  isRemote: boolean;
}

export interface GitRemote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface GitStash {
  index: number;
  message: string;
  date: string;
}

export interface GitDiffRef {
  ref: string;
  label: string;
}

export interface GitDiffOpenParams {
  workspacePath: string;
  relativePath: string;
  title?: string;
  left: GitDiffRef;
  right: GitDiffRef;
  /** Conflict stage for 3-way: 1=base, 2=ours, 3=theirs */
  conflictStage?: 1 | 2 | 3;
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: string;
  parents: string[];
}

export interface GitLogFileChange {
  path: string;
  status: string;
}

export type GitRebaseAction =
  | "pick"
  | "reword"
  | "edit"
  | "squash"
  | "fixup"
  | "drop";

export interface GitRebaseTodoItem {
  action: GitRebaseAction;
  hash: string;
  subject: string;
  /** Original line text for round-trip */
  raw?: string;
}

export interface GitSubmodule {
  path: string;
  url: string;
  branch?: string;
  commit: string;
  dirty: boolean;
}

export interface GitWorktree {
  path: string;
  branch: string;
  head: string;
  bare: boolean;
  locked: boolean;
}

export interface GitDiffHunk {
  index: number;
  header: string;
  patch: string;
}

export interface GitConfigDisplay {
  userName: string;
  userEmail: string;
  credentialHelper: string;
  gpgSign: boolean;
}

export interface GitCloneOptions {
  branch?: string;
  depth?: number;
}

export interface GitCloneResult {
  path: string;
}
