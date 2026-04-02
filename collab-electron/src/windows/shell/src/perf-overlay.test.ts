/**
 * Tests for perf-overlay pure logic: FPS accumulation, circular buffer
 * indexing, color thresholds, and graph math.
 *
 * The actual overlay requires DOM/canvas APIs so we re-implement and test
 * the pure math here.
 */
import { describe, test, expect } from "bun:test";

// ---------------------------------------------------------------------------
// Re-implement constants and helpers identically to the source.
// ---------------------------------------------------------------------------

const HISTORY_SIZE = 120;
const TARGET_FPS = 60;
const GRAPH_MAX_MS = 50;

function fpsColor(fps: number): string {
  if (fps >= TARGET_FPS - 2) return "#4caf50";
  if (fps >= 30) return "#ffeb3b";
  return "#f44336";
}

function msColor(ms: number): string {
  if (ms <= 16.7) return "#4caf50";
  if (ms <= 33.3) return "#ffeb3b";
  return "#f44336";
}

// ---------------------------------------------------------------------------
// fpsColor
// ---------------------------------------------------------------------------

describe("fpsColor", () => {
  test("green at 60 FPS", () => {
    expect(fpsColor(60)).toBe("#4caf50");
  });

  test("green at 58 FPS (within threshold)", () => {
    expect(fpsColor(58)).toBe("#4caf50");
  });

  test("yellow at 57 FPS", () => {
    expect(fpsColor(57)).toBe("#ffeb3b");
  });

  test("yellow at 30 FPS", () => {
    expect(fpsColor(30)).toBe("#ffeb3b");
  });

  test("red at 29 FPS", () => {
    expect(fpsColor(29)).toBe("#f44336");
  });

  test("red at 0 FPS", () => {
    expect(fpsColor(0)).toBe("#f44336");
  });

  test("green at 120 FPS", () => {
    expect(fpsColor(120)).toBe("#4caf50");
  });
});

// ---------------------------------------------------------------------------
// msColor
// ---------------------------------------------------------------------------

describe("msColor", () => {
  test("green at 16.7ms (60fps budget)", () => {
    expect(msColor(16.7)).toBe("#4caf50");
  });

  test("green at 0ms", () => {
    expect(msColor(0)).toBe("#4caf50");
  });

  test("yellow at 16.8ms", () => {
    expect(msColor(16.8)).toBe("#ffeb3b");
  });

  test("yellow at 33.3ms (30fps budget)", () => {
    expect(msColor(33.3)).toBe("#ffeb3b");
  });

  test("red at 33.4ms", () => {
    expect(msColor(33.4)).toBe("#f44336");
  });

  test("red at 100ms", () => {
    expect(msColor(100)).toBe("#f44336");
  });
});

// ---------------------------------------------------------------------------
// Circular buffer indexing
// ---------------------------------------------------------------------------

