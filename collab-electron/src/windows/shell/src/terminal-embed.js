import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { getTheme } from "@collab/components/Terminal/theme";
import "@xterm/xterm/css/xterm.css";
import { setTerminalCount, setInProcessMode, attachGL, markCpuStart, markCpuEnd, gpuTimerBegin, gpuTimerEnd } from "./perf-overlay.js";

// ---------------------------------------------------------------------------
// GPU renderer flag
// ---------------------------------------------------------------------------

let useGpuRenderer = false;

/**
 * Probe for WebGL2 support and enable the GPU renderer if available.
 * Call once on startup alongside initPtyDataDispatch().
 */
export async function initGpuRenderer() {
	try {
		const enabled = await window.shellApi.getGpuRenderer();
		if (!enabled) {
			useGpuRenderer = false;
			console.log("[terminal-embed] GPU renderer disabled by config");
			return;
		}
		// xterm.js WebglAddon handles the WebGL context internally —
		// just check if WebGL is available at all.
		const testCanvas = new OffscreenCanvas(1, 1);
		const gl = testCanvas.getContext("webgl2") || testCanvas.getContext("webgl");
		if (gl) {
			useGpuRenderer = true;
			const loseCtx = gl.getExtension("WEBGL_lose_context");
			if (loseCtx) loseCtx.loseContext();
			console.log("[terminal-embed] GPU renderer enabled");
		}
	} catch {
		useGpuRenderer = false;
		console.log("[terminal-embed] WebGL not available, using DOM fallback");
	}
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATA_BUFFER_FLUSH_MS = 5;
const IS_MAC = window.shellApi.getPlatform() === "darwin";
const textEncoder = new TextEncoder();

// Scrollback: start small to avoid a CPU spike on terminal creation, then
// grow to the full limit once the terminal is idle and interactive.
const INITIAL_SCROLLBACK = 1000;
const FULL_SCROLLBACK = 200000;
const SCROLLBACK_GROW_DELAY_MS = 2000;

/** Schedule work on the next animation frame (returns a promise). */
const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

// ---------------------------------------------------------------------------
// Terminal registry
// ---------------------------------------------------------------------------

/** @type {Map<string, TerminalHandle>} */
const registry = new Map();

// ---------------------------------------------------------------------------
// TerminalHandle
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} TerminalHandle
 * @property {string} sessionId
 * @property {(data: string|Uint8Array) => void} write
 * @property {() => void} focus
 * @property {() => void} blur
 * @property {() => void} dispose
 * @property {Terminal} term
 */

// ---------------------------------------------------------------------------
// createTerminal
// ---------------------------------------------------------------------------

/**
 * Create an xterm.js terminal instance inside the given container element.
 * Returns a handle immediately — all heavy initialisation (DOM mount, addon
 * loading, WebGL context creation) is spread across animation frames so the
 * main thread is never blocked for more than a single lightweight phase.
 *
 * @param {HTMLElement} container
 * @param {string} sessionId
 * @param {{ scrollbackData?: string|null, mode?: "tmux"|"sidecar"|"direct", restored?: boolean }} [options]
 * @returns {Promise<TerminalHandle>}
 */
