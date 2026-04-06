import { type BrowserWindow } from "electron";
import type { FileFilter } from "./file-filter";
import type { AppConfig } from "./config";
import { invalidateImageCache } from "./image-service";
import * as watcher from "./watcher";
import * as wikilinkIndex from "./wikilink-index";
import { trackEvent } from "./analytics";

import {
  registerFilesystemHandlers,
  getRecentlyRenamedRefCounts,
} from "./ipc-filesystem";
import {
  registerWorkspaceHandlers,
  startAllWorkspaceServices,
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

  if (appConfig.workspaces.length > 0) {
    startAllWorkspaceServices(appConfig.workspaces, (f) => {
      fileFilterRef.current = f;
    });
  }

  // File watcher notifications
  watcher.setNotifyFn((events) => {
    const changedPaths = events.flatMap(
      (event) => event.changes.map((change) => change.path),
    );
    fileFilterRef.current?.invalidateBinaryCache(changedPaths);
    invalidateImageCache(changedPaths);

    forwardToWebview("nav", "fs-changed", events);
    forwardToWebview("viewer", "fs-changed", events);

    for (const event of events) {
      for (const change of event.changes) {
        if (!change.path.endsWith(".md")) continue;
        if (change.type === FS_CHANGE_DELETED) {
          wikilinkIndex.removeFile(change.path);
        } else {
          void wikilinkIndex.updateFile(change.path);
        }
      }
    }

    const recentlyRenamed = getRecentlyRenamedRefCounts();
    const deletedPaths = events.flatMap((e) =>
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
      forwardToWebview(
        "viewer", "files-deleted", deletedPaths,
      );
    }
  });

  // Shared context for domain modules
  const fsCtx = {
    mainWindow: () => mainWindow,
    workspaces: () => appConfig.workspaces,
    fileFilter: () => fileFilterRef.current,
    forwardToWebview,
    trackEvent,
  };

  const wsCtx = {
    mainWindow: () => mainWindow,
    forwardToWebview,
  };

  const knowledgeCtx = {
    mainWindow: () => mainWindow,
    fileFilter: () => fileFilterRef.current as any,
    workspaces: () => appConfig.workspaces,
    forwardToWebview,
    trackEvent,
  };

  const canvasCtx = {
    mainWindow: () => mainWindow,
    forwardToWebview,
  };

  const miscCtx = {
    mainWindow: () => mainWindow,
    workspaces: () => appConfig.workspaces,
    forwardToWebview,
    trackEvent,
  };

  // Register domain handlers
  registerFilesystemHandlers(fsCtx);
  registerWorkspaceHandlers(wsCtx, appConfig, fileFilterRef);
  registerKnowledgeHandlers(knowledgeCtx);
  registerCanvasHandlers(canvasCtx);
  registerMiscHandlers(miscCtx);
}
