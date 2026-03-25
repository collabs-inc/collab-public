/**
 * Tests for zoom/viewport logic in canvas-viewport.js.
 */
import { describe, test, expect } from "bun:test";
import { shouldZoom, ZOOM_LEVELS } from "./canvas-viewport.js";

// -- shouldZoom modifier key routing --

describe("shouldZoom", () => {
  test("ctrlKey triggers zoom on any platform", () => {
    expect(shouldZoom({ ctrlKey: true, metaKey: false }, true)).toBe(true);
    expect(shouldZoom({ ctrlKey: true, metaKey: false }, false)).toBe(true);
  });

  test("metaKey triggers zoom only on macOS", () => {
    expect(shouldZoom({ ctrlKey: false, metaKey: true }, true)).toBe(true);
    expect(shouldZoom({ ctrlKey: false, metaKey: true }, false)).toBe(false);
  });

  test("no modifier does not trigger zoom", () => {
    expect(shouldZoom({ ctrlKey: false, metaKey: false }, true)).toBe(false);
    expect(shouldZoom({ ctrlKey: false, metaKey: false }, false)).toBe(false);
  });

  test("both modifiers triggers zoom", () => {
    expect(shouldZoom({ ctrlKey: true, metaKey: true }, true)).toBe(true);
    expect(shouldZoom({ ctrlKey: true, metaKey: true }, false)).toBe(true);
  });
});

// -- Snap zoom levels --

describe("ZOOM_LEVELS", () => {
  test("has exactly 4 levels", () => {
    expect(ZOOM_LEVELS).toHaveLength(4);
  });

  test("levels are sorted ascending", () => {
    for (let i = 1; i < ZOOM_LEVELS.length; i++) {
      expect(ZOOM_LEVELS[i]).toBeGreaterThan(ZOOM_LEVELS[i - 1]);
    }
  });

  test("first level is 33%", () => {
    expect(ZOOM_LEVELS[0]).toBeCloseTo(0.33, 2);
  });

  test("last level is 100%", () => {
    expect(ZOOM_LEVELS[ZOOM_LEVELS.length - 1]).toBe(1);
  });

  test("all levels are positive", () => {
    for (const level of ZOOM_LEVELS) {
      expect(level).toBeGreaterThan(0);
    }
  });
});