export async function createTerminal(container, sessionId, options = {}) {
	const { scrollbackData = null, restored = false } = options;

	const t0 = performance.now();
	const lap = (label) => {
		const ms = (performance.now() - t0).toFixed(1);
		console.log(`[terminal-embed] createTerminal +${ms}ms  ${label}`);
	};

	// -- Mutable state shared between the handle and the init pipeline ---------

	/** @type {Terminal|null} */
	let term = null;
	/** @type {FitAddon|null} */
	let fit = null;
	let webglAddon = null;
	let disposed = false;
	let ready = false;
	let pendingFocus = false;
	let gpuTimerOpen = false;

	// -- Data buffering (works before and after xterm is ready) -----------------

	/** @type {Uint8Array[]} */
	let dataBuffer = [];
	/** @type {number|undefined} */
	let flushTimer;
	let firstData = true;

	const flushData = () => {
		if (dataBuffer.length === 0) {
			flushTimer = undefined;
			return;
		}
		if (!term || !ready) return; // will be flushed when ready
		const chunks = dataBuffer;
		dataBuffer = [];
		flushTimer = undefined;

		if (firstData) {
			firstData = false;
			term.write("\x1b[2J\x1b[H");
		}
		markCpuStart();
		gpuTimerBegin();
		gpuTimerOpen = true;
		for (const chunk of chunks) {
			term.write(chunk);
		}
	};

	const writeBuffered = (data) => {
		const chunk = typeof data === "string" ? textEncoder.encode(data) : data;
		dataBuffer.push(chunk);
		if (ready && flushTimer === undefined) {
			flushTimer = window.setTimeout(flushData, DATA_BUFFER_FLUSH_MS);
		}
	};

	// -- Cleanup bookkeeping (accumulates as phases complete) -------------------

	const cleanups = [];

	// -- Resize state (shared with Phase 2) ------------------------------------

	const FIT_DEBOUNCE_MS = 100;
	let fitTimer = 0;
	let resizeObserver = null;

	// -- Build handle (returned immediately) ------------------------------------

	/** @type {TerminalHandle} */
	const handle = {
		sessionId,
		write: writeBuffered,
		focus() {
			if (term && ready) term.focus();
			else pendingFocus = true;
		},
		blur() {
			if (term) term.blur();
		},
		get term() { return term; },
		dispose() {
			disposed = true;
			if (flushTimer !== undefined) {
				clearTimeout(flushTimer);
				// Flush remaining data synchronously before teardown
				if (term && ready && dataBuffer.length > 0) {
					const chunks = dataBuffer;
					dataBuffer = [];
					for (const chunk of chunks) term.write(chunk);
				}
			}
			if (gpuTimerOpen) { gpuTimerEnd(); gpuTimerOpen = false; }
			clearTimeout(fitTimer);
			for (const fn of cleanups) {
				try { fn(); } catch { /* best-effort */ }
			}
			if (webglAddon) { webglAddon.dispose(); webglAddon = null; }
			if (term) { term.dispose(); term = null; }
			registry.delete(sessionId);
			earlyDataBuffers.delete(sessionId);
			setTerminalCount(registry.size);
		},
	};

	// Register immediately so PTY data arriving during init is buffered
	// on the handle rather than in the early-data fallback map.
	registry.set(sessionId, handle);
	setTerminalCount(registry.size);

	// Drain any data that arrived before we registered
	const early = earlyDataBuffers.get(sessionId);
	if (early) {
		earlyDataBuffers.delete(sessionId);
		for (const chunk of early.chunks) handle.write(chunk);
	}

	// =========================================================================
	// Phase 1 (next frame): xterm instance + DOM mount
	// =========================================================================

	await nextFrame();
	if (disposed) return handle;
	lap("phase 1 start: new Terminal + open");

	term = new Terminal({
		theme: getTheme(),
		fontFamily: 'Menlo, Monaco, "Cascadia Mono", Consolas, "Courier New", monospace',
		fontSize: 12,
		fontWeight: "300",
		fontWeightBold: "500",
		cursorBlink: true,
		scrollback: INITIAL_SCROLLBACK,
		allowProposedApi: true,
	});

	fit = new FitAddon();
	term.loadAddon(fit);
	term.open(container);

	if (!restored) {
		term.write("\x1b[38;2;100;100;100mStarting...\x1b[0m");
	}
	if (restored && scrollbackData) {
		term.write(scrollbackData);
	}

	// =========================================================================
	// Phase 2 (next frame): addons, input wiring, resize observer
	// =========================================================================

	lap("phase 1 done");
	await nextFrame();
	if (disposed) return handle;
	lap("phase 2 start: addons + input wiring");

	// Unicode 11 support
	const unicode11 = new Unicode11Addon();
	term.loadAddon(unicode11);
	term.unicode.activeVersion = "11";

	// Perf overlay hooks
	term.onRender(() => { markCpuEnd(); if (gpuTimerOpen) { gpuTimerEnd(); gpuTimerOpen = false; } });

	// Scroll isolation
	const handleWheel = (e) => { e.stopPropagation(); };
	container.addEventListener("wheel", handleWheel, { passive: true });
	cleanups.push(() => container.removeEventListener("wheel", handleWheel));

	// Input handling
	const copySelectionToClipboard = () => {
		const selection = term.getSelection();
		if (!selection) return false;
		void navigator.clipboard.writeText(selection).catch(() => {});
		return true;
	};
	let suppressPasteEvent = false;
	const pasteClipboardText = async () => {
		try {
			const text = await navigator.clipboard.readText();
			if (text) window.shellApi.ptyWrite(sessionId, text);
		} catch { /* noop */ }
	};
	const pasteFromShortcut = () => {
		suppressPasteEvent = true;
		void pasteClipboardText();
	};

	term.attachCustomKeyEventHandler((e) => {
		if (e.key === "Enter" && e.shiftKey) {
			if (e.type === "keydown") {
				window.shellApi.ptySendRawKeys(sessionId, "\x1b[13;2u");
			}
			return false;
		}
		const primaryModifier = IS_MAC ? e.metaKey : e.ctrlKey;
		if (e.type === "keydown" && primaryModifier) {
			const key = e.key.toLowerCase();
			if (key === "c" && copySelectionToClipboard()) return false;
			if (key === "v") { pasteFromShortcut(); return false; }
			if (!IS_MAC && e.shiftKey) {
				if (key === "c" && copySelectionToClipboard()) return false;
				if (key === "v") { pasteFromShortcut(); return false; }
			}
		}
		if (e.type === "keydown" && e.shiftKey && e.key === "Insert") {
			pasteFromShortcut();
			return false;
		}
		if (e.type === "keydown" && e.shiftKey) {
			if (e.key === "PageUp") { term.scrollPages(-1); return false; }
			if (e.key === "PageDown") { term.scrollPages(1); return false; }
		}
		if (e.type === "keydown" && e.metaKey) {
			if (e.key === "t" || (e.key >= "1" && e.key <= "9")) return false;
		}
		return true;
	});

	term.onData((data) => { window.shellApi.ptyWrite(sessionId, data); });

	// Clipboard events
	const handleCopy = (event) => {
		const selection = term.getSelection();
		if (!selection) return;
		event.clipboardData?.setData("text/plain", selection);
		event.preventDefault();
		event.stopImmediatePropagation();
	};
	const handlePaste = (event) => {
		if (suppressPasteEvent) {
			suppressPasteEvent = false;
			event.preventDefault();
			event.stopImmediatePropagation();
			return;
		}
		const text = event.clipboardData?.getData("text/plain");
		if (!text) return;
		window.shellApi.ptyWrite(sessionId, text);
		event.preventDefault();
		event.stopImmediatePropagation();
	};
	container.addEventListener("copy", handleCopy, true);
	container.addEventListener("paste", handlePaste, true);
	cleanups.push(() => {
		container.removeEventListener("copy", handleCopy, true);
		container.removeEventListener("paste", handlePaste, true);
	});

	// Resize observer + fit
	term.onResize(({ cols, rows }) => {
		window.shellApi.ptyResize(sessionId, cols, rows);
	});
	resizeObserver = new ResizeObserver((entries) => {
		const { width, height } = entries[0].contentRect;
		if (width > 0 && height > 0) {
			clearTimeout(fitTimer);
			fitTimer = window.setTimeout(() => fit.fit(), FIT_DEBOUNCE_MS);
		}
	});
	resizeObserver.observe(container);
	cleanups.push(() => resizeObserver.disconnect());

	// Theme
	const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
	const onThemeChange = () => { term.options.theme = getTheme(); };
	mediaQuery.addEventListener("change", onThemeChange);
	cleanups.push(() => mediaQuery.removeEventListener("change", onThemeChange));

	// -- Terminal is now interactive -------------------------------------------
	ready = true;

	// Flush data that arrived during init and run deferred fit
	if (dataBuffer.length > 0) {
		flushTimer = window.setTimeout(flushData, DATA_BUFFER_FLUSH_MS);
	}
	requestAnimationFrame(() => {
		if (!disposed && fit) fit.fit();
	});

	if (pendingFocus && term) {
		term.focus();
		pendingFocus = false;
	}

	// =========================================================================
	// Phase 3 (next frame): WebGL addon — heaviest GPU init, fully deferred
	// =========================================================================

	lap("phase 2 done (ready=true)");
	await nextFrame();
	if (disposed) return handle;
	lap("phase 3 start: WebGL addon");

	if (useGpuRenderer) {
		try {
			const { acquireSharedGL, releaseSharedGL } = await import("./shared-gl-context.js");
			const { XtermAdapter } = await import("./xterm-adapter.js");
			const { TerminalDrawState } = await import("./gpu-terminal-renderer.js");

			const dpr = window.devicePixelRatio || 1;
			if (dpr <= 1) {
				term.options.devicePixelRatio = 2;
			}

			// Extract xterm.js's actual cell metrics so the GPU atlas matches exactly.
			// This prevents sub-pixel gaps in box-drawing chars and misaligned text.
			const xtermDims = term._core?._renderService?.dimensions;
			const cellOverrides = {};
			if (xtermDims?.css?.cell) {
				const eDpr = dpr > 1 ? dpr : 2;
				cellOverrides.cellWidth = Math.round(xtermDims.css.cell.width * eDpr);
				cellOverrides.cellHeight = Math.round(xtermDims.css.cell.height * eDpr);
			}

			const sharedGL = acquireSharedGL({
				fontSize: term.options.fontSize,
				fontFamily: term.options.fontFamily,
				devicePixelRatio: dpr > 1 ? dpr : 2,
				cellOverrides,
			});
			const gl = sharedGL.getGL();
			const resources = sharedGL.getSharedResources();
			const atlas = sharedGL.getFontAtlas();

			// FBO sized to container; shader uses actual cell dimensions
			// to prevent selection coordinate drift.
			const effectiveDpr = dpr > 1 ? dpr : 2;
			// cellW/cellH available via atlas.cellWidth/cellHeight
			// FBO sized to container. Selection coordinates handled by our
			// mouse overlay (bypasses xterm's broken CSS transform mapping).
			const getXtermCellDims = () => {
				const d = term._core?._renderService?.dimensions?.css?.cell;
				return {
					w: d?.width ?? (atlas.cellWidth / effectiveDpr),
					h: d?.height ?? (atlas.cellHeight / effectiveDpr),
				};
			};
			let { w: cssCellW, h: cssCellH } = getXtermCellDims();
			let pixelW = Math.round(container.offsetWidth * effectiveDpr);
			let pixelH = Math.round(container.offsetHeight * effectiveDpr);
			sharedGL.allocateTerminal(sessionId, pixelW, pixelH);

			// Create adapter and draw state
			const adapter = new XtermAdapter(term, atlas);
			const drawState = new TerminalDrawState(gl, term.cols, term.rows);

			// Hide xterm's DOM text rendering but keep input/selection functional.
			// The GPU canvas sits on top with pointer-events:none so clicks
			// pass through to xterm for input handling.
			if (!document.getElementById('gpu-renderer-xterm-overrides')) {
				const style = document.createElement('style');
				style.id = 'gpu-renderer-xterm-overrides';
				style.textContent = `
					.gpu-rendered .xterm-rows { visibility: hidden !important; }
				`;
				document.head.appendChild(style);
			}
			container.classList.add('gpu-rendered');

			// Ensure container is a positioning context for the canvas
			const containerPos = getComputedStyle(container).position;
			if (containerPos === 'static') container.style.position = 'relative';

			// GPU canvas and mouse overlay sit ON TOP of xterm.
			const visibleCanvas = document.createElement('canvas');
			visibleCanvas.width = pixelW;
			visibleCanvas.height = pixelH;
			visibleCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;';
			container.appendChild(visibleCanvas);

			// Transparent mouse overlay captures mouse events for selection,
			// bypassing xterm's broken coordinate mapping in CSS-transformed containers.
			const mouseOverlay = document.createElement('div');
			mouseOverlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:11;cursor:text;';
			container.appendChild(mouseOverlay);

			// Our own selection state (cell coords, viewport-relative)
			let selStartCol = -1, selStartRow = -1;
			let selEndCol = -1, selEndRow = -1;
			let gpuSelecting = false;

			const cellFromMouseEvent = (e) => {
				// offsetX/Y is in element-local coords (unaffected by CSS transforms)
				const col = Math.floor(e.offsetX / cssCellW);
				const row = Math.floor(e.offsetY / cssCellH);
				return [
					Math.max(0, Math.min(col, term.cols - 1)),
					Math.max(0, Math.min(row, term.rows - 1)),
				];
			};

			mouseOverlay.addEventListener('mousedown', (e) => {
				if (e.button !== 0) return;
				term.focus();
				const [col, row] = cellFromMouseEvent(e);
				selStartCol = col; selStartRow = row;
				selEndCol = col; selEndRow = row;
				gpuSelecting = true;
				term.clearSelection();
				scheduleFrame();
			});

			mouseOverlay.addEventListener('mousemove', (e) => {
				if (!gpuSelecting) return;
				const [col, row] = cellFromMouseEvent(e);
				selEndCol = col; selEndRow = row;
				scheduleFrame();
			});

			const onSelMouseUp = () => {
				if (!gpuSelecting) return;
				gpuSelecting = false;
				// Set xterm's selection for clipboard support
				let sr = selStartRow, sc = selStartCol, er = selEndRow, ec = selEndCol;
				if (sr > er || (sr === er && sc > ec)) {
					[sr, sc, er, ec] = [er, ec, sr, sc];
				}
				if (sr !== er || sc !== ec) {
					const len = (er - sr) * term.cols + (ec - sc) + 1;
					term.select(sc, sr, len);
				}
				scheduleFrame();
			};
			document.addEventListener('mouseup', onSelMouseUp);

			// Double-click: select word
			mouseOverlay.addEventListener('dblclick', (e) => {
				term.focus();
				// Let xterm handle word selection
				const [col, row] = cellFromMouseEvent(e);
				// Find word boundaries from buffer
				const line = term.buffer.active.getLine(term.buffer.active.viewportY + row);
				if (!line) return;
				let start = col, end = col;
				const isWordChar = (c) => /\w/.test(c);
				const cell = line.getCell(col);
				if (cell && isWordChar(cell.getChars())) {
					while (start > 0 && line.getCell(start - 1) && isWordChar(line.getCell(start - 1).getChars())) start--;
					while (end < term.cols - 1 && line.getCell(end + 1) && isWordChar(line.getCell(end + 1).getChars())) end++;
				}
				selStartCol = start; selStartRow = row;
				selEndCol = end; selEndRow = row;
				const len = end - start + 1;
				term.select(start, row, len);
				scheduleFrame();
			});

			// Stride constants
			const BG_ADAPTER_FLOATS = 7; // col, row, width, r, g, b, a
			const BG_GPU_FLOATS = 6;     // col, row, width, r, g, b (no alpha)
			const FG_FLOATS = 9;         // col, row, u, v, uw, uh, r, g, b
			const SEL_FLOATS = 7;        // col, row, width, r, g, b, a
			let bgPackBuf = new Float32Array(term.cols * term.rows * BG_ADAPTER_FLOATS);

			// Parse theme hex colors to RGB floats
			const parseHex = (hex, fallback) => {
				if (!hex || hex[0] !== '#') return fallback;
				const r = parseInt(hex.slice(1, 3), 16) / 255;
				const g = parseInt(hex.slice(3, 5), 16) / 255;
				const b = parseInt(hex.slice(5, 7), 16) / 255;
				return { r, g, b };
			};
			const resolveTheme = () => {
				const t = term.options.theme || {};
				return {
					bg: parseHex(t.background, { r: 0.031, g: 0.031, b: 0.031 }),
					fg: parseHex(t.foreground, { r: 0.831, g: 0.831, b: 0.831 }),
					cursor: parseHex(t.cursor, { r: 0.831, g: 0.831, b: 0.831 }),
					selBg: parseHex(t.selectionBackground, { r: 0.149, g: 0.310, b: 0.471 }),
				};
			};
			let themeColors = resolveTheme();

			// Wire render loop — only render when xterm signals dirty rows
			let frameRequested = false;
			let hasDirty = true; // first frame always renders
			const renderFrame = () => {
				frameRequested = false;
				if (disposed || !term || !hasDirty) return;
				hasDirty = false;

				const cols = term.cols;
				const rows = term.rows;
				const { bg, fg, cursor: cursorColor, selBg } = themeColors;
				const defaultBg = [bg.r, bg.g, bg.b];
				const defaultFg = [fg.r, fg.g, fg.b];

				// Re-upload atlas if new glyphs were rasterized on demand
				// (Unicode block elements, emoji, special symbols)
				if (atlas._dirty) {
					resources.uploadAtlas(atlas);
					atlas._dirty = false;
				}

				// Guard: ensure pack buffer is large enough for current grid
				const neededBg = cols * rows * BG_ADAPTER_FLOATS;
				if (bgPackBuf.length < neededBg) {
					bgPackBuf = new Float32Array(neededBg);
				}

				// ---- Pack BG + FG rows ----
				let bgAdapterOffset = 0, fgOffset = 0;
				drawState.bgCount = 0;
				drawState.fgCount = 0;
				for (let r = 0; r < rows; r++) {
					const result = adapter.packRow(r, bgPackBuf, bgAdapterOffset, drawState.fgData, fgOffset, defaultBg, defaultFg);
					bgAdapterOffset += result.bgCount * BG_ADAPTER_FLOATS;
					fgOffset += result.fgCount * FG_FLOATS;
					drawState.bgCount += result.bgCount;
					drawState.fgCount += result.fgCount;
				}
				// Convert 7-float BG to 6-float (strip alpha)
				const totalBg = drawState.bgCount;
				for (let i = 0; i < totalBg; i++) {
					const src = i * BG_ADAPTER_FLOATS;
					const dst = i * BG_GPU_FLOATS;
					drawState.bgData[dst]     = bgPackBuf[src];
					drawState.bgData[dst + 1] = bgPackBuf[src + 1];
					drawState.bgData[dst + 2] = bgPackBuf[src + 2];
					drawState.bgData[dst + 3] = bgPackBuf[src + 3];
					drawState.bgData[dst + 4] = bgPackBuf[src + 4];
					drawState.bgData[dst + 5] = bgPackBuf[src + 5];
				}

				// ---- Pack selection (uses our own mouse-tracked state) ----
				drawState.selCount = 0;
				if (selStartRow >= 0 && (selStartRow !== selEndRow || selStartCol !== selEndCol)) {
					let sr = selStartRow, sc = selStartCol, er = selEndRow, ec = selEndCol;
					if (sr > er || (sr === er && sc > ec)) {
						[sr, sc, er, ec] = [er, ec, sr, sc];
					}
					const selData = drawState.selData;
					let sIdx = 0;
					for (let r = Math.max(0, sr); r <= er && r < rows; r++) {
						const lStart = r === sr ? sc : 0;
						const lEnd = r === er ? ec : cols - 1;
						const w = lEnd - lStart + 1;
						if (w <= 0) continue;
						selData[sIdx]     = lStart;
						selData[sIdx + 1] = r;
						selData[sIdx + 2] = w;
						selData[sIdx + 3] = selBg.r;
						selData[sIdx + 4] = selBg.g;
						selData[sIdx + 5] = selBg.b;
						selData[sIdx + 6] = 0.5;
						sIdx += SEL_FLOATS;
					}
					drawState.selCount = sIdx / SEL_FLOATS;
				}

				// ---- Pack cursor ----
				let drawCursor = false;
				const buf = term.buffer.active;
				// Check DECTCEM cursor visibility (try multiple private API paths)
				const core = term._core;
				const cursorHidden = core?.coreService?.isCursorHidden ?? false;
				if (buf && !cursorHidden && cursorBlinkVisible) {
					// cursorX/cursorY are 0-based viewport-relative
					const cx = buf.cursorX;
					const cy = buf.cursorY;
					const d = drawState.cursorData;
					d[0] = cx;
					d[1] = cy;
					d[2] = 1.0;  // width (full cell)
					d[3] = 1.0;  // height (full cell)
					d[4] = cursorColor.r;
					d[5] = cursorColor.g;
					d[6] = cursorColor.b;
					d[7] = 0.7;  // semi-transparent block
					drawCursor = true;
				}

				// ---- Upload all buffers to GPU ----
				gl.bindBuffer(gl.ARRAY_BUFFER, drawState.bgInstanceBuf);
				gl.bufferData(gl.ARRAY_BUFFER, drawState.bgData.subarray(0, totalBg * BG_GPU_FLOATS), gl.DYNAMIC_DRAW);
				gl.bindBuffer(gl.ARRAY_BUFFER, drawState.fgInstanceBuf);
				gl.bufferData(gl.ARRAY_BUFFER, drawState.fgData.subarray(0, drawState.fgCount * FG_FLOATS), gl.DYNAMIC_DRAW);
				if (drawState.selCount > 0) {
					gl.bindBuffer(gl.ARRAY_BUFFER, drawState.selInstanceBuf);
					gl.bufferData(gl.ARRAY_BUFFER, drawState.selData.subarray(0, drawState.selCount * SEL_FLOATS), gl.DYNAMIC_DRAW);
				}
				if (drawCursor) {
					gl.bindBuffer(gl.ARRAY_BUFFER, drawState.cursorInstanceBuf);
					gl.bufferData(gl.ARRAY_BUFFER, drawState.cursorData, gl.DYNAMIC_DRAW);
				}

				// ---- Draw to FBO ----
				sharedGL.bindForRendering(sessionId);
				resources.drawTerminal(drawState, { bgColor: bg, cols, rows, drawCursor });
				sharedGL.unbindFramebuffer();

				// Present the FBO content to the visible canvas
				sharedGL.presentTerminal(sessionId, visibleCanvas);

				adapter.clearDirty();
			};

			const scheduleFrame = () => {
				hasDirty = true;
				if (!frameRequested) {
					frameRequested = true;
					requestAnimationFrame(renderFrame);
				}
			};

			// Cursor blink: toggle visibility every 530ms and re-render
			let cursorBlinkVisible = true;
			const blinkInterval = setInterval(() => {
				if (disposed) return;
				cursorBlinkVisible = !cursorBlinkVisible;
				scheduleFrame();
			}, 530);

			term.onRender(scheduleFrame);
			// Scrollback: handle mouse wheel and Shift+PageUp/PageDown directly
			// via xterm.js scroll API (bypasses shell/tmux)
			// Ctrl+Wheel: zoom font size. Plain wheel: scroll (if buffer has scrollback).
			const MIN_FONT_SIZE = 6;
			const MAX_FONT_SIZE = 32;
			const onWheel = (e) => {
				if (disposed || !term) return;

				if (e.ctrlKey) {
					// Ctrl+Wheel: change font size
					e.preventDefault();
					e.stopPropagation();
					const delta = e.deltaY < 0 ? 1 : -1;
					const newSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, term.options.fontSize + delta));
					if (newSize === term.options.fontSize) return;
					term.options.fontSize = newSize;
					// Rebuild atlas at new size
					sharedGL.rebuildFontAtlas(newSize, term.options.fontFamily, effectiveDpr);
					adapter._atlas = sharedGL.getFontAtlas();
					// Refit terminal (recalculates cols/rows for the new cell size)
					if (fit) fit.fit();
					// Update cell dims for selection mapping
					({ w: cssCellW, h: cssCellH } = getXtermCellDims());
					return;
				}

				const buf = term.buffer.active;
				if (buf.baseY > 0) {
					e.preventDefault();
					e.stopPropagation();
					const lines = Math.round(e.deltaY / 20) || (e.deltaY > 0 ? 3 : -3);
					term.scrollLines(lines);
					scheduleFrame();
				}
			};
			// Listen on mouseOverlay (top-most) to intercept before canvas zoom
			mouseOverlay.addEventListener('wheel', onWheel, { passive: false });

			// Initial render
			hasDirty = true;
			scheduleFrame();

			// Expose GL for perf overlay (replaces the old webglAddon._renderer._gl hack)
			requestAnimationFrame(() => {
				try { attachGL(gl); } catch { /* non-fatal */ }
			});

			console.log("[terminal-embed] Shared GPU renderer loaded");

			// Handle resize: update FBO, draw state, adapter, visible canvas, and pack buffer
			const gpuResizeHandler = () => {
				if (disposed) return;
				pixelW = Math.round(container.offsetWidth * effectiveDpr);
				pixelH = Math.round(container.offsetHeight * effectiveDpr);
				sharedGL.resizeTerminal(sessionId, pixelW, pixelH);
				drawState.resize(term.cols, term.rows);
				adapter.resize(term.rows);
				bgPackBuf = new Float32Array(term.cols * term.rows * BG_ADAPTER_FLOATS);
				visibleCanvas.width = pixelW;
				visibleCanvas.height = pixelH;
				visibleCanvas._sharedGLBitmapCtx = null;
				({ w: cssCellW, h: cssCellH } = getXtermCellDims());
				scheduleFrame();
			};
			term.onResize(gpuResizeHandler);

			// Cleanup
			cleanups.push(() => {
				clearInterval(blinkInterval);
				mouseOverlay.removeEventListener('wheel', onWheel);
				document.removeEventListener('mouseup', onSelMouseUp);
				mouseOverlay.remove();
				drawState.dispose();
				adapter.dispose();
				sharedGL.releaseTerminal(sessionId);
				releaseSharedGL();
				visibleCanvas.remove();
			});
		} catch (err) {
			console.warn("[terminal-embed] Shared GPU renderer failed, using DOM fallback:", err);
		}
	}

	// =========================================================================
	// Phase 4 (idle): grow scrollback to full capacity
	// =========================================================================

	lap("phase 3 done");
	setTimeout(() => {
		if (!disposed && term) {
			try { term.options.scrollback = FULL_SCROLLBACK; } catch { /* disposed */ }
		}
	}, SCROLLBACK_GROW_DELAY_MS);

	return handle;
}

