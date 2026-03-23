export type GitChangeStatus = "M" | "A" | "D" | "R" | "U" | "?";

export interface GitFileChange {
  path: string;
  absPath: string;
  status: GitChangeStatus;
  oldPath?: string;
}

export interface GitStatusResult {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  staged: GitFileChange[];
  unstaged: GitFileChange[];
  untracked: GitFileChange[];
  isGitRepo: boolean;
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
