/**
 * Performance overlay — game-style HUD showing real-time rendering metrics.
 *
 * Displays:
 *   - FPS counter (1-second smoothed, with running estimate for first second)
 *   - Frame time graph (rolling sparkline, last 120 samples)
 *   - CPU time (JS-side terminal render cost, measured via xterm onRender)
 *   - GPU time (via EXT_disjoint_timer_query_webgl2, when available)
 *   - Memory usage (Chromium performance.memory)
 *   - Terminal count
 *
 * Toggle with F3. Zero overhead when hidden — the RAF loop only runs
 * while the overlay is visible.
 *
 * @module perf-overlay
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HISTORY_SIZE = 120;
const OVERLAY_WIDTH = 280;
const OVERLAY_HEIGHT = 180;
const GRAPH_HEIGHT = 60;
const GRAPH_Y = 90;
const GRAPH_MARGIN = 8;
const TARGET_FPS = 60;
/** Maximum milliseconds shown on the graph Y-axis. */
const GRAPH_MAX_MS = 50;
const BG_COLOR = "rgba(0, 0, 0, 0.75)";
const TEXT_COLOR = "#e0e0e0";
const ACCENT_GREEN = "#4caf50";
const ACCENT_YELLOW = "#ffeb3b";
const ACCENT_RED = "#f44336";
const GRAPH_LINE_CPU = "#64b5f6";
const GRAPH_LINE_GPU = "#ff8a65";
const GRAPH_LINE_FRAME = ACCENT_GREEN;
const FONT = '11px "JetBrains Mono", "Cascadia Code", Consolas, monospace';
const FONT_SMALL = '10px "JetBrains Mono", "Cascadia Code", Consolas, monospace';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {HTMLCanvasElement | null} */
let canvas = null;

/** @type {CanvasRenderingContext2D | null} */
let ctx = null;

/** @type {boolean} */
let visible = false;

/** @type {number} */
let rafId = 0;

// Frame timing — lastFrameTime = 0 is a sentinel meaning "skip first sample"
let lastFrameTime = 0;
let frameCount = 0;
let fpsAccum = 0;
let currentFps = 0;

// Rolling history (circular buffer)
const frameTimes = new Float32Array(HISTORY_SIZE);
const cpuTimes = new Float32Array(HISTORY_SIZE);
const gpuTimes = new Float32Array(HISTORY_SIZE);
let historyIndex = 0;

// CPU timing — set externally via markCpuStart / markCpuEnd.
// Measures the actual xterm render pass (via term.onRender), not just the
// term.write() enqueue call which returns near-instantly.
let cpuStart = 0;
let lastCpuTime = 0;

// GPU timing
/** @type {WebGL2RenderingContext | null} */
let gl = null;
/** @type {any} */
let timerExt = null;
/** @type {WebGLQuery | null} */
let pendingQuery = null;
let queryActive = false;
/** Reference count: how many terminals have called gpuTimerBegin without a
 *  matching gpuTimerEnd yet.  The actual GL query is only started on the
 *  0→1 transition and ended on the 1→0 transition, so with N terminals we
 *  measure aggregate GPU time for the whole frame. */
let timerRefCount = 0;
let lastGpuTime = 0;
let gpuTimingAvailable = false;
let glAttached = false;

// External stats
let terminalCount = 0;
let inProcessMode = false;

// Panel tracking
/** @type {ResizeObserver | null} */
let panelObserver = null;
/** @type {MutationObserver | null} */
let panelMutationObserver = null;
let rightPanelWidth = 0;

// Keyboard
/** @type {((e: KeyboardEvent) => void) | null} */
let keydownHandler = null;

// DPR tracking
let currentDpr = 0;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function createCanvas() {
  currentDpr = window.devicePixelRatio || 1;
  canvas = document.createElement("canvas");
  canvas.width = OVERLAY_WIDTH * currentDpr;
  canvas.height = OVERLAY_HEIGHT * currentDpr;
  // Start without transition to avoid animating the initial position.
  canvas.style.cssText = `
    position: fixed;
    top: 8px;
    right: ${8 + rightPanelWidth}px;
    width: ${OVERLAY_WIDTH}px;
    height: ${OVERLAY_HEIGHT}px;
    z-index: 99999;
    pointer-events: none;
    border-radius: 6px;
    image-rendering: auto;
  `;
  ctx = canvas.getContext("2d");
  ctx.scale(currentDpr, currentDpr);
  document.body.appendChild(canvas);

  // Enable the CSS transition after the first layout so the initial
  // position does not animate.
  requestAnimationFrame(() => {
    if (canvas) canvas.style.transition = "right 0.15s ease";
  });

  observeRightPanel();
}

