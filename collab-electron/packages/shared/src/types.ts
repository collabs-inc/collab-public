export type {
  ReplayCommit,
  ReplayFileChange,
  ReplayLinkChange,
  ReplayCheckpoint,
} from "./replay-types";

export interface TreeNode {
  path: string;
  name: string;
  kind: "folder" | "file";
  ctime: string;
  mtime: string;
  frontmatter?: Record<string, unknown>;
  preview?: string;
  fileCount?: number;
  children?: TreeNode[];
}

export interface ViewerItem {
  id: string;
  title: string;
  type: string;
  isEditable: boolean;
  isTitleEditable?: boolean;
  url?: string;
  fileUrl?: string;
  summary?: string;
  quotes?: Quote[];
  quotesTitle?: string;
  text?: string;
  rawContext?: string;
  createdAt: number;
  modifiedAt: number;
  relatedConcepts?: Concept[];
  sources?: ItemSource[];
  isPinned?: boolean;
  collab_reviewed?: boolean;
  frontmatter?: Record<string, unknown>;
}

export interface Quote {
  text: string;
}

export interface ItemSource {
  [sourceName: string]: SourceItem[];
}

export interface SourceItem {
  id: string;
  title: string;
  type: string;
  author?: string;
  url?: string;
  urlThumbnail?: string;
  summary?: string;
  text?: string;
  excerpts?: string[];
  relatedConcepts?: Concept[];
  modifiedAt?: number;
}

export interface Concept {
  id: string;
  title: string;
  similarityScore?: string;
  degree?: number;
}

// ── File watcher types ──

export type FileChangeType = 1 | 2 | 3;
export const FileChangeType = {
  Added: 1 as const,
  Updated: 2 as const,
  Deleted: 3 as const,
};

export interface FileChange {
  path: string;
  type: FileChangeType;
}

export interface FsChangeEvent {
  dirPath: string;
  changes: FileChange[];
}

// ── Folder table types ──

export interface FolderTableFile {
  path: string;
  filename: string;
  frontmatter: Record<string, unknown>;
  mtime: string;
  ctime: string;
}

export interface FolderTableData {
  folderPath: string;
  files: FolderTableFile[];
  columns: string[];
}

// ── App config types (mirrors main/config.ts) ──

export interface AppConfig {
  workspaces: string[];
  expanded_workspaces: string[];
  window_state: { x: number; y: number; width: number; height: number; isMaximized?: boolean } | null;
  ui: Record<string, unknown>;
}

