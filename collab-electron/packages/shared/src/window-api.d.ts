import type {
  AppConfig,
  FolderTableData,
  TreeNode,
} from "./types";
import type { ReplayMessage } from "./replay-types";
import type {
  GitCloneOptions,
  GitCloneResult,
  GitConfigDisplay,
  GitDiffHunk,
  GitDiffOpenParams,
  GitLogEntry,
  GitLogFileChange,
  GitRebaseTodoItem,
  GitStatusResult,
  GitBranch,
  GitRemote,
  GitStash,
  GitSubmodule,
  GitTag,
  GitWorktree,
} from "./git-types";

type Unsubscribe = () => void;

interface UpdateState {
  status:
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "ready"
    | "installing"
    | "error";
  progress?: number;
  version?: string;
  releaseNotes?: string;
  error?: string;
}

interface DirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
  createdAt: string;
  modifiedAt: string;
  fileCount?: number;
}

interface FileStats {
  ctime: string;
  mtime: string;
}

interface GraphData {
  nodes: Array<{
    id: string;
    title: string;
    path: string;
    nodeType?: "file" | "code";
    weight?: number;
  }>;
  links: Array<{
    source: string;
    target: string;
    linkType?: "wikilink" | "import";
  }>;
}

interface WikilinkSuggestion {
  stem: string;
  path: string;
  ambiguous: boolean;
}

interface Backlink {
  path: string;
  context: string;
}

interface PtySession {
  sessionId: string;
  shell: string;
  displayName: string;
  target: string;
  command: string;
  args: string[];
  cwdHostPath: string;
  cwdGuestPath?: string;
}

interface TerminalTargetOption {
  id: string;
  label: string;
  isDefault?: boolean;
}

type PtyDataCb = (
  payload: { sessionId: string; data: Uint8Array },
) => void;
type PtyExitCb = (
  payload: { sessionId: string; exitCode: number },
) => void;
type CdToCb = (path: string) => void;
type RunInTerminalCb = (command: string) => void;

interface AgentSessionEvent {
  kind: "session-started";
  sessionId: string;
}

interface AgentFileTouchedEvent {
  kind: "file-touched";
  sessionId: string;
  filePath: string;
  touchType: "read" | "write";
  timestamp: number;
}

interface AgentSessionEndedEvent {
  kind: "session-ended";
  sessionId: string;
}

type AgentEvent =
  | AgentSessionEvent
  | AgentFileTouchedEvent
  | AgentSessionEndedEvent;

export interface CollabApi {
  // Config
  getPlatform: () => NodeJS.Platform;
  getConfig: () => Promise<AppConfig>;
  getDeviceId: () => Promise<string>;
  getPref: (key: string) => Promise<unknown>;
  setPref: (key: string, value: unknown) => Promise<void>;
  listTerminalTargets: () => Promise<TerminalTargetOption[]>;
  getWorkspacePref: (key: string, workspacePath: string) => Promise<unknown>;
  setWorkspacePref: (
    key: string,
    value: unknown,
    workspacePath: string,
  ) => Promise<void>;

  // Theme
  setTheme: (mode: string) => Promise<void>;

  // File selection
  selectFile: (path: string | null) => void;

  // Folder selection
  selectFolder: (path: string) => void;
  readFolderTable: (
    folderPath: string,
  ) => Promise<FolderTableData>;

  // File system (nav)
  readDir: (path: string) => Promise<DirEntry[]>;
  countFiles: (path: string) => Promise<number>;
  trashFile: (path: string) => Promise<void>;
  createDir: (path: string) => Promise<void>;
  moveFile: (
    oldPath: string,
    newParentDir: string,
  ) => Promise<string>;

  // Import
  importWebArticle(
    url: string,
    targetDir: string,
  ): Promise<{ path: string }>;

  // File system (viewer)
  readFile: (path: string) => Promise<string>;
  writeFile: (
    path: string,
    content: string,
    expectedMtime?: string,
  ) => Promise<WriteResult>;
  renameFile: (
    oldPath: string,
    newTitle: string,
  ) => Promise<string>;
  getFileStats: (path: string) => Promise<FileStats>;

  // Images
  getImageThumbnail: (
    path: string,
    size: number,
  ) => Promise<string>;
  getImageFull: (path: string) => Promise<{
    url: string;
    width: number;
    height: number;
  }>;
  resolveImagePath: (
    reference: string,
    fromNotePath: string,
  ) => Promise<string | null>;
  saveDroppedImage: (
    noteDir: string,
    fileName: string,
    buffer: ArrayBuffer,
  ) => Promise<string>;
  openImageDialog: () => Promise<string | null>;