/** Re-create the canvas backing store when DPR changes (e.g. window moved
 *  between monitors with different scaling). */
function handleDprChange() {
  const dpr = window.devicePixelRatio || 1;
  if (dpr === currentDpr || !canvas || !ctx) return;
  currentDpr = dpr;
  canvas.width = OVERLAY_WIDTH * dpr;
  canvas.height = OVERLAY_HEIGHT * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0); // reset before re-scaling
  ctx.scale(dpr, dpr);
}

function observeRightPanel() {
  const panel = document.getElementById("panel-terminal");
  if (!panel) return;

  function updateOffset() {
    const w = panel.offsetWidth || 0;
    if (w !== rightPanelWidth) {
      rightPanelWidth = w;
      if (canvas) canvas.style.right = `${8 + rightPanelWidth}px`;
    }
  }

  updateOffset();

  panelObserver = new ResizeObserver(updateOffset);
  panelObserver.observe(panel);

  // Also catch display:none toggles which don't fire ResizeObserver.
  panelMutationObserver = new MutationObserver(updateOffset);
  panelMutationObserver.observe(panel, { attributes: true, attributeFilter: ["style", "class"] });
}

function disconnectObservers() {
  if (panelObserver) { panelObserver.disconnect(); panelObserver = null; }
  if (panelMutationObserver) { panelMutationObserver.disconnect(); panelMutationObserver = null; }
}

// ---------------------------------------------------------------------------
// GPU Timer Queries
// ---------------------------------------------------------------------------

/**
 * Attach a WebGL2 context for GPU timer queries.
 * Only attaches once — subsequent calls are no-ops.
 * @param {WebGL2RenderingContext} glContext
 */
export function attachGL(glContext) {
  if (glAttached) return;
  gl = glContext;
  timerExt = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  gpuTimingAvailable = timerExt !== null;
  glAttached = true;
}

/** Reset all GPU timer state to a clean idle. */
function resetGpuTimer() {
  if (pendingQuery && gl) {
    try { gl.deleteQuery(pendingQuery); } catch { /* context lost */ }
  }
  pendingQuery = null;
  queryActive = false;
  timerRefCount = 0;
}

/**
 * Begin a GPU timer query. Call before rendering.
 *
 * Multiple terminals may call this per frame — we reference-count so the
 * actual GL query spans from the first begin to the last end, measuring
 * aggregate GPU time for the whole frame.
 */
export function gpuTimerBegin() {
  if (!gpuTimingAvailable || !gl || !timerExt) return;
  if (gl.isContextLost()) { resetGpuTimer(); return; }

  timerRefCount++;
  if (timerRefCount > 1) return; // query already running

  // Reclaim any stale query (e.g. from a previous frame that never ended
  // cleanly, or after context restore).
  if (pendingQuery) {
    if (queryActive) {
      try { gl.endQuery(timerExt.TIME_ELAPSED_EXT); } catch { /* ignore */ }
      queryActive = false;
    }
    try { gl.deleteQuery(pendingQuery); } catch { /* ignore */ }
    pendingQuery = null;
  }

  pendingQuery = gl.createQuery();
  gl.beginQuery(timerExt.TIME_ELAPSED_EXT, pendingQuery);
  queryActive = true;
}

/**
 * End the GPU timer query. Call after rendering.
 *
 * The actual GL endQuery only fires when the last terminal in this frame
 * calls gpuTimerEnd (refcount drops to 0).
 */
export function gpuTimerEnd() {
  if (!gpuTimingAvailable || !gl || !timerExt) return;
  if (gl.isContextLost()) { resetGpuTimer(); return; }

  timerRefCount = Math.max(0, timerRefCount - 1);
  if (timerRefCount > 0) return; // other terminals still rendering

  if (!pendingQuery || !queryActive) return;
  try {
    gl.endQuery(timerExt.TIME_ELAPSED_EXT);
  } catch {
    resetGpuTimer();
    return;
  }
  queryActive = false;
}

/**
 * Collect the GPU timer result (non-blocking).
 * Called every frame; returns early if the result is not yet available.
 */
