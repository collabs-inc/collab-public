import { parentPort, workerData } from "node:worker_threads";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

interface Request {
  id: number;
  op: string;
  path: string;
  size?: number;
  paths?: string[];
}

interface Response {
  id: number;
  result?: unknown;
  error?: string;
}

const NATIVE_FORMATS = new Set(["png", "jpeg", "gif", "webp"]);
const MAX_CACHE = 500;
const MAX_TOTAL_SIZE = 10_000_000;

const cacheDir: string | null = workerData?.cacheDir ?? null;
const memCache = new Map<string, string>();
let totalSize = 0;

if (cacheDir) {
  mkdirSync(cacheDir, { recursive: true });
}

function hashKey(path: string, size: number): string {
  return createHash("sha256")
    .update(`${path}\0${size}`)
    .digest("hex")
    .slice(0, 24);
}

function evictIfNeeded(): void {
  while (totalSize > MAX_TOTAL_SIZE || memCache.size > MAX_CACHE) {
    const firstKey = memCache.keys().next().value;
    if (firstKey === undefined) break;
    totalSize -= memCache.get(firstKey)?.length ?? 0;
    memCache.delete(firstKey);
  }
}

function diskCacheName(hash: string, mtimeMs: number): string {
  return `${hash}_${mtimeMs}.png`;
}

function readDiskCache(
  hash: string,
  mtimeMs: number,
): string | null {
  if (!cacheDir) return null;
  const filePath = join(cacheDir, diskCacheName(hash, mtimeMs));
  try {
    const buf = readFileSync(filePath);
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function writeDiskCache(
  hash: string,
  mtimeMs: number,
  pngBuffer: Buffer,
): void {
  if (!cacheDir) return;

  // Remove stale entries for this hash
  try {
    for (const entry of readdirSync(cacheDir)) {
      if (entry.startsWith(`${hash}_`) && entry.endsWith(".png")) {
        if (entry !== diskCacheName(hash, mtimeMs)) {
          unlinkSync(join(cacheDir, entry));
        }
      }
    }
  } catch {
    // Directory listing failed — not critical
  }

  try {
    writeFileSync(join(cacheDir, diskCacheName(hash, mtimeMs)), pngBuffer);
  } catch {
    // Write failed — not critical, in-memory cache still works
  }
}

async function thumbnail(
  path: string,
  size: number,
): Promise<string> {
  const memKey = `${path}\0${size}`;
  const cached = memCache.get(memKey);
  if (cached) return cached;

  const hash = hashKey(path, size);
  let mtimeMs = 0;
  try {
    mtimeMs = Math.floor(statSync(path).mtimeMs);
  } catch {
    // If stat fails, sharp will fail too — let it propagate
  }

  const diskHit = readDiskCache(hash, mtimeMs);
  if (diskHit) {
    const oldVal = memCache.get(memKey);
    if (oldVal) totalSize -= oldVal.length;
    totalSize += diskHit.length;
    evictIfNeeded();
    memCache.set(memKey, diskHit);
    return diskHit;
  }

  const buf = await sharp(path)
    .resize(size, size, { fit: "cover" })
    .png()
    .toBuffer();

  const dataUrl = `data:image/png;base64,${buf.toString("base64")}`;

  writeDiskCache(hash, mtimeMs, buf);
  const oldVal = memCache.get(memKey);
  if (oldVal) totalSize -= oldVal.length;
  totalSize += dataUrl.length;
  evictIfNeeded();
  memCache.set(memKey, dataUrl);

  return dataUrl;
}

async function full(
  path: string,
): Promise<{ url: string; width: number; height: number }> {
  const meta = await sharp(path).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const format = meta.format ?? "";

  if (NATIVE_FORMATS.has(format)) {
    return {
      url: `collab-file://${encodeURIComponent(path).replace(/%2F/g, "/")}`,
      width,
      height,
    };
  }

  const buf = await sharp(path).png().toBuffer();
  return {
    url: `data:image/png;base64,${buf.toString("base64")}`,
    width,
    height,
  };
}

function invalidate(paths: string[]): void {
  const hashes = new Set<string>();
  for (const path of paths) {
    for (const key of memCache.keys()) {
      if (key.startsWith(`${path}\0`)) {
        totalSize -= memCache.get(key)?.length ?? 0;
        memCache.delete(key);
        const size = Number(key.split("\0")[1]);
        if (size) hashes.add(hashKey(path, size));
      }
    }
  }

  if (!cacheDir || hashes.size === 0) return;
  try {
    for (const entry of readdirSync(cacheDir)) {
      const prefix = entry.split("_")[0];
      if (hashes.has(prefix)) {
        unlinkSync(join(cacheDir, entry));
      }
    }
  } catch {
    // Cleanup failure is not critical
  }
}

if (!parentPort) {
  throw new Error("image-worker must run inside a Worker thread");
}

parentPort.on("message", async (msg: Request) => {
  const resp: Response = { id: msg.id };

  try {
    switch (msg.op) {
      case "thumbnail":
        resp.result = await thumbnail(msg.path, msg.size ?? 128);
        break;
      case "full":
        resp.result = await full(msg.path);
        break;
      case "invalidate":
        invalidate(msg.paths ?? []);
        break;
      default:
        resp.error = `Unknown op: ${msg.op}`;
    }
  } catch (err) {
    resp.error =
      err instanceof Error ? err.message : String(err);
  }

  parentPort!.postMessage(resp);
});