// ---------------------------------------------------------------------------
// getTerminal
// ---------------------------------------------------------------------------

export function getTerminal(sessionId) {
	return registry.get(sessionId);
}

// ---------------------------------------------------------------------------
// disposeTerminal
// ---------------------------------------------------------------------------

export function disposeTerminal(sessionId) {
	const handle = registry.get(sessionId);
	if (handle) {
		handle.dispose();
	}
}

// ---------------------------------------------------------------------------
// initPtyDataDispatch
// ---------------------------------------------------------------------------

/** @type {Map<string, { chunks: Array<string|Uint8Array>, bytes: number }>} */
const earlyDataBuffers = new Map();
const EARLY_BUFFER_MAX_BYTES = 512 * 1024; // 512 KB per session
const EARLY_BUFFER_TIMEOUT_MS = 30_000;    // cleanup after 30s if never consumed

export function initPtyDataDispatch() {
	// Expose registry for DevTools debugging only in development builds.
	// In Electron, `process` is always defined, so check import.meta or
	// NODE_ENV directly.  The `app.isPackaged` flag is not available in
	// the renderer, so we rely on NODE_ENV which electron-vite sets at
	// build time.
	try {
		if (process.env?.NODE_ENV !== "production") {
			window.__terminalRegistry = registry;
		}
	} catch { /* process may not exist in some test envs */ }

	window.shellApi.onPtyData((sessionId, data) => {
		const handle = registry.get(sessionId);
		if (handle) {
			handle.write(data);
		} else {
			// Buffer data that arrives before createTerminal finishes.
			// Cap total bytes to prevent unbounded growth if init fails.
			let entry = earlyDataBuffers.get(sessionId);
			if (!entry) {
				entry = { chunks: [], bytes: 0 };
				earlyDataBuffers.set(sessionId, entry);
				// Auto-cleanup if the terminal is never created
				setTimeout(() => earlyDataBuffers.delete(sessionId), EARLY_BUFFER_TIMEOUT_MS);
			}
			const len = typeof data === "string" ? data.length : data.byteLength;
			if (entry.bytes < EARLY_BUFFER_MAX_BYTES) {
				entry.chunks.push(data);
				entry.bytes += len;
			}
		}
	});

	window.shellApi.onPtyExit((payload) => {
		const sid = typeof payload === "string" ? payload : payload?.sessionId;
		if (sid) {
			disposeTerminal(sid);
		}
	});
}
