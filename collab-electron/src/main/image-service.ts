import { Worker } from "node:worker_threads";
import { access, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { toCollabFileUrl } from "@collab/shared/collab-file-url";
import { isSubpath } from "@collab/shared/path-utils";
import { IMAGE_EXTENSIONS, isImageFile } from "./file-filter";

const NATIVE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp",
]);

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const cacheDirs = new Set<string>();
const pending = new Map<number, Pending>();

export function setThumbnailCacheDir(workspacePath: string): void {
  cacheDirs.add(join(workspacePath, ".collaborator", "thumbnails"));
}

function ensureWorker(): Worker {
  if (worker) return worker;

  const firstCacheDir = cacheDirs.values().next().value ?? null;
  const w = new Worker(join(__dirname, "image-worker.js"), {
    workerData: { cacheDir: firstCacheDir },
  });

  w.on("message", (msg: { id: number; result?: unknown; error?: string }) => {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);

    if (msg.error) {
      p.reject(new Error(msg.error));
    } else {
      p.resolve(msg.result);
    }
  });

  w.on("error", (err) => {
    for (const p of pending.values()) {
      p.reject(err);
    }
    pending.clear();
    worker = null;
  });

  w.on("exit", () => {
    for (const p of pending.values()) {
      p.reject(new Error("Image worker exited unexpectedly"));
    }
    pending.clear();
    worker = null;
  });

  worker = w;
  return w;
}

function request(
  op: string,
  path: string,
  extra?: Record<string, unknown>,
): Promise<unknown> {
  const w = ensureWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, op, path, ...extra });
  });
}

function isInsideCacheDir(path: string): boolean {
  for (const dir of cacheDirs) {
    if (isSubpath(dir, path)) return true;
  }
  return false;
}

export function getImageThumbnail(
  path: string,
  size: number,
): Promise<string> {
  if (isInsideCacheDir(path)) return Promise.resolve("");
  return request("thumbnail", path, { size }) as Promise<string>;
}

function isNativeImage(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return false;
  return NATIVE_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

export function getImageFull(
  path: string,
): Promise<{ url: string; width: number; height: number }> {
  if (isInsideCacheDir(path)) {
    return Promise.resolve({ url: "", width: 0, height: 0 });
  }
  if (isNativeImage(path)) {
    const url = toCollabFileUrl(path);
    return Promise.resolve({ url, width: 0, height: 0 });
  }

  return request("full", path) as Promise<{
    url: string;
    width: number;
    height: number;
  }>;
}

export function invalidateImageCache(paths: string[]): void {
  if (!worker) return;
  const filtered = paths.filter((p) => !isInsideCacheDir(p));
  if (filtered.length === 0) return;
  const id = nextId++;
  worker.postMessage({ id, op: "invalidate", path: "", paths: filtered });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findImageInDir(
  dir: string,
  fileName: string,
): Promise<string | null> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.isFile() &&
        entry.name === fileName &&
        isImageFile(entry.name)
      ) {
        return join(dir, entry.name);
      }
    }
  } catch {
    // Directory unreadable — skip
  }
  return null;
}

async function collectSubdirs(dir: string): Promise<string[]> {
  const result: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        entry.name !== "node_modules"
      ) {
        result.push(join(dir, entry.name));
      }
    }
  } catch {
    // Directory unreadable — skip
  }
  return result;
}

export async function resolveImagePath(
  reference: string,
  fromNotePath: string,
  workspacePath: string,
): Promise<string | null> {
  if (!workspacePath) return null;

  const isRelative = /[\\/]/.test(reference);

  if (isRelative) {
    const noteDir = dirname(fromNotePath);
    const fromNote = join(noteDir, reference);
    if (
      isSubpath(workspacePath, fromNote) &&
      isImageFile(fromNote) &&
      await fileExists(fromNote)
    ) {
      return fromNote;
    }
    const fromRoot = join(workspacePath, reference);
    if (
      isSubpath(workspacePath, fromRoot) &&
      isImageFile(fromRoot) &&
      await fileExists(fromRoot)
    ) {
      return fromRoot;
    }
    return null;
  }

  const ext = reference.lastIndexOf(".");
  if (ext === -1 || !IMAGE_EXTENSIONS.has(
    reference.slice(ext).toLowerCase(),
  )) {
    return null;
  }

  const noteDir = dirname(fromNotePath);
  const visited = new Set<string>();

  let current = noteDir;
  while (isSubpath(workspacePath, current)) {
    const found = await findImageInDir(current, reference);
    if (found) return found;
    visited.add(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const MAX_BFS_DIRS = 500;
  const queue: string[] = [workspacePath];
  let qi = 0;
  while (qi < queue.length && visited.size < MAX_BFS_DIRS) {
    const dir = queue[qi++]!;
    if (visited.has(dir)) continue;
    visited.add(dir);

    const found = await findImageInDir(dir, reference);
    if (found) return found;

    const subdirs = await collectSubdirs(dir);
    queue.push(...subdirs);
  }

  return null;
}

export async function saveDroppedImage(
  noteDir: string,
  fileName: string,
  buffer: Buffer,
): Promise<string> {
  const safeName = basename(fileName);
  const dot = safeName.lastIndexOf(".");
  const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
  const ext = dot > 0 ? safeName.slice(dot) : "";

  let candidate = safeName;
  let suffix = 0;
  for (;;) {
    try {
      await writeFile(join(noteDir, candidate), buffer, { flag: "wx" });
      return candidate;
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        (err as NodeJS.ErrnoException).code === "EEXIST"
      ) {
        suffix++;
        candidate = `${stem}-${suffix}${ext}`;
        continue;
      }
      throw err;
    }
  }
}

export function stopImageWorker(): void {
  if (!worker) return;
  worker.terminate();
  for (const p of pending.values()) {
    p.reject(new Error("Image worker stopped"));
  }
  pending.clear();
  worker = null;
}