  readTree: (params: {
    root: string;
  }) => Promise<TreeNode[]>;

  // Workspace
  workspaceRemoveByPath: (
    path: string,
  ) => Promise<{ workspaces: string[] }>;
  getWorkspaceGraph: (params: {
    workspacePath: string;
  }) => Promise<GraphData>;
  updateFrontmatter: (
    filePath: string,
    field: string,
    value: unknown,
  ) => Promise<{ ok: boolean; retried?: boolean }>;

  // Wikilinks
  resolveWikilink: (
    target: string,
  ) => Promise<string | null>;
  suggestWikilinks: (
    partial: string,
  ) => Promise<WikilinkSuggestion[]>;
  getBacklinks: (
    filePath: string,
  ) => Promise<Backlink[]>;

  // PTY
  ptyCreate: (
    cwd?: string,
    cols?: number,
    rows?: number,
    target?: string,
    tileId?: string,
  ) => Promise<PtySession>;
  ptyWrite: (
    sessionId: string,
    data: string,
  ) => void;
  ptySendRawKeys: (
    sessionId: string,
    data: string,
  ) => void;
  ptyResize: (
    sessionId: string,
    cols: number,
    rows: number,
  ) => Promise<void>;
  ptyKill: (sessionId: string) => Promise<void>;
  ptyReconnect: (
    sessionId: string,
    cols: number,
    rows: number,
  ) => Promise<PtySession & { scrollback: string; mode: "tmux" | "sidecar" }>;
  ptyDiscover: () => Promise<
    Array<{
      sessionId: string;
      meta: {
        shell: string;
        cwd: string;
        createdAt: string;
        displayName?: string;
        target?: string;
        cwdHostPath?: string;
        cwdGuestPath?: string;
      };
    }>
  >;
  ptyReadMeta: (sessionId: string) => Promise<{
    shell: string;
    cwd: string;
    createdAt: string;
    target?: string;
    backend?: "tmux" | "sidecar";
  } | null>;
  notifyPtySessionId: (sessionId: string) => void;
  onPtyData: (sessionId: string, cb: PtyDataCb) => void;
  offPtyData: (sessionId: string, cb: PtyDataCb) => void;
  onPtyExit: (sessionId: string, cb: PtyExitCb) => void;
  offPtyExit: (sessionId: string, cb: PtyExitCb) => void;
  onCdTo: (cb: CdToCb) => void;
  offCdTo: (cb: CdToCb) => void;

  // Navigation
  openInTerminal: (path: string) => void;
  createGraphTile: (folderPath: string) => void;
  runInTerminal: (command: string) => void;
  onRunInTerminal: (cb: RunInTerminalCb) => void;
  offRunInTerminal: (cb: RunInTerminalCb) => void;

  // Cross-webview drag-and-drop
  setDragPaths: (paths: string[]) => void;
  clearDragPaths: () => void;
  getDragPaths: () => Promise<string[]>;
  onNavDragActive: (
    cb: (active: boolean) => void,
  ) => Unsubscribe;

  // Settings
  openFolder: () => Promise<string | null>;
  close: () => void;

  // Context menu
  showContextMenu: (
    items: Array<{
      id: string;
      label: string;
      enabled?: boolean;
    }>,
  ) => Promise<string | null>;

  // IPC event listeners
  onFocusSearch: (cb: () => void) => Unsubscribe;
  onFileSelected: (
    cb: (path: string | null) => void,
  ) => Unsubscribe;
  onFolderSelected: (
    cb: (path: string) => void,
  ) => Unsubscribe;
  onFileRenamed: (
    cb: (oldPath: string, newPath: string) => void,
  ) => Unsubscribe;
  onFilesDeleted: (
    cb: (paths: string[]) => void,
  ) => Unsubscribe;
  onFsChanged: (
    cb: (
      events: Array<{
        dirPath: string;
        changes: Array<{ path: string; type: number }>;
      }>,
    ) => void,
  ) => Unsubscribe;
  onWorkspaceAdded: (
    cb: (path: string) => void,
  ) => Unsubscribe;
  onWorkspaceRemoved: (
    cb: (path: string) => void,
  ) => Unsubscribe;
  onWikilinksUpdated: (
    cb: (paths: string[]) => void,
  ) => Unsubscribe;
  onNavVisibility: (
    cb: (visible: boolean) => void,
  ) => Unsubscribe;

