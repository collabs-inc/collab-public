import { ipcMain, shell, type BrowserWindow } from "electron";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import fm from "front-matter";
import { workspaceRootMatch } from "@collab/shared/path-utils";
import {
  countTreeFiles,
  fsReadDir,
  fsReadFile,
  fsWriteFile,
  fsRename,
  fsMkdir,
  fsMove,
} from "./files";
import {
  getImageThumbnail,
  getImageFull,
  resolveImagePath,
  saveDroppedImage,
} from "./image-service";
import type { FileFilter } from "./file-filter";
import * as wikilinkIndex from "./wikilink-index";
import { workspaceForFile } from "./ipc-workspace";
import type {
  FolderTableData,
  FolderTableFile,
} from "@collab/shared/types";

export interface IpcFilesystemContext {
  mainWindow: () => BrowserWindow | null;
  workspaces: () => string[];
  fileFilter: () => FileFilter | null;
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

const recentlyRenamedRefCounts = new Map<string, number>();

export function getRecentlyRenamedRefCounts(): Map<string, number> {
  return recentlyRenamedRefCounts;
}

function bumpRenameRefCount(oldPath: string): void {
  recentlyRenamedRefCounts.set(
    oldPath,
    (recentlyRenamedRefCounts.get(oldPath) ?? 0) + 1,
  );
  setTimeout(() => {
    const count =
      (recentlyRenamedRefCounts.get(oldPath) ?? 1) - 1;
    if (count <= 0) recentlyRenamedRefCounts.delete(oldPath);
    else recentlyRenamedRefCounts.set(oldPath, count);
  }, 2000);
}

export function registerFilesystemHandlers(
  ctx: IpcFilesystemContext,
): void {
  ipcMain.handle("fs:readdir", (_event, path) =>
    fsReadDir(
      path,
      ctx.fileFilter() ?? undefined,
      workspaceForFile(path, ctx.workspaces()) ?? undefined,
    ),
  );

  ipcMain.handle("fs:count-files", (_event, path) =>
    countTreeFiles(
      path,
      ctx.fileFilter() ?? undefined,
      workspaceForFile(path, ctx.workspaces()) ?? undefined,
    ),
  );

  ipcMain.handle("fs:readfile", (_event, path) =>
    fsReadFile(path),
  );

  ipcMain.handle(
    "fs:writefile",
    async (_event, path, content, expectedMtime?: string) => {
      const result = await fsWriteFile(
        path,
        content,
        expectedMtime,
      );
      if (result.ok) {
        ctx.trackEvent("file_saved", { ext: extname(path) });
        ctx.fileFilter()?.invalidateBinaryCache([path]);
        const event = [
          {
            dirPath: dirname(path),
            changes: [{ path, type: 1 }],
          },
        ];
        ctx.forwardToWebview("nav", "fs-changed", event);
        ctx.forwardToWebview("viewer", "fs-changed", event);
      }
      return result;
    },
  );

  ipcMain.handle(
    "fs:rename",
    async (_event, oldPath: string, newTitle: string) => {
      const sanitized = newTitle
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
        .replace(/\.\s*$/, "")
        .trim();
      if (sanitized.length === 0) {
        throw new Error("Title cannot be empty");
      }
      const ext = extname(oldPath);
      bumpRenameRefCount(oldPath);
      const newPath = await fsRename(
        oldPath,
        `${sanitized}${ext}`,
      );
      ctx.trackEvent("file_renamed");
      ctx.fileFilter()?.invalidateBinaryCache([oldPath, newPath]);

      const updatedFiles = await wikilinkIndex.handleRename(
        oldPath,
        newPath,
      );

      ctx.forwardToWebview(
        "viewer",
        "file-renamed",
        oldPath,
        newPath,
      );
      ctx.forwardToWebview(
        "nav",
        "file-renamed",
        oldPath,
        newPath,
      );

      if (updatedFiles.length > 0) {
        ctx.forwardToWebview(
          "viewer",
          "wikilinks-updated",
          updatedFiles,
        );
      }

      return newPath;
    },
  );

  ipcMain.handle("fs:stat", async (_event, path: string) => {
    const stats = await stat(path);
    return {
      ctime: stats.birthtime.toISOString(),
      mtime: stats.mtime.toISOString(),
    };
  });

  ipcMain.handle("fs:is-directory", async (_event, filePath: string) => {
    try {
      const s = await stat(filePath);
      return s.isDirectory();
    } catch {
      return false;
    }
  });

  ipcMain.handle("fs:trash", async (_event, path: string) => {
    await shell.trashItem(path);
    ctx.trackEvent("file_trashed");
    ctx.fileFilter()?.invalidateBinaryCache([path]);
  });

  ipcMain.handle("fs:mkdir", async (_event, path: string) => {
    await fsMkdir(path);
    ctx.trackEvent("folder_created");
    const event = [
      {
        dirPath: dirname(path),
        changes: [{ path, type: 1 }],
      },
    ];
    ctx.forwardToWebview("nav", "fs-changed", event);
    ctx.forwardToWebview("viewer", "fs-changed", event);
  });

  ipcMain.handle(
    "fs:move",
    async (_event, oldPath: string, newParentDir: string) => {
      bumpRenameRefCount(oldPath);
      const newPath = await fsMove(oldPath, newParentDir);
      ctx.trackEvent("file_moved");
      ctx.fileFilter()?.invalidateBinaryCache([oldPath, newPath]);

      ctx.forwardToWebview(
        "viewer",
        "file-renamed",
        oldPath,
        newPath,
      );
      ctx.forwardToWebview(
        "nav",
        "file-renamed",
        oldPath,
        newPath,
      );

      return newPath;
    },
  );

  ipcMain.handle(
    "fs:read-folder-table",
    async (
      _event,
      folderPath: string,
    ): Promise<FolderTableData> => {
      const workspace = workspaceForFile(
        folderPath,
        ctx.workspaces(),
      );
      if (!workspace || !workspaceRootMatch(workspace, folderPath)) {
        throw new Error("Folder is outside workspace");
      }
      const entries = await readdir(folderPath, {
        withFileTypes: true,
      });
      const columnSet = new Set<string>();
      const mdEntries = entries.filter(
        (e) => e.isFile() && e.name.endsWith(".md"),
      );

      const files = (
        await Promise.all(
          mdEntries.map(
            async (
              entry,
            ): Promise<FolderTableFile | null> => {
              const fullPath = join(folderPath, entry.name);
              try {
                const [stats, content] = await Promise.all([
                  stat(fullPath),
                  readFile(fullPath, "utf-8"),
                ]);
                let attributes: Record<string, unknown> = {};
                try {
                  attributes =
                    fm<Record<string, unknown>>(
                      content,
                    ).attributes;
                } catch {
                  // Malformed frontmatter
                }
                for (const key of Object.keys(attributes)) {
                  columnSet.add(key);
                }
                return {
                  path: fullPath,
                  filename: entry.name,
                  frontmatter: attributes,
                  mtime: stats.mtime.toISOString(),
                  ctime: stats.birthtime.toISOString(),
                };
              } catch {
                return null;
              }
            },
          ),
        )
      ).filter((f): f is FolderTableFile => f !== null);

      const columns = [...columnSet].sort((a, b) =>
        a.localeCompare(b),
      );
      return { folderPath, files, columns };
    },
  );

  // Image handlers
  ipcMain.handle(
    "image:thumbnail",
    (_event, path: string, size: number) =>
      getImageThumbnail(path, size),
  );

  ipcMain.handle("image:full", (_event, path: string) =>
    getImageFull(path),
  );

  ipcMain.handle(
    "image:resolve-path",
    (_event, reference: string, fromNotePath: string) =>
      resolveImagePath(
        reference,
        fromNotePath,
        workspaceForFile(fromNotePath, ctx.workspaces()) ?? "",
      ),
  );

  ipcMain.handle(
    "image:save-dropped",
    async (
      _event,
      noteDir: string,
      fileName: string,
      buffer: ArrayBuffer,
    ) => {
      const ws = workspaceForFile(noteDir, ctx.workspaces());
      if (!ws || !workspaceRootMatch(ws, noteDir)) {
        throw new Error("Target directory is outside workspace");
      }
      return saveDroppedImage(
        noteDir,
        fileName,
        Buffer.from(buffer),
      );
    },
  );
}
