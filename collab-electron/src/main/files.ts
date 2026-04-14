import type { Dirent } from "node:fs";
import { renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { isSubpath } from "@collab/shared/path-utils";
import { type FileFilter, isImageFile, isPdfFile } from "./file-filter";

export interface DirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
  createdAt: string;
  modifiedAt: string;
  fileCount?: number;
}

export function shouldIncludeEntry(
  dirPath: string,
  entry: Dirent,
  filter?: FileFilter,
  rootPath?: string,
): boolean {
  const isDirectory = entry.isDirectory();

  if (!filter || !rootPath) {
    return true;
  }

  if (!isSubpath(rootPath, dirPath)) {
    return true;
  }

  const prefix = dirPath.length > rootPath.length
    ? dirPath.slice(rootPath.length + 1) + "/"
    : "";
  const relPath = prefix + entry.name;

  return !filter.isIgnored(
    isDirectory ? `${relPath}/` : relPath,
  );
}

export async function shouldIncludeEntryWithContent(
  dirPath: string,
  entry: Dirent,
  filter?: FileFilter,
  rootPath?: string,
): Promise<boolean> {
  if (!shouldIncludeEntry(dirPath, entry, filter, rootPath)) {
    return false;
  }

  if (!filter || entry.isDirectory()) {
    return true;
  }

  const fullPath = join(dirPath, entry.name);
  if (isImageFile(entry.name) || isPdfFile(entry.name)) {
    return true;
  }

  return !(await filter.isBinaryFile(fullPath));
}

export async function countTreeFiles(
  dirPath: string,
  filter?: FileFilter,
  rootPath?: string,
): Promise<number> {
  let count = 0;
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const e of entries) {
    if (!(await shouldIncludeEntryWithContent(dirPath, e, filter, rootPath))) {
      continue;
    }

    if (e.isDirectory()) {
      count += await countTreeFiles(
        join(dirPath, e.name),
        filter,
        rootPath,
      );
    } else {
      count += 1;
    }
  }
  return count;
}

export async function fsReadDir(
  dirPath: string,
  filter?: FileFilter,
  rootPath?: string,
): Promise<DirEntry[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const filtered: Dirent[] = [];
  for (const entry of entries) {
    if (await shouldIncludeEntryWithContent(dirPath, entry, filter, rootPath)) {
      filtered.push(entry);
    }
  }
  return Promise.all(
    filtered.map(async (e) => {
      let createdAt = "";
      let modifiedAt = "";
      let fileCount: number | undefined;
      if (e.isFile()) {
        try {
          const s = await stat(join(dirPath, e.name));
          createdAt = s.birthtime.toISOString();
          modifiedAt = s.mtime.toISOString();
        } catch {}
      } else if (e.isDirectory()) {
        try {
          fileCount = await countTreeFiles(
            join(dirPath, e.name),
            filter,
            rootPath,
          );
        } catch {}
      }
      const entry: DirEntry = {
        name: e.name,
        isDirectory: e.isDirectory(),
        isFile: e.isFile(),
        isSymlink: e.isSymbolicLink(),
        createdAt,
        modifiedAt,
      };
      if (fileCount !== undefined) entry.fileCount = fileCount;
      return entry;
    }),
  );
}

export async function fsReadFile(filePath: string): Promise<string> {
  return readFile(filePath, "utf-8");
}

export interface WriteResult {
  ok: boolean;
  mtime: string;
  conflict?: boolean;
}

export async function fsWriteFile(
  filePath: string,
  content: string,
  expectedMtime?: string,
): Promise<WriteResult> {
  if (expectedMtime) {
    try {
      const before = await stat(filePath);
      if (before.mtime.toISOString() !== expectedMtime) {
        return {
          ok: false,
          mtime: before.mtime.toISOString(),
          conflict: true,
        };
      }
    } catch {
      // File doesn't exist yet — no conflict
    }
  }

  await writeFile(filePath, content, "utf-8");
  const after = await stat(filePath);
  return { ok: true, mtime: after.mtime.toISOString() };
}

export function atomicWriteFileSync(
  filePath: string,
  data: string,
): void {
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  writeFileSync(tmpPath, data, "utf-8");
  renameSync(tmpPath, filePath);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function fsRename(
  oldPath: string,
  newName: string,
): Promise<string> {
  const dir = dirname(oldPath);
  let target = join(dir, newName);
  if (oldPath === target) return oldPath;

  const ext = newName.slice(newName.lastIndexOf("."));
  const stem = newName.slice(0, newName.lastIndexOf("."));
  let n = 2;
  while (await fileExists(target)) {
    target = join(dir, `${stem} ${n}${ext}`);
    n++;
  }

  await rename(oldPath, target);
  return target;
}

export async function fsMkdir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function fsMove(
  oldPath: string,
  newParentDir: string,
): Promise<string> {
  const name = basename(oldPath);
  let target = join(newParentDir, name);

  if (oldPath === target) return oldPath;

  const ext = extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  let n = 2;
  while (await fileExists(target)) {
    target = join(newParentDir, ext ? `${stem} ${n}${ext}` : `${stem} ${n}`);
    n++;
  }

  await rename(oldPath, target);
  return target;
}
