import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
} from "electron";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  existsSync,
} from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { basename, extname, join } from "node:path";
import fm from "front-matter";
import { saveConfig, type AppConfig } from "./config";
import {
  loadWorkspaceConfig,
  saveWorkspaceConfig,
  type WorkspaceConfig,
} from "./workspace-config";
import { createFileFilter, type FileFilter } from "./file-filter";
import { setThumbnailCacheDir } from "./image-service";
import { shouldIncludeEntryWithContent, fsWriteFile } from "./files";
import * as watcher from "./watcher";
import * as wikilinkIndex from "./wikilink-index";
import * as agentActivity from "./agent-activity";
import { trackEvent } from "./analytics";
import type { TreeNode } from "@collab/shared/types";

export interface IpcWorkspaceContext {
  mainWindow: () => BrowserWindow | null;
  getActiveWorkspacePath: () => string;
  forwardToWebview: (
    target: string,
    channel: string,
    ...args: unknown[]
  ) => void;
}

const wsConfigMap = new Map<string, WorkspaceConfig>();

function getWsConfig(workspacePath: string): WorkspaceConfig {
  let config = wsConfigMap.get(workspacePath);
  if (!config) {
    config = loadWorkspaceConfig(workspacePath);
    wsConfigMap.set(workspacePath, config);
  }
  return config;
}

export function getWorkspaceConfig(
  path: string,
): WorkspaceConfig {
  return getWsConfig(path);
}

function ensureGitignoreEntry(workspacePath: string): void {
  const gitignorePath = join(workspacePath, ".gitignore");
  if (!existsSync(gitignorePath)) return;

  const content = readFileSync(gitignorePath, "utf-8");
  const lines = content.split("\n");
  const alreadyIgnored = lines.some(
    (l) => l.trim() === ".collaborator" || l.trim() === ".collaborator/",
  );
  if (alreadyIgnored) return;

  const suffix = content.endsWith("\n") ? "" : "\n";
  appendFileSync(
    gitignorePath,
    `${suffix}.collaborator\n`,
    "utf-8",
  );
}

function initWorkspaceFiles(workspacePath: string): void {
  const collabDir = join(workspacePath, ".collaborator");
  mkdirSync(collabDir, { recursive: true });
  ensureGitignoreEntry(workspacePath);
}

/**
 * Start all workspace-dependent services for the given path.
 * Handles watcher, file filter, wikilink index, agent activity,
 * thumbnail cache, and workspace config loading.
 */
export function startWorkspaceServices(
  path: string,
  fileFilterSetter: (f: FileFilter) => void,
): void {
  wsConfigMap.set(path, loadWorkspaceConfig(path));
  setThumbnailCacheDir(path);
  watcher.watchWorkspace(path);
  fileFilterSetter(createFileFilter());
  void wikilinkIndex.buildIndex(path);
  agentActivity.setWorkspacePath(path);
}

/**
 * Stop workspace services and reset state.
 */
export function stopWorkspaceServices(): void {
  watcher.watchWorkspace("");
  agentActivity.setWorkspacePath("");
}

function notifyWorkspaceChanged(
  ctx: IpcWorkspaceContext,
  path: string,
): void {
  ctx.forwardToWebview("nav", "workspace-changed", path);
  ctx.forwardToWebview("viewer", "workspace-changed", path);
  ctx.forwardToWebview("terminal", "workspace-changed", path);
  ctx.mainWindow()?.webContents.send("shell:workspace-changed", path);
}

const LEGACY_FM_FIELDS = new Set([
  "createdAt",
  "modifiedAt",
  "author",
]);

