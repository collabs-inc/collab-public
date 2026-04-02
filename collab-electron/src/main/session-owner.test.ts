/**
 * Tests for session ownership verification logic.
 *
 * The actual `isSessionOwner` function in pty.ts depends on module-level
 * Maps that require native module loading. We re-implement the pure logic
 * here to verify the algorithm is correct.
 */
import { describe, test, expect } from "bun:test";

// ---------------------------------------------------------------------------
// Re-implement isSessionOwner logic identically to pty.ts
// ---------------------------------------------------------------------------

function createOwnershipChecker() {
  const sessionOwners = new Map<string, number>();
  let shellWebContentsId: number | null = null;

  return {
    setOwner(sessionId: string, wcId: number) {
      sessionOwners.set(sessionId, wcId);
    },
    deleteOwner(sessionId: string) {
      sessionOwners.delete(sessionId);
    },
    registerShell(wcId: number) {
      shellWebContentsId = wcId;
    },
    clearAll() {
      sessionOwners.clear();
    },
    isSessionOwner(sessionId: string, senderWebContentsId: number): boolean {
      const owner = sessionOwners.get(sessionId);
      if (owner == null) return true; // legacy session without ownership tracking
      if (owner === senderWebContentsId) return true;
      if (shellWebContentsId != null && senderWebContentsId === shellWebContentsId) return true;
      return false;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("isSessionOwner", () => {
  test("allows access when no owner is registered (legacy session)", () => {
    const checker = createOwnershipChecker();
    // No owner set — should allow any sender
    expect(checker.isSessionOwner("session-1", 100)).toBe(true);
    expect(checker.isSessionOwner("session-1", 999)).toBe(true);
  });

  test("allows access from the owning webContentsId", () => {
    const checker = createOwnershipChecker();
    checker.setOwner("session-1", 42);
    expect(checker.isSessionOwner("session-1", 42)).toBe(true);
  });

  test("denies access from a non-owning webContentsId", () => {
    const checker = createOwnershipChecker();
    checker.setOwner("session-1", 42);
    expect(checker.isSessionOwner("session-1", 99)).toBe(false);
  });

  test("allows shell window access to any owned session (in-process mode)", () => {
    const checker = createOwnershipChecker();
    checker.setOwner("session-1", 42);
    checker.registerShell(10); // shell window is webContentsId 10

    // Shell window can access any session
    expect(checker.isSessionOwner("session-1", 10)).toBe(true);
    // Owner still works
    expect(checker.isSessionOwner("session-1", 42)).toBe(true);
    // Random sender still denied
    expect(checker.isSessionOwner("session-1", 99)).toBe(false);
  });

  test("shell window has no special access when not registered", () => {
    const checker = createOwnershipChecker();
    checker.setOwner("session-1", 42);
    // No registerShell call — shellWebContentsId is null
    expect(checker.isSessionOwner("session-1", 10)).toBe(false);
  });

  test("deleting owner reverts to legacy (allow-all) behavior", () => {
    const checker = createOwnershipChecker();
    checker.setOwner("session-1", 42);
    expect(checker.isSessionOwner("session-1", 99)).toBe(false);

    checker.deleteOwner("session-1");
    expect(checker.isSessionOwner("session-1", 99)).toBe(true);
  });

  test("clearAll removes all ownership records", () => {
    const checker = createOwnershipChecker();
    checker.setOwner("session-1", 42);
    checker.setOwner("session-2", 43);
    expect(checker.isSessionOwner("session-1", 99)).toBe(false);

    checker.clearAll();
    expect(checker.isSessionOwner("session-1", 99)).toBe(true);
    expect(checker.isSessionOwner("session-2", 99)).toBe(true);
  });

  test("different sessions have independent ownership", () => {
    const checker = createOwnershipChecker();
    checker.setOwner("session-1", 42);
    checker.setOwner("session-2", 43);

    expect(checker.isSessionOwner("session-1", 42)).toBe(true);
    expect(checker.isSessionOwner("session-1", 43)).toBe(false);
    expect(checker.isSessionOwner("session-2", 43)).toBe(true);
    expect(checker.isSessionOwner("session-2", 42)).toBe(false);
  });

  test("owner ID 0 is a valid owner (not treated as null)", () => {
    const checker = createOwnershipChecker();
    checker.setOwner("session-1", 0);
    // Owner 0 should work — 0 is a valid webContentsId
    expect(checker.isSessionOwner("session-1", 0)).toBe(true);
    // Non-owner denied
    expect(checker.isSessionOwner("session-1", 1)).toBe(false);
  });
});
