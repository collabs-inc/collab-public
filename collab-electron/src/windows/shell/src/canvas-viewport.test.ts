/**
 * Tests for pure zoom/viewport logic that will live in canvas-viewport.js.
 * These functions are currently inlined in renderer.js.
 *
 * After modularization, update imports to use ./canvas-viewport.js.
 */
import { describe, test, expect } from "bun:test";
import { shouldZoom } from "./canvas-viewport.js";

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

// -- Extracted constants and logic (from renderer.js lines 53-230) --

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 1;
const ZOOM_RUBBER_BAND_K = 400;

interface ViewportState {
  panX: number;
  panY: number;
  zoom: number;
}

/**
 * Core zoom math extracted from applyZoom in renderer.js.
 * Applies a single zoom step to the viewport state, returning the new state.
 * Does not include rubber-band snap-back (that's animation logic).
 */
function computeZoomStep(
  state: ViewportState,
  deltaY: number,
  focalX: number,
  focalY: number,
): ViewportState {
  const prevScale = state.zoom;
  let factor = Math.exp((-deltaY * 0.6) / 100);

  if (state.zoom >= ZOOM_MAX && factor > 1) {
    const overshoot = state.zoom / ZOOM_MAX - 1;
    const damping = 1 / (1 + overshoot * ZOOM_RUBBER_BAND_K);
    factor = 1 + (factor - 1) * damping;
  } else if (state.zoom <= ZOOM_MIN && factor < 1) {
    const overshoot = ZOOM_MIN / state.zoom - 1;
    const damping = 1 / (1 + overshoot * ZOOM_RUBBER_BAND_K);
    factor = 1 - (1 - factor) * damping;
  }

  const newZoom = state.zoom * factor;
  const ratio = newZoom / prevScale - 1;
  const newPanX = state.panX - (focalX - state.panX) * ratio;
  const newPanY = state.panY - (focalY - state.panY) * ratio;

  return { panX: newPanX, panY: newPanY, zoom: newZoom };
}

// -- Zoom math --

describe("computeZoomStep", () => {
  test("negative deltaY zooms in (increases zoom)", () => {
    const state: ViewportState = { panX: 0, panY: 0, zoom: 0.5 };
    const result = computeZoomStep(state, -100, 500, 400);
    expect(result.zoom).toBeGreaterThan(0.5);
  });

  test("positive deltaY zooms out (decreases zoom)", () => {
    const state: ViewportState = { panX: 0, panY: 0, zoom: 0.5 };
    const result = computeZoomStep(state, 100, 500, 400);
    expect(result.zoom).toBeLessThan(0.5);
  });

  test("zero deltaY does not change zoom", () => {
    const state: ViewportState = { panX: 0, panY: 0, zoom: 0.5 };
    const result = computeZoomStep(state, 0, 500, 400);
    expect(result.zoom).toBeCloseTo(0.5, 10);
  });

  test("zoom is focal-point centered (pan adjusts)", () => {
    const state: ViewportState = { panX: 100, panY: 100, zoom: 0.5 };
    const result = computeZoomStep(state, -50, 500, 400);
    // After zooming in, the focal point should remain stationary
    // in screen coordinates. The pan shifts to compensate.
    // Verify pan changed (it should shift toward the focal point)
    expect(result.panX).not.toBe(100);
    expect(result.panY).not.toBe(100);
  });

  test("zooming at viewport origin (0,0) does not shift pan", () => {
    const state: ViewportState = { panX: 0, panY: 0, zoom: 0.5 };
    const result = computeZoomStep(state, -50, 0, 0);
    // With focal at (0,0) which equals panX/panY, ratio * 0 = 0
    expect(result.panX).toBeCloseTo(0, 10);
    expect(result.panY).toBeCloseTo(0, 10);
  });

  test("rubber-band damping limits zoom beyond ZOOM_MAX", () => {
    // Start slightly past max so damping is active (overshoot > 0)
    const state: ViewportState = { panX: 0, panY: 0, zoom: 1.05 };
    const result = computeZoomStep(state, -100, 500, 400);
    // Zooms past max but damping reduces the step significantly
    expect(result.zoom).toBeGreaterThan(1.05);
    // Damping means it grows much less than undamped would
    const undamped = computeZoomStep(
      { panX: 0, panY: 0, zoom: 0.5 }, -100, 500, 400,
    );
    const undampedRatio = undamped.zoom / 0.5;
    const dampedRatio = result.zoom / 1.05;
    expect(dampedRatio).toBeLessThan(undampedRatio);
  });

  test("rubber-band damping limits zoom below ZOOM_MIN", () => {
    // Start slightly below min so damping is active
    const state: ViewportState = { panX: 0, panY: 0, zoom: 0.30 };
    const result = computeZoomStep(state, 100, 500, 400);
    expect(result.zoom).toBeLessThan(0.30);
    // Damping means it shrinks less than undamped would
    const undamped = computeZoomStep(
      { panX: 0, panY: 0, zoom: 0.5 }, 100, 500, 400,
    );
    const undampedRatio = undamped.zoom / 0.5;
    const dampedRatio = result.zoom / 0.30;
    expect(dampedRatio).toBeGreaterThan(undampedRatio);
  });

  test("multiple small steps produce consistent zoom direction", () => {
    let state: ViewportState = { panX: 100, panY: 100, zoom: 0.5 };
    for (let i = 0; i < 10; i++) {
      const prev = state.zoom;
      state = computeZoomStep(state, -10, 500, 400);
      expect(state.zoom).toBeGreaterThan(prev);
    }
  });

  test("zoom in then zoom out returns approximately to original", () => {
    const original: ViewportState = { panX: 200, panY: 150, zoom: 0.7 };
    // Zoom in
    let state = computeZoomStep(original, -50, 500, 400);
    // Zoom out by same delta
    state = computeZoomStep(state, 50, 500, 400);
    // Should be close to original (not exact due to floating point)
    expect(state.zoom).toBeCloseTo(original.zoom, 2);
    expect(state.panX).toBeCloseTo(original.panX, 0);
    expect(state.panY).toBeCloseTo(original.panY, 0);
  });
});

// -- Viewport state constraints --

describe("viewport zoom constants", () => {
  test("ZOOM_MIN is less than ZOOM_MAX", () => {
    expect(ZOOM_MIN).toBeLessThan(ZOOM_MAX);
  });

  test("ZOOM_MIN is positive", () => {
    expect(ZOOM_MIN).toBeGreaterThan(0);
  });

  test("ZOOM_MAX is 1 (100%)", () => {
    expect(ZOOM_MAX).toBe(1);
  });
});