describe("circular buffer indexing", () => {
  test("wraps correctly at HISTORY_SIZE boundary", () => {
    let historyIndex = 0;
    for (let i = 0; i < HISTORY_SIZE + 10; i++) {
      historyIndex = (historyIndex + 1) % HISTORY_SIZE;
    }
    expect(historyIndex).toBe(10);
  });

  test("oldest-to-newest traversal reads all entries", () => {
    const data = new Float32Array(HISTORY_SIZE);
    let historyIndex = 50; // simulate mid-buffer
    data[50] = 99; // this is the next write position

    // Fill 120 entries
    for (let i = 0; i < HISTORY_SIZE; i++) {
      data[historyIndex] = i;
      historyIndex = (historyIndex + 1) % HISTORY_SIZE;
    }
    expect(historyIndex).toBe(50); // back to where we started

    // Read oldest to newest from historyIndex
    const readOrder: number[] = [];
    for (let i = 0; i < HISTORY_SIZE; i++) {
      const idx = (historyIndex + i) % HISTORY_SIZE;
      readOrder.push(data[idx]);
    }
    // Oldest is entry 0, newest is entry 119
    expect(readOrder[0]).toBe(0);
    expect(readOrder[HISTORY_SIZE - 1]).toBe(HISTORY_SIZE - 1);
  });

  test("all indices in range [0, HISTORY_SIZE)", () => {
    for (let start = 0; start < HISTORY_SIZE; start++) {
      for (let i = 0; i < HISTORY_SIZE; i++) {
        const idx = (start + i) % HISTORY_SIZE;
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(HISTORY_SIZE);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// FPS accumulation
// ---------------------------------------------------------------------------

describe("FPS accumulation", () => {
  test("calculates correct FPS from 60 uniform frames", () => {
    let frameCount = 0;
    let fpsAccum = 0;
    let currentFps = 0;

    // 60 frames at 16.667ms each = 1000ms
    for (let i = 0; i < 60; i++) {
      const dt = 16.667;
      frameCount++;
      fpsAccum += dt;

      if (fpsAccum >= 1000) {
        currentFps = Math.round((frameCount * 1000) / fpsAccum);
        frameCount = 0;
        fpsAccum = 0;
      }
    }

    expect(currentFps).toBe(60);
  });

  test("calculates correct FPS from 30 uniform frames", () => {
    let frameCount = 0;
    let fpsAccum = 0;
    let currentFps = 0;

    // 31 frames to push past the 1000ms accumulation threshold
    for (let i = 0; i < 31; i++) {
      const dt = 33.334;
      frameCount++;
      fpsAccum += dt;

      if (fpsAccum >= 1000) {
        currentFps = Math.round((frameCount * 1000) / fpsAccum);
        frameCount = 0;
        fpsAccum = 0;
      }
    }

    expect(currentFps).toBe(30);
  });

  test("running estimate kicks in after 100ms", () => {
    let frameCount = 0;
    let fpsAccum = 0;
    let currentFps = 0;

    // 7 frames at ~16.67ms = ~116ms
    for (let i = 0; i < 7; i++) {
      const dt = 16.667;
      frameCount++;
      fpsAccum += dt;

      if (fpsAccum >= 1000) {
        currentFps = Math.round((frameCount * 1000) / fpsAccum);
        frameCount = 0;
        fpsAccum = 0;
      } else if (currentFps === 0 && fpsAccum > 100) {
        currentFps = Math.round((frameCount * 1000) / fpsAccum);
      }
    }

    // Should have a running estimate now, approximately 60
    expect(currentFps).toBeGreaterThan(55);
    expect(currentFps).toBeLessThan(65);
  });
});

// ---------------------------------------------------------------------------
// Graph Y coordinate math
// ---------------------------------------------------------------------------

describe("graph Y coordinate math", () => {
  const gy = 90;
  const gh = 60;

  function valueToY(ms: number): number {
    const val = Math.min(ms, GRAPH_MAX_MS);
    return gy + gh - (val / GRAPH_MAX_MS) * gh;
  }

  test("0ms maps to bottom of graph", () => {
    expect(valueToY(0)).toBe(gy + gh); // 150
  });

  test("GRAPH_MAX_MS maps to top of graph", () => {
    expect(valueToY(GRAPH_MAX_MS)).toBe(gy); // 90
  });

  test("16.67ms maps to correct position", () => {
    const y = valueToY(16.67);
    const expected = gy + gh - (16.67 / GRAPH_MAX_MS) * gh;
    expect(y).toBeCloseTo(expected);
  });

  test("values above GRAPH_MAX_MS are clamped to top", () => {
    expect(valueToY(100)).toBe(gy);
    expect(valueToY(999)).toBe(gy);
  });

  test("target line at 16.67ms", () => {
    const targetY = gy + gh - (16.67 / GRAPH_MAX_MS) * gh;
    expect(targetY).toBeGreaterThan(gy);
    expect(targetY).toBeLessThan(gy + gh);
  });
});
