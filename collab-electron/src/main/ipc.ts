import { type BrowserWindow } from "electron";
import type { FileFilter } from "./file-filter";
import type { AppConfig } from "./config";
import { invalidateImageCache } from "./image-service";
import { saveWorkspaceConfig } from "./workspace-config";
import * as watcher from "./watcher";
import * as wikilinkIndex from "./wikilink-index";
import { trackEvent } from "./analytics";

import {
  registerFilesystemHandlers,
  getRecentlyRenamedRefCounts,
} from "./ipc-filesystem";
import {
  registerWorkspaceHandlers,
  startWorkspaceServices,
  getWorkspaceConfig,
} from "./ipc-workspace";
import { registerKnowledgeHandlers } from "./ipc-knowledge";
import { registerCanvasHandlers } from "./ipc-canvas";
import { registerMiscHandlers } from "./ipc-misc";

const FS_CHANGE_DELETED = 3;

let appConfig: AppConfig;
let mainWindow: BrowserWindow | null = null;
const fileFilterRef: { current: FileFilter | null } = {
  current: null,
};

function activeWorkspacePath(): string {
  const { workspaces, active_workspace } = appConfig;
  return workspaces[active_workspace] ?? "";
}

function forwardToWebview(
  target: string,
  channel: string,
  ...args: unknown[]
): void {
  mainWindow?.webContents.send(
    "shell:forward",
    target,
    channel,
    ...args,
  );
}

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win;
}

export function registerIpcHandlers(config: AppConfig): void {
  appConfig = config;

  const wsPath = activeWorkspacePath();
  if (wsPath) {
    startWorkspaceServices(wsPath, (f) => {
      fileFilterRef.current = f;
    });
  }

  // --- Batched watcher fan-out ---
  type FileChange = { path: string; type: number };
  type FsChangeEvent = { dirPath: string; changes: FileChange[] };

  const BATCH_WINDOW_MS = 200;
  const MAX_BATCH_WAIT_MS = 2000;
  let pendingEvents: FsChangeEvent[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let batchStartTime: number | null = null;

  function deduplicateEvents(events: FsChangeEvent[]): FsChangeEvent[] {
    const byDir = new Map<string, Map<string, FileChange>>();
    for (const event of events) {
      if (!byDir.has(event.dirPath)) byDir.set(event.dirPath, new Map());
      const dirMap = byDir.get(event.dirPath)!;
      for (const change of event.changes) {
        dirMap.set(change.path, change);
      }
    }
    return Array.from(byDir.entries()).map(([dirPath, changes]) => ({
      dirPath,
      changes: Array.from(changes.values()),
    }));
  }

  function flushBatch(): void {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (pendingEvents.length === 0) return;
    batchStartTime = null;
    const batch = deduplicateEvents(pendingEvents);
    pendingEvents = [];

    // IPC fan-out (batched)
    forwardToWebview("nav", "fs-changed", batch);
    forwardToWebview("viewer", "fs-changed", batch);

    // Batched: wikilink reindex
    const mdDeleted: string[] = [];
    const mdUpdated: string[] = [];
    for (const event of batch) {
      for (const change of event.changes) {
        if (!change.path.endsWith(".md")) continue;
        if (change.type === FS_CHANGE_DELETED) {
          mdDeleted.push(change.path);
        } else {
          mdUpdated.push(change.path);
        }
      }
    }
    for (const p of mdDeleted) {
      wikilinkIndex.removeFile(p);
    }
    if (mdUpdated.length > 0) {
      void wikilinkIndex.batchUpdate(mdUpdated);
    }

    // Deletion handling (batched)
    const recentlyRenamed = getRecentlyRenamedRefCounts();
    const deletedPaths = batch.flatMap((e) =>
      e.changes
        .filter(
          (c) =>
            c.type === FS_CHANGE_DELETED &&
            !recentlyRenamed.has(c.path),
        )
        .map((c) => c.path),
    );
    if (deletedPaths.length > 0) {
      forwardToWebview("nav", "files-deleted", deletedPaths);
      forwardToWebview("viewer", "files-deleted", deletedPaths);
      const active = activeWorkspacePath();
      if (active) {
        const wsConfig = getWorkspaceConfig(active);
        if (
          wsConfig.selected_file &&
          deletedPaths.includes(wsConfig.selected_file)
        ) {
          wsConfig.selected_file = null;
          saveWorkspaceConfig(active, wsConfig);
        }
      }
    }
  }

  // File watcher notifications (cache invalidation is IMMEDIATE, everything else is batched)
  watcher.setNotifyFn((events) => {
    // Immediate: cache invalidation cannot wait
    const changedPaths = events.flatMap(
      (event) => event.changes.map((change) => change.path),
    );
    fileFilterRef.current?.invalidateBinaryCache(changedPaths);
    invalidateImageCache(changedPaths);

    // Queue events for batched processing
    pendingEvents.push(...events);
    if (!batchStartTime) batchStartTime = Date.now();
    if (flushTimer) clearTimeout(flushTimer);
    const elapsed = Date.now() - batchStartTime;
    const nextFlush = Math.min(BATCH_WINDOW_MS, MAX_BATCH_WAIT_MS - elapsed);
    if (nextFlush <= 0) {
      flushBatch();
    } else {
      flushTimer = setTimeout(flushBatch, nextFlush);
    }
  });

  // Shared context for domain modules
  const fsCtx = {
    mainWindow: () => mainWindow,
    getActiveWorkspacePath: activeWorkspacePath,
    getWorkspaceConfig,
    saveWorkspaceConfig: (
      path: string,
      cfg: {
        selected_file: string | null;
        expanded_dirs: string[];
        agent_skip_permissions: boolean;
      },
    ) => saveWorkspaceConfig(path, cfg),
    fileFilter: () => fileFilterRef.current,
    forwardToWebview,
    trackEvent,
  };

  const wsCtx = {
    mainWindow: () => mainWindow,
    getActiveWorkspacePath: activeWorkspacePath,
    forwardToWebview,
  };

  const sharedCtx = {
    mainWindow: () => mainWindow,
    getActiveWorkspacePath: () =>
      activeWorkspacePath() || null,
    getWorkspaceConfig: (path: string) =>
      getWorkspaceConfig(path) as any,
    fileFilter: () => fileFilterRef.current as any,
    forwardToWebview,
    trackEvent,
  };

  // Register domain handlers
  registerFilesystemHandlers(fsCtx);
  registerWorkspaceHandlers(wsCtx, appConfig, fileFilterRef);
  registerKnowledgeHandlers(sharedCtx);
  registerCanvasHandlers(sharedCtx);
  registerMiscHandlers(sharedCtx);
}
