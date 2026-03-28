import { describe, test, expect, beforeEach, afterEach } from "bun:test";

describe("PTY idle-based foreground check", () => {
  let lastDataTime: Map<string, number>;
  let fgTimers: Map<string, ReturnType<typeof setTimeout>>;
  let checkCount: number;
  const STATUS_DEBOUNCE_MS = 500;

  function doForegroundCheck(_sessionId: string): void {
    checkCount++;
  }

  function markForegroundDirty(sessionId: string): void {
    lastDataTime.set(sessionId, Date.now());
    if (fgTimers.has(sessionId)) return;

    fgTimers.set(sessionId, setTimeout(function check() {
      const last = lastDataTime.get(sessionId) ?? 0;
      const elapsed = Date.now() - last;
      if (elapsed >= STATUS_DEBOUNCE_MS) {
        fgTimers.delete(sessionId);
        lastDataTime.delete(sessionId);
        doForegroundCheck(sessionId);
      } else {
        fgTimers.set(sessionId, setTimeout(check, STATUS_DEBOUNCE_MS - elapsed));
      }
    }, STATUS_DEBOUNCE_MS));
  }

  function cleanupSession(sessionId: string): void {
    lastDataTime.delete(sessionId);
    const timer = fgTimers.get(sessionId);
    if (timer) { clearTimeout(timer); fgTimers.delete(sessionId); }
  }

  beforeEach(() => {
    lastDataTime = new Map();
    fgTimers = new Map();
    checkCount = 0;
  });

  afterEach(() => {
    for (const timer of fgTimers.values()) clearTimeout(timer);
    fgTimers.clear();
    lastDataTime.clear();
  });

  test("1000 data events in burst — check called 0 times during burst", async () => {
    for (let i = 0; i < 1000; i++) {
      markForegroundDirty("test-1");
    }
    expect(checkCount).toBe(0);
    expect(fgTimers.size).toBe(1);
  });

  test("check fires once after output quiesces", async () => {
    markForegroundDirty("test-2");
    await new Promise((r) => setTimeout(r, 600));
    expect(checkCount).toBe(1);
    expect(fgTimers.size).toBe(0);
    expect(lastDataTime.size).toBe(0);
  });

  test("cleanup prevents timer leak", () => {
    markForegroundDirty("test-3");
    expect(fgTimers.size).toBe(1);
    cleanupSession("test-3");
    expect(fgTimers.size).toBe(0);
    expect(lastDataTime.size).toBe(0);
  });

  test("multiple sessions operate independently", async () => {
    markForegroundDirty("session-a");
    markForegroundDirty("session-b");
    expect(fgTimers.size).toBe(2);

    cleanupSession("session-a");
    expect(fgTimers.size).toBe(1);
    expect(fgTimers.has("session-b")).toBe(true);

    await new Promise((r) => setTimeout(r, 600));
    expect(checkCount).toBe(1);
  });
});
