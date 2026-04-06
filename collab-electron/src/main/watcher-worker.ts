import watcher, { type AsyncSubscription, type Event } from "@parcel/watcher";
import { dirname } from "node:path";

type FileChangeType = 1 | 2 | 3;

interface FsChangeEvent {
  dirPath: string;
  changes: Array<{ path: string; type: FileChangeType }>;
}

const IGNORE = [
  "**/.git/**",
  "**/.DS_Store",
  "**/Thumbs.db",
  "**/node_modules/**",
  "**/bower_components/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/.next/**",
  "**/.cache/**",
  "**/__pycache__/**",
  "**/*.min.js",
  "**/*.min.css",
  "**/*.map",
];

const EVENT_TYPE_MAP: Record<Event["type"], FileChangeType> = {
  create: 1,
  update: 2,
  delete: 3,
};

interface WatchAddCommand {
  cmd: "watch-add" | "watch";
  path: string;
}

interface WatchRemoveCommand {
  cmd: "watch-remove";
  path: string;
}

interface CloseCommand {
  cmd: "close";
}

type WorkerCommand = WatchAddCommand | WatchRemoveCommand | CloseCommand;

const subscriptions = new Map<string, AsyncSubscription>();

function toFsChangeEvents(events: Event[]): FsChangeEvent[] {
  const byDir = new Map<
    string,
    Array<{ path: string; type: FileChangeType }>
  >();

  for (const event of events) {
    const dir = dirname(event.path);
    let entries = byDir.get(dir);
    if (!entries) {
      entries = [];
      byDir.set(dir, entries);
    }
    entries.push({
      path: event.path,
      type: EVENT_TYPE_MAP[event.type],
    });
  }

  const result: FsChangeEvent[] = [];
  for (const [dirPath, changes] of byDir) {
    result.push({ dirPath, changes });
  }
  return result;
}

async function watchAdd(folderPath: string): Promise<void> {
  if (subscriptions.has(folderPath)) return;

  try {
    const sub = await watcher.subscribe(
      folderPath,
      (error, events) => {
        if (error) {
          console.error(
            `[watcher-worker] ${folderPath}: ${error.message}`,
          );
          return;
        }
        if (events.length === 0) return;
        process.parentPort.postMessage(toFsChangeEvents(events));
      },
      { ignore: IGNORE },
    );
    subscriptions.set(folderPath, sub);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    console.error(
      `[watcher-worker] Failed to watch ${folderPath}: ${err.message}`,
    );
  }
}

async function watchRemove(folderPath: string): Promise<void> {
  const sub = subscriptions.get(folderPath);
  if (!sub) return;
  try {
    await sub.unsubscribe();
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    console.error(
      `[watcher-worker] Failed to unwatch ${folderPath}: ${err.message}`,
    );
  }
  subscriptions.delete(folderPath);
}

async function unwatchAll(): Promise<void> {
  for (const [path, sub] of subscriptions.entries()) {
    try {
      await sub.unsubscribe();
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      console.error(
        `[watcher-worker] Failed to unwatch ${path}: ${err.message}`,
      );
    }
  }
  subscriptions.clear();
}

const keepAlive = setInterval(() => {}, 2 ** 31 - 1);

let pending: Promise<void> = Promise.resolve();

process.parentPort.on("message", ({ data }: { data: WorkerCommand }) => {
  if (data.cmd === "watch-add" || data.cmd === "watch") {
    pending = pending.then(() => watchAdd(data.path));
  } else if (data.cmd === "watch-remove") {
    pending = pending.then(() => watchRemove(data.path));
  } else if (data.cmd === "close") {
    clearInterval(keepAlive);
    pending.then(() => unwatchAll()).then(() => process.exit(0));
  }
});