async function readTreeRecursive(
  dirPath: string,
  rootPath: string,
  filter: FileFilter | null,
): Promise<TreeNode[]> {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const folders: TreeNode[] = [];
  const files: TreeNode[] = [];

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (
      !(await shouldIncludeEntryWithContent(
        dirPath,
        entry,
        filter ?? undefined,
        rootPath,
      ))
    ) {
      continue;
    }

    let stats;
    try {
      stats = await stat(fullPath);
    } catch {
      continue;
    }

    const ctime = stats.birthtime.toISOString();
    const mtime = stats.mtime.toISOString();

    if (entry.isDirectory()) {
      const children = await readTreeRecursive(
        fullPath,
        rootPath,
        filter,
      );
      folders.push({
        path: fullPath,
        name: entry.name,
        kind: "folder",
        ctime,
        mtime,
        children,
      });
    } else {
      const stem = basename(entry.name, extname(entry.name));
      const node: TreeNode = {
        path: fullPath,
        name: stem,
        kind: "file",
        ctime,
        mtime,
      };

      if (entry.name.endsWith(".md")) {
        try {
          const fileContent = await readFile(
            fullPath,
            "utf-8",
          );
          const parsed = fm<Record<string, unknown>>(
            fileContent,
          );
          node.frontmatter = parsed.attributes;
          node.preview = parsed.body.slice(0, 200);
        } catch {
          // Skip frontmatter parsing on failure
        }
      }

      files.push(node);
    }
  }

  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return [...folders, ...files];
}