function collectGpuTime() {
  if (!gl || !timerExt || !pendingQuery || queryActive) return;

  if (gl.isContextLost()) {
    resetGpuTimer();
    return;
  }

  // Check for disjoint — GPU timer results are unreliable after power
  // management events, context switches, etc.
  const disjoint = gl.getParameter(timerExt.GPU_DISJOINT_EXT);
  if (disjoint) {
    gl.deleteQuery(pendingQuery);
    pendingQuery = null;
    return;
  }

  const available = gl.getQueryParameter(pendingQuery, gl.QUERY_RESULT_AVAILABLE);
  if (!available) return; // not ready yet, try next frame

  const nsElapsed = gl.getQueryParameter(pendingQuery, gl.QUERY_RESULT);
  lastGpuTime = nsElapsed / 1_000_000; // ns -> ms
  gl.deleteQuery(pendingQuery);
  pendingQuery = null;
}

// ---------------------------------------------------------------------------
// CPU timing (called externally around render work)
// ---------------------------------------------------------------------------

export function markCpuStart() {
  cpuStart = performance.now();
}

export function markCpuEnd() {
  lastCpuTime = performance.now() - cpuStart;
}

// ---------------------------------------------------------------------------
// External stats
// ---------------------------------------------------------------------------

/**
 * Update the terminal count displayed in the overlay.
 * @param {number} count
 */
export function setTerminalCount(count) {
  terminalCount = count;
}

/**
 * Set whether in-process terminal mode is active.
 * When false (legacy webview mode), CPU/GPU timing is unavailable.
 * @param {boolean} enabled
 */
