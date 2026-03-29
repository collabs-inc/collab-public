import { describe, test, expect, beforeEach, afterEach } from "bun:test";

interface FileChange { path: string; type: number; }
interface FsChangeEvent { dirPath: string; changes: FileChange[]; }

function deduplicateEvents(events: FsChangeEvent[]): FsChangeEvent[] {
  const byDir = new Map<string, Map<string, FileChange>>();
  for (const event of events) {
    if (!byDir.has(event.dirPath)) byDir.set(event.dirPath, new Map());
    const dirMap = byDir.get(event.dirPath)!;
    for (const change of event.changes) {
      dirMap.set(change.path, change);
    }
  }
  return Array.from(byDir.entries()).map(([dirPath, changes]) => ({
    dirPath,
    changes: Array.from(changes.values()),
  }));
}

describe("watcher event batching", () => {
  describe("deduplicateEvents", () => {
    test("merges events from same directory", () => {
      const events: FsChangeEvent[] = [
        { dirPath: "/src", changes: [{ path: "/src/a.ts", type: 1 }] },
        { dirPath: "/src", changes: [{ path: "/src/b.ts", type: 1 }] },
      ];
      const result = deduplicateEvents(events);
      expect(result.length).toBe(1);
      expect(result[0].dirPath).toBe("/src");
      expect(result[0].changes.length).toBe(2);
    });

    test("last-write-wins for same file path", () => {
      const events: FsChangeEvent[] = [
        { dirPath: "/src", changes: [{ path: "/src/a.ts", type: 1 }] },
        { dirPath: "/src", changes: [{ path: "/src/a.ts", type: 2 }] },
      ];
      const result = deduplicateEvents(events);
      expect(result.length).toBe(1);
      expect(result[0].changes.length).toBe(1);
      expect(result[0].changes[0].type).toBe(2);
    });

    test("keeps events from different directories separate", () => {
      const events: FsChangeEvent[] = [
        { dirPath: "/src", changes: [{ path: "/src/a.ts", type: 1 }] },
        { dirPath: "/lib", changes: [{ path: "/lib/b.ts", type: 1 }] },
      ];
      const result = deduplicateEvents(events);
      expect(result.length).toBe(2);
    });

    test("50 events for same file deduplicates to 1", () => {
      const events: FsChangeEvent[] = [];
      for (let i = 0; i < 50; i++) {
        events.push({ dirPath: "/src", changes: [{ path: "/src/a.ts", type: 1 }] });
      }
      const result = deduplicateEvents(events);
      expect(result.length).toBe(1);
      expect(result[0].changes.length).toBe(1);
    });
  });

  describe("batch coalescing", () => {
    let pendingEvents: FsChangeEvent[];
    let flushTimer: ReturnType<typeof setTimeout> | null;
    let batchStartTime: number | null;
    let flushedBatches: FsChangeEvent[][];
    const BATCH_WINDOW_MS = 200;
    const MAX_BATCH_WAIT_MS = 2000;

    function flushBatch(): void {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      if (pendingEvents.length === 0) return;
      batchStartTime = null;
      const batch = deduplicateEvents(pendingEvents);
      pendingEvents = [];
      flushedBatches.push(batch);
    }

    function queueFsEvents(events: FsChangeEvent[]): void {
      pendingEvents.push(...events);
      if (!batchStartTime) batchStartTime = Date.now();
      if (flushTimer) clearTimeout(flushTimer);
      const elapsed = Date.now() - batchStartTime;
      const nextFlush = Math.min(BATCH_WINDOW_MS, MAX_BATCH_WAIT_MS - elapsed);
      if (nextFlush <= 0) {
        flushBatch();
      } else {
        flushTimer = setTimeout(flushBatch, nextFlush);
      }
    }

    beforeEach(() => {
      pendingEvents = [];
      flushTimer = null;
      batchStartTime = null;
      flushedBatches = [];
    });

    afterEach(() => {
      if (flushTimer) clearTimeout(flushTimer);
    });

    test("50 events in 50ms result in 1 flush", async () => {
      for (let i = 0; i < 50; i++) {
        queueFsEvents([{ dirPath: "/src", changes: [{ path: `/src/file-${i}.ts`, type: 1 }] }]);
      }
      expect(flushedBatches.length).toBe(0);
      await new Promise((r) => setTimeout(r, 250));
      expect(flushedBatches.length).toBe(1);
      expect(flushedBatches[0][0].changes.length).toBe(50);
    });

    test("safety flush at 2 seconds prevents starvation", async () => {
      const interval = setInterval(() => {
        queueFsEvents([{ dirPath: "/src", changes: [{ path: `/src/file-${Date.now()}.ts`, type: 1 }] }]);
      }, 150);
      await new Promise((r) => setTimeout(r, 2500));
      clearInterval(interval);
      expect(flushedBatches.length).toBeGreaterThanOrEqual(1);
    });
  });
});