  onScopeChanged: (
    cb: (newPath: string) => void,
  ) => Unsubscribe;

  onGitDiffOpen: (
    cb: (params: GitDiffOpenParams) => void,
  ) => Unsubscribe;

  // Auto-updater
  updateGetStatus: () => Promise<UpdateState>;
  updateCheck: () => Promise<UpdateState>;
  updateDownload: () => Promise<UpdateState>;
  updateInstall: () => void;
  onUpdateStatus: (
    cb: (state: UpdateState) => void,
  ) => Unsubscribe;

  // Agent activity
  onAgentEvent: (cb: (event: AgentEvent) => void) => Unsubscribe;
  focusAgentSession: (sessionId: string) => Promise<void>;

  // Git replay
  startReplay: (params: { workspacePath: string }) => Promise<boolean>;
  stopReplay: () => Promise<void>;
  onReplayData: (
    cb: (msg: ReplayMessage) => void,
  ) => Unsubscribe;

  // Terminal focus (receiving end)
  onFocusTab: (cb: (ptySessionId: string) => void) => Unsubscribe;
  onShellBlur: (cb: () => void) => Unsubscribe;

  // Canvas pinch forwarding
  forwardPinch: (deltaY: number) => void;

  // Git source control
  gitStatus: (workspacePath: string) => Promise<GitStatusResult>;
  gitStage: (
    workspacePath: string,
    paths: string[],
  ) => Promise<void>;
  gitUnstage: (
    workspacePath: string,
    paths: string[],
  ) => Promise<void>;
  gitStageAll: (workspacePath: string) => Promise<void>;
  gitUnstageAll: (workspacePath: string) => Promise<void>;
  gitDiscard: (
    workspacePath: string,
    paths: string[],
  ) => Promise<void>;
  gitDiscardAll: (workspacePath: string) => Promise<void>;
  gitCommit: (
    workspacePath: string,
    message: string,
    options?: { amend?: boolean; sign?: boolean },
  ) => Promise<{ hash: string }>;
  gitDiff: (
    workspacePath: string,
    filePath: string,
    cached: boolean,
  ) => Promise<string>;
  gitGenerateCommitMessage: (
    workspacePath: string,
  ) => Promise<{
    message: string;
    model: string;
  }>;
  gitInit: (workspacePath: string) => Promise<void>;
  aiValidateKey: (
    key: string,
  ) => Promise<{ valid: boolean }>;
  aiHasKey: () => Promise<boolean>;
  aiCanGenerate: () => Promise<{
    available: boolean;
    agent?: string;
  }>;

  // Push / Pull / Fetch
  gitPush: (
    workspacePath: string,
    remote?: string,
  ) => Promise<void>;
  gitPushSetUpstream: (
    workspacePath: string,
    remote: string,
    branch: string,
  ) => Promise<void>;
  gitPull: (
    workspacePath: string,
    remote?: string,
  ) => Promise<void>;
  gitFetch: (
    workspacePath: string,
    remote?: string,
  ) => Promise<void>;
  gitRemotes: (workspacePath: string) => Promise<GitRemote[]>;
  gitHasUpstream: (workspacePath: string) => Promise<boolean>;

  // Branch operations
  gitBranches: (workspacePath: string) => Promise<GitBranch[]>;
  gitTags: (workspacePath: string) => Promise<GitTag[]>;
  gitCheckout: (
    workspacePath: string,
    branch: string,
  ) => Promise<void>;
  gitCreateBranch: (
    workspacePath: string,
    name: string,
    startPoint?: string,
  ) => Promise<void>;
  gitDeleteBranch: (
    workspacePath: string,
    name: string,
  ) => Promise<void>;

  // Stash operations
  gitStashSave: (
    workspacePath: string,
    message?: string,
  ) => Promise<void>;
  gitStashList: (workspacePath: string) => Promise<GitStash[]>;
  gitStashPop: (
    workspacePath: string,
    index: number,
  ) => Promise<void>;
  gitStashApply: (
    workspacePath: string,
    index: number,
  ) => Promise<void>;
  gitStashDrop: (
    workspacePath: string,
    index: number,
  ) => Promise<void>;

