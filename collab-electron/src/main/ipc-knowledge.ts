import { ipcMain, shell, type BrowserWindow } from "electron";
import { extname } from "node:path";
import * as wikilinkIndex from "./wikilink-index";
import { buildWorkspaceGraph } from "./workspace-graph";
import * as agentActivity from "./agent-activity";
import { workspaceForFile } from "./ipc-workspace";

interface IpcContext {
  mainWindow: () => BrowserWindow | null;
  fileFilter: () => any | null;
  workspaces: () => string[];
  forwardToWebview: (
    target: string,
    channel: string,
    ...args: unknown[]
  ) => void;
  trackEvent: (
    name: string,
    props?: Record<string, unknown>,
  ) => void;
}

export function registerKnowledgeHandlers(
  ctx: IpcContext,
): void {
  // Wikilinks
  ipcMain.handle(
    "wikilink:resolve",
    (_event, target: string) => wikilinkIndex.resolve(target),
  );

  ipcMain.handle(
    "wikilink:suggest",
    (_event, partial: string) =>
      wikilinkIndex.suggest(partial),
  );

  ipcMain.handle(
    "wikilink:backlinks",
    (_event, filePath: string) =>
      wikilinkIndex.backlinksWithContext(filePath),
  );

  // Workspace graph
  ipcMain.handle(
    "workspace:get-graph",
    async (
      _event,
      params: { workspacePath: string },
    ) =>
      buildWorkspaceGraph(
        params.workspacePath,
        ctx.fileFilter(),
      ),
  );

  // Navigation
  ipcMain.on("nav:select-file", (_event, path) => {
    if (path) {
      ctx.trackEvent("file_selected", {
        ext: extname(path),
      });
      const workspace = workspaceForFile(
        path,
        ctx.workspaces(),
      );
      if (workspace) {
        agentActivity.setWorkspacePath(workspace);
      }
    }
    ctx.forwardToWebview("viewer", "file-selected", path);
    ctx.forwardToWebview("nav", "file-selected", path);
  });

  ipcMain.on(
    "nav:select-folder",
    (_event, path: string) => {
      ctx.trackEvent("folder_selected");
      ctx.forwardToWebview(
        "viewer",
        "folder-selected",
        path,
      );
    },
  );

  ipcMain.on(
    "nav:open-in-terminal",
    (_event, path: string) => {
      ctx.trackEvent("file_opened_in_terminal");
      ctx.forwardToWebview(
        "canvas",
        "open-terminal",
        path,
      );
    },
  );

  ipcMain.on(
    "nav:reveal-in-finder",
    (_event, path: string) => {
      ctx.trackEvent("file_revealed_in_finder");
      shell.showItemInFolder(path);
    },
  );

  ipcMain.on(
    "nav:create-graph-tile",
    (_event, folderPath: string) => {
      ctx.forwardToWebview(
        "canvas",
        "create-graph-tile",
        folderPath,
      );
    },
  );
}