export function setInProcessMode(enabled) {
  inProcessMode = enabled;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function fpsColor(fps) {
  if (fps >= TARGET_FPS - 2) return ACCENT_GREEN;
  if (fps >= 30) return ACCENT_YELLOW;
  return ACCENT_RED;
}

function msColor(ms) {
  if (ms <= 16.7) return ACCENT_GREEN;
  if (ms <= 33.3) return ACCENT_YELLOW;
  return ACCENT_RED;
}

function drawOverlay(now) {
  // DPR may change between frames (window moved to another monitor).
  handleDprChange();

  // Frame timing
  const dt = now - lastFrameTime;
  lastFrameTime = now;
  frameCount++;
  fpsAccum += dt;

  if (fpsAccum >= 1000) {
    currentFps = Math.round((frameCount * 1000) / fpsAccum);
    frameCount = 0;
    fpsAccum = 0;
  } else if (currentFps === 0 && fpsAccum > 100) {
    // Running estimate for the first second so FPS isn't stuck at 0.
    currentFps = Math.round((frameCount * 1000) / fpsAccum);
  }

  // Collect GPU timer from previous frame (before recording history so the
  // GPU sample aligns as closely as possible with frame/CPU samples).
  collectGpuTime();

  // Record history
  frameTimes[historyIndex] = dt;
  cpuTimes[historyIndex] = lastCpuTime;
  gpuTimes[historyIndex] = lastGpuTime;
  historyIndex = (historyIndex + 1) % HISTORY_SIZE;

  // Memory
  const mem = /** @type {any} */ (performance).memory;
  const usedMB = mem ? (mem.usedJSHeapSize / (1024 * 1024)).toFixed(0) : "\u2014";
  const totalMB = mem ? (mem.totalJSHeapSize / (1024 * 1024)).toFixed(0) : "\u2014";

  // Draw
  const w = OVERLAY_WIDTH;
  const h = OVERLAY_HEIGHT;
  ctx.clearRect(0, 0, w, h);

  // Background
  ctx.fillStyle = BG_COLOR;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 6);
  ctx.fill();

  // -- Text stats --
  let y = 16;
  const col1 = 8;
  const col2 = 150;

  // FPS
  ctx.font = FONT;
  ctx.fillStyle = fpsColor(currentFps);
  ctx.fillText(`${currentFps} FPS`, col1, y);

  ctx.fillStyle = TEXT_COLOR;
  ctx.fillText(`${dt.toFixed(1)} ms/frame`, col2, y);
  y += 16;

  // CPU / GPU
  if (inProcessMode) {
    ctx.fillStyle = msColor(lastCpuTime);
    ctx.fillText(`CPU: ${lastCpuTime.toFixed(2)} ms`, col1, y);
  } else {
    ctx.fillStyle = "#666";
    ctx.fillText("CPU: n/a (webview)", col1, y);
  }

  if (gpuTimingAvailable && inProcessMode) {
    ctx.fillStyle = msColor(lastGpuTime);
    ctx.fillText(`GPU: ${lastGpuTime.toFixed(2)} ms`, col2, y);
  } else {
    ctx.fillStyle = "#666";
    ctx.fillText("GPU: n/a", col2, y);
  }
  y += 16;

  // Memory / Terminals
  ctx.fillStyle = TEXT_COLOR;
  ctx.fillText(`Mem: ${usedMB} / ${totalMB} MB`, col1, y);
  ctx.fillText(`Terminals: ${terminalCount}`, col2, y);
  y += 16;

  // Renderer label
  ctx.font = FONT_SMALL;
  ctx.fillStyle = "#888";
  ctx.fillText(inProcessMode ? "In-process (WebGL)" : "Legacy (webview)", col1, y);
  if (gpuTimingAvailable) {
    ctx.fillText("GPU timer: active", col2, y);
  }

  // -- Frame time graph --
  const gx = GRAPH_MARGIN;
  const gy = GRAPH_Y;
  const gw = w - GRAPH_MARGIN * 2;
  const gh = GRAPH_HEIGHT;

  // Graph background
  ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
  ctx.fillRect(gx, gy, gw, gh);

  // 16.67ms target line
  const targetY = gy + gh - (16.67 / GRAPH_MAX_MS) * gh;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(gx, targetY);
  ctx.lineTo(gx + gw, targetY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw graph lines
  drawGraphLine(gx, gy, gw, gh, frameTimes, GRAPH_LINE_FRAME);
  drawGraphLine(gx, gy, gw, gh, cpuTimes, GRAPH_LINE_CPU);
  if (gpuTimingAvailable) {
    drawGraphLine(gx, gy, gw, gh, gpuTimes, GRAPH_LINE_GPU);
  }

  // Graph legend
  const legendY = gy + gh + 12;
  ctx.font = FONT_SMALL;
  drawLegendDot(gx, legendY, GRAPH_LINE_FRAME, "frame");
  drawLegendDot(gx + 55, legendY, GRAPH_LINE_CPU, "cpu");
  if (gpuTimingAvailable) {
    drawLegendDot(gx + 100, legendY, GRAPH_LINE_GPU, "gpu");
  }

  // Target label
  ctx.fillStyle = "#666";
  ctx.fillText("16.67ms", gx + gw - 42, targetY - 3);
}

function drawGraphLine(gx, gy, gw, gh, data, color) {
  const step = gw / (HISTORY_SIZE - 1);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();

  for (let i = 0; i < HISTORY_SIZE; i++) {
    const idx = (historyIndex + i) % HISTORY_SIZE;
    const val = Math.min(data[idx], GRAPH_MAX_MS);
    const x = gx + i * step;
    const y = gy + gh - (val / GRAPH_MAX_MS) * gh;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  ctx.stroke();
  ctx.restore();
}

function drawLegendDot(x, y, color, label) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y - 4, 6, 6);
  ctx.fillStyle = TEXT_COLOR;
  ctx.fillText(label, x + 10, y + 1);
}

// ---------------------------------------------------------------------------
// RAF loop
// ---------------------------------------------------------------------------

function tick(now) {
  if (!visible) return;

  // Skip the first frame to avoid scheduler jitter in the initial dt.
  if (lastFrameTime === 0) {
    lastFrameTime = now;
    rafId = requestAnimationFrame(tick);
    return;
  }

  drawOverlay(now);
  rafId = requestAnimationFrame(tick);
}

function startLoop() {
  lastFrameTime = 0; // sentinel: skip first sample
  frameCount = 0;
  fpsAccum = 0;
  currentFps = 0;
  rafId = requestAnimationFrame(tick);
}

function stopLoop() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

// ---------------------------------------------------------------------------
// Toggle
// ---------------------------------------------------------------------------

export function toggle() {
  visible = !visible;
  if (visible) {
    if (!canvas) createCanvas();
    canvas.style.display = "block";
    startLoop();
  } else {
    if (canvas) canvas.style.display = "none";
    stopLoop();
  }
}

// ---------------------------------------------------------------------------
// Keyboard shortcut (F3)
// ---------------------------------------------------------------------------

export function initKeyboardShortcut() {
  // Guard against double-registration (e.g. hot reload in dev).
  if (keydownHandler) window.removeEventListener("keydown", keydownHandler);
  keydownHandler = (e) => {
    if (e.key === "F3" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      toggle();
    }
  };
  window.addEventListener("keydown", keydownHandler);
}
