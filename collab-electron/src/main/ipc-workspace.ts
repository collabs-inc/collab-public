import {
  app,
  ipcMain,
  dialog,
  type BrowserWindow,
} from "electron";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  existsSync,
} from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
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
import { trackEvent } from "./analytics";
import type { TreeNode } from "@collab/shared/types";

export interface IpcWorkspaceContext {
  mainWindow: () => BrowserWindow | null;
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
 * Derive which workspace owns a file path by prefix match.
 */
export function workspaceForFile(
  filePath: string,
  workspaces: string[],
): string | null {
  return (
    workspaces.find(
      (ws) => filePath === ws || filePath.startsWith(ws + "/"),
    ) ?? null
  );
}

/**
 * Start workspace-dependent services for every configured workspace.
 */
export function startAllWorkspaceServices(
  workspaces: string[],
  fileFilterSetter: (f: FileFilter) => void,
): void {
  for (const ws of workspaces) {
    wsConfigMap.set(ws, loadWorkspaceConfig(ws));
    setThumbnailCacheDir(ws);
    watcher.watchWorkspace(ws);
    void wikilinkIndex.buildIndex(ws);
  }
  fileFilterSetter(createFileFilter());
}

/**
 * Start workspace services for a single newly-added workspace.
 */
export function startSingleWorkspaceServices(
  path: string,
  fileFilterSetter: (f: FileFilter) => void,
): void {
  wsConfigMap.set(path, loadWorkspaceConfig(path));
  setThumbnailCacheDir(path);
  watcher.watchWorkspace(path);
  fileFilterSetter(createFileFilter());
  void wikilinkIndex.buildIndex(path);
}

/**
 * Stop workspace services for a single removed workspace.
 */
export function stopSingleWorkspaceServices(
  path: string,
): void {
  watcher.unwatchWorkspace(path);
  wsConfigMap.delete(path);
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
  ipcMain.handle("config:get", () => appConfig);
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("app:commit-sha", () => __GIT_COMMIT_SHA__);

  ipcMain.handle(
    "workspace-pref:get",
    (
      _event,
      params: { key: string; workspacePath: string },
    ) => {
      if (!params.workspacePath) return null;
      const config = getWsConfig(params.workspacePath);
      if (params.key === "expanded_dirs")
        return config.expanded_dirs;
      if (params.key === "agent_skip_permissions")
        return config.agent_skip_permissions;
      return null;
    },
  );

  ipcMain.handle(
    "workspace-pref:set",
    (
      _event,
      params: {
        key: string;
        workspacePath: string;
        value: unknown;
      },
    ) => {
      if (!params.workspacePath) return;
      const config = getWsConfig(params.workspacePath);
      if (params.key === "expanded_dirs") {
        config.expanded_dirs = Array.isArray(params.value)
          ? params.value
          : [];
      } else if (params.key === "agent_skip_permissions") {
        config.agent_skip_permissions =
          params.value === true;
      }
      saveWorkspaceConfig(params.workspacePath, config);
    },
  );

  ipcMain.handle("workspace:list", () => ({
    workspaces: appConfig.workspaces,
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

    if (appConfig.workspaces.includes(chosen)) {
      return { workspaces: appConfig.workspaces };
    }

    const collabDir = join(chosen, ".collaborator");
    const isNew = !existsSync(collabDir);
    if (isNew) {
      initWorkspaceFiles(chosen);
    }

    appConfig.workspaces.push(chosen);
    saveConfig(appConfig);
    trackEvent("workspace_added", { is_new: isNew });

    startSingleWorkspaceServices(chosen, (f) => {
      fileFilterRef.current = f;
    });
    ctx.forwardToWebview("nav", "workspace-added", chosen);

    return { workspaces: appConfig.workspaces };
  });

  ipcMain.handle(
    "workspace:remove",
    (_event, index: number) => {
      if (index < 0 || index >= appConfig.workspaces.length) {
        return { workspaces: appConfig.workspaces };
      }

      const removedPath = appConfig.workspaces[index]!;
      appConfig.workspaces.splice(index, 1);
      saveConfig(appConfig);
      trackEvent("workspace_removed");

      stopSingleWorkspaceServices(removedPath);
      ctx.forwardToWebview(
        "nav",
        "workspace-removed",
        removedPath,
      );

      return { workspaces: appConfig.workspaces };
    },
  );

  ipcMain.handle(
    "workspace:remove-by-path",
    (_event, path: string) => {
      const index = appConfig.workspaces.indexOf(path);
      if (index === -1) {
        return { workspaces: appConfig.workspaces };
      }

      appConfig.workspaces.splice(index, 1);
      saveConfig(appConfig);
      trackEvent("workspace_removed");

      stopSingleWorkspaceServices(path);
      ctx.forwardToWebview(
        "nav",
        "workspace-removed",
        path,
      );

      return { workspaces: appConfig.workspaces };
    },
  );

  ipcMain.handle(
    "workspace:read-tree",
    async (
      _event,
      params: { root: string },
    ): Promise<TreeNode[]> => {
      return readTreeRecursive(
        params.root,
        params.root,
        fileFilterRef.current,
      );
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
