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