  // Show file at ref (for diff viewer)
  gitShowFile: (
    workspacePath: string,
    ref: string,
    filePath: string,
  ) => Promise<string>;
  gitReadBlob: (
    workspacePath: string,
    ref: string,
    filePath: string,
  ) => Promise<string>;
  gitDiffRefs: (
    workspacePath: string,
    leftRef: string,
    rightRef: string,
    filePath: string,
  ) => Promise<string>;
  openGitDiff: (params: GitDiffOpenParams) => void;
  gitClone: (
    url: string,
    parentDir: string,
    options?: GitCloneOptions,
  ) => Promise<GitCloneResult>;
  gitRemoteAdd: (
    workspacePath: string,
    name: string,
    url: string,
  ) => Promise<void>;
  gitRemoteRemove: (
    workspacePath: string,
    name: string,
  ) => Promise<void>;
  gitRemoteRename: (
    workspacePath: string,
    oldName: string,
    newName: string,
  ) => Promise<void>;
  gitRemoteSetUrl: (
    workspacePath: string,
    name: string,
    url: string,
    push?: boolean,
  ) => Promise<void>;
  gitCheckoutOurs: (
    workspacePath: string,
    paths: string[],
  ) => Promise<void>;
  gitCheckoutTheirs: (
    workspacePath: string,
    paths: string[],
  ) => Promise<void>;
  gitAdd: (workspacePath: string, paths: string[]) => Promise<void>;
  gitMergeAbort: (workspacePath?: string) => Promise<void>;
  gitMergeContinue: (workspacePath?: string) => Promise<void>;
  gitCherryPickAbort: (workspacePath?: string) => Promise<void>;
  gitCherryPickContinue: (workspacePath?: string) => Promise<void>;
  gitRevertAbort: (workspacePath?: string) => Promise<void>;
  gitRevertContinue: (workspacePath?: string) => Promise<void>;
  gitLog: (
    workspacePath?: string,
    options?: { maxCount?: number; ref?: string },
  ) => Promise<GitLogEntry[]>;
  gitLogFiles: (
    workspacePath: string,
    hash: string,
  ) => Promise<GitLogFileChange[]>;
  gitRevertCommit: (
    workspacePath: string,
    hash: string,
  ) => Promise<void>;
  gitCherryPick: (
    workspacePath: string,
    hash: string,
  ) => Promise<void>;
  gitReset: (
    workspacePath: string,
    mode: "soft" | "mixed" | "hard",
    ref: string,
  ) => Promise<void>;
  gitMerge: (workspacePath: string, branch: string) => Promise<void>;
  gitRebase: (workspacePath: string, onto: string) => Promise<void>;
  gitRebaseContinue: (workspacePath?: string) => Promise<void>;
  gitRebaseAbort: (workspacePath?: string) => Promise<void>;
  gitRebaseSkip: (workspacePath?: string) => Promise<void>;
  gitRebaseTodoList: (
    workspacePath?: string,
  ) => Promise<GitRebaseTodoItem[]>;
  gitRebaseTodoWrite: (
    workspacePath: string,
    items: GitRebaseTodoItem[],
  ) => Promise<void>;
  gitRebaseStartInteractive: (
    workspacePath: string,
    onto: string | null,
    count: number,
  ) => Promise<void>;
  gitSubmoduleStatus: (
    workspacePath?: string,
  ) => Promise<GitSubmodule[]>;
  gitSubmoduleUpdate: (
    workspacePath?: string,
    init?: boolean,
    recursive?: boolean,
  ) => Promise<void>;
  gitWorktreeList: (workspacePath?: string) => Promise<GitWorktree[]>;
  gitWorktreeAdd: (
    workspacePath: string,
    wtPath: string,
    branch: string,
  ) => Promise<void>;
  gitWorktreeRemove: (
    workspacePath: string,
    wtPath: string,
  ) => Promise<void>;
  gitDiffHunks: (
    workspacePath: string,
    filePath: string,
    cached?: boolean,
  ) => Promise<GitDiffHunk[]>;
  gitApplyCached: (
    workspacePath: string,
    patch: string,
  ) => Promise<void>;
  gitApplyWorking: (
    workspacePath: string,
    patch: string,
    reverse?: boolean,
  ) => Promise<void>;
  gitCheckIgnore: (
    workspacePath: string,
    paths: string[],
  ) => Promise<string[]>;
  gitConfigDisplay: (
    workspacePath?: string,
  ) => Promise<GitConfigDisplay>;
  gitGpgSignEnabled: (workspacePath?: string) => Promise<boolean>;
}

declare global {
  interface WriteResult {
    ok: boolean;
    mtime: string;
    conflict?: boolean;
  }

  interface Window {
    api: CollabApi;
  }
}
