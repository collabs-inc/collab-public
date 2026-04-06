import { utilityProcess, type UtilityProcess } from "electron";
import { join } from "node:path";

export type FileChangeType = 1 | 2 | 3;

export interface FileChange {
  path: string;
  type: FileChangeType;
}

export interface FsChangeEvent {
  dirPath: string;
  changes: FileChange[];
}

type NotifyFn = (events: FsChangeEvent[]) => void;

const MAX_RESTARTS = 5;

let worker: UtilityProcess | null = null;
let notifyFn: NotifyFn | null = null;
let restartCount = 0;
let stopping = false;
const watchedPaths = new Set<string>();

function workerPath(): string {
  return join(__dirname, "watcher-worker.js");
}

export function startWorker(): void {
  if (worker) return;
  stopping = false;

  worker = utilityProcess.fork(workerPath());

  worker.on("message", (data: FsChangeEvent[]) => {
    notifyFn?.(data);
  });

  worker.on("exit", (code) => {
    worker = null;
    if (stopping) return;

    if (restartCount >= MAX_RESTARTS) {
      console.error(
        `[watcher] Worker exited ${MAX_RESTARTS} times, giving up`,
      );
      return;
    }

    console.warn(
      `[watcher] Worker exited with code ${code}, restarting`,
    );
    restartCount++;
    startWorker();

    for (const p of watchedPaths) {
      worker?.postMessage({ cmd: "watch-add", path: p });
    }
  });
}

export function setNotifyFn(fn: NotifyFn): void {
  notifyFn = fn;
}

export function watchWorkspace(workspacePath: string): void {
  if (!workspacePath || watchedPaths.has(workspacePath)) return;
  watchedPaths.add(workspacePath);
  worker?.postMessage({ cmd: "watch-add", path: workspacePath });
}

export function unwatchWorkspace(workspacePath: string): void {
  if (!watchedPaths.delete(workspacePath)) return;
  worker?.postMessage({ cmd: "watch-remove", path: workspacePath });
}

export function stopWorker(): void {
  if (!worker) return;
  stopping = true;
  watchedPaths.clear();
  worker.postMessage({ cmd: "close" });
  worker.kill();
  worker = null;
}