export function registerWorkspaceHandlers(
  ctx: IpcWorkspaceContext,
  appConfig: AppConfig,
  fileFilterRef: { current: FileFilter | null },
): void {
  function activeWsConfig(): WorkspaceConfig {
    const path = ctx.getActiveWorkspacePath();
    if (!path) {
      return {
        selected_file: null,
        expanded_dirs: [],
        agent_skip_permissions: false,
      };
    }
    return getWsConfig(path);
  }

  ipcMain.handle("config:get", () => appConfig);
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("app:restart", (event) => {
    // Allow the main window and webview guests hosted within it (e.g. settings).
    // BrowserWindow.fromWebContents returns null for <webview> guest contents,
    // so we also accept null — IPC is only reachable via our own preload scripts.
    const mainWin = ctx.mainWindow();
    if (!mainWin) return;
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin !== null && senderWin !== mainWin) return;

    if (app.isPackaged) {
      app.relaunch();
      app.quit();
    } else {
      // Dev mode: reload all windows to pick up changes without killing
      // the dev server (app.quit() would terminate the parent process).
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.reloadIgnoringCache();
      }
    }
  });

  ipcMain.handle(
    "workspace-pref:get",
    (_event, key: string) => {
      const config = activeWsConfig();
      if (key === "selected_file") return config.selected_file;
      if (key === "expanded_dirs") return config.expanded_dirs;
      if (key === "agent_skip_permissions")
        return config.agent_skip_permissions;
      return null;
    },
  );

  ipcMain.handle(
    "workspace-pref:set",
    (_event, key: string, value: unknown) => {
      const active = ctx.getActiveWorkspacePath();
      if (!active) return;
      const config = getWsConfig(active);
      if (key === "selected_file") {
        config.selected_file =
          (value as string | null) ?? null;
      } else if (key === "expanded_dirs") {
        config.expanded_dirs = Array.isArray(value)
          ? value
          : [];
      } else if (key === "agent_skip_permissions") {
        config.agent_skip_permissions = value === true;
      }
      saveWorkspaceConfig(active, config);
    },
  );

  ipcMain.handle(
    "shell:get-workspace-path",
    () => ctx.getActiveWorkspacePath() || null,
  );

  ipcMain.handle("workspace:list", () => ({
    workspaces: appConfig.workspaces,
    active: appConfig.active_workspace,
  }));

  ipcMain.handle("workspace:add", async () => {
    const win = ctx.mainWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    const chosen = realpathSync(result.filePaths[0]!);

    const existingIndex = appConfig.workspaces.indexOf(chosen);
    if (existingIndex !== -1) {
      if (existingIndex !== appConfig.active_workspace) {
        appConfig.active_workspace = existingIndex;
        saveConfig(appConfig);
        startWorkspaceServices(chosen, (f) => {
          fileFilterRef.current = f;
        });
        notifyWorkspaceChanged(ctx, chosen);
      }
      return {
        workspaces: appConfig.workspaces,
        active: existingIndex,
      };
    }

    const collabDir = join(chosen, ".collaborator");
    const isNew = !existsSync(collabDir);
    if (isNew) {
      initWorkspaceFiles(chosen);
    }

    appConfig.workspaces.push(chosen);
    appConfig.active_workspace = appConfig.workspaces.length - 1;
    saveConfig(appConfig);
    trackEvent("workspace_added", { is_new: isNew });

    startWorkspaceServices(chosen, (f) => {
      fileFilterRef.current = f;
    });
    notifyWorkspaceChanged(ctx, chosen);

    return {
      workspaces: appConfig.workspaces,
      active: appConfig.active_workspace,
    };
  });

  ipcMain.handle(
    "workspace:remove",
    (_event, index: number) => {
      if (index < 0 || index >= appConfig.workspaces.length) {
        return {
          workspaces: appConfig.workspaces,
          active: appConfig.active_workspace,
        };
      }

      const removedPath = appConfig.workspaces[index]!;
      wsConfigMap.delete(removedPath);

      const wasActive = index === appConfig.active_workspace;
      appConfig.workspaces.splice(index, 1);

      if (appConfig.workspaces.length === 0) {
        appConfig.active_workspace = -1;
      } else if (wasActive) {
        appConfig.active_workspace = Math.min(
          index,
          appConfig.workspaces.length - 1,
        );
      } else if (appConfig.active_workspace > index) {
        appConfig.active_workspace -= 1;
      }

      saveConfig(appConfig);
      trackEvent("workspace_removed");

      if (wasActive) {
        const newPath = ctx.getActiveWorkspacePath();
        if (newPath) {
          startWorkspaceServices(newPath, (f) => {
            fileFilterRef.current = f;
          });
          notifyWorkspaceChanged(ctx, newPath);
        } else {
          stopWorkspaceServices();
          fileFilterRef.current = null;
          notifyWorkspaceChanged(ctx, "");
        }
      }

      return {
        workspaces: appConfig.workspaces,
        active: appConfig.active_workspace,
      };
    },
  );

  ipcMain.handle(
    "workspace:switch",
    (_event, index: number) => {
      if (
        index < 0 ||
        index >= appConfig.workspaces.length ||
        index === appConfig.active_workspace
      ) {
        return;
      }

      appConfig.active_workspace = index;
      saveConfig(appConfig);
      trackEvent("workspace_switched");

      const newPath = appConfig.workspaces[index]!;
      startWorkspaceServices(newPath, (f) => {
        fileFilterRef.current = f;
      });
      notifyWorkspaceChanged(ctx, newPath);
    },
  );

  ipcMain.handle(
    "workspace:read-tree",
    async (
      _event,
      params: { root: string },
    ): Promise<TreeNode[]> => {
      const resolved = path.resolve(params.root);
      const workspace = ctx.getActiveWorkspacePath();
      const resolvedWs = workspace ? path.resolve(workspace) : "";
      if (!resolvedWs || (resolved !== resolvedWs && !resolved.startsWith(resolvedWs + path.sep))) {
        throw new Error("Path outside workspace");
      }
      return readTreeRecursive(resolved, resolved, fileFilterRef.current);
    },
  );

  ipcMain.handle(
    "workspace:update-frontmatter",
    async (
      _event,
      filePath: string,
      field: string,
      value: unknown,
    ): Promise<{ ok: boolean; retried?: boolean }> => {
      const resolved = path.resolve(filePath);
      const workspace = ctx.getActiveWorkspacePath();
      const resolvedWs = workspace ? path.resolve(workspace) : "";
      if (!resolvedWs || (resolved !== resolvedWs && !resolved.startsWith(resolvedWs + path.sep))) {
        throw new Error("Path outside workspace");
      }
      const MAX_ATTEMPTS = 3;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const fileStat = await stat(filePath);
        const expectedMtime = fileStat.mtime.toISOString();

        const content = await readFile(filePath, "utf-8");
        const parsed = fm<Record<string, unknown>>(content);
        const attrs = { ...parsed.attributes, [field]: value };

        for (const key of LEGACY_FM_FIELDS) {
          delete attrs[key];
        }

        const yaml = Object.entries(attrs)
          .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
          .join("\n");
        const output = `---\n${yaml}\n---\n${parsed.body}`;

        const result = await fsWriteFile(filePath, output, expectedMtime);
        if (result.ok) {
          return { ok: true, retried: attempt > 0 };
        }
      }
      return { ok: false };
    },
  );
}
