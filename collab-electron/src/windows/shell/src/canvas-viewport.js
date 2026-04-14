const ZOOM_MIN = 0.25;
const ZOOM_MAX = 1;
const ZOOM_RUBBER_BAND_K = 400;
const CELL = 20;
const MAJOR = 80;

const isMac = window.shellApi.getPlatform() === "darwin";

export function shouldZoom(e, mac = isMac) {
	return e.ctrlKey || (mac && e.metaKey);
}

function isDark() {
	return document.documentElement.classList.contains("dark");
}

export function createViewport(canvasEl, gridCanvas, tilesRef) {
	const gridCtx = gridCanvas.getContext("2d");
	let state = null;
	let onUpdate = null;
	let zoomSnapTimer = null;
	let zoomSnapRaf = null;
	let lastZoomFocalX = 0;
	let lastZoomFocalY = 0;
	let zoomIndicatorTimer = null;
	let prevCanvasW = canvasEl.clientWidth;
	let prevCanvasH = canvasEl.clientHeight;

	const zoomIndicatorEl = document.getElementById("zoom-indicator");

	function resizeGridCanvas() {
		const dpr = window.devicePixelRatio || 1;
		const w = canvasEl.clientWidth;
		const h = canvasEl.clientHeight;
		gridCanvas.width = w * dpr;
		gridCanvas.height = h * dpr;
		gridCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
	}

	function drawGrid() {
		const w = canvasEl.clientWidth;
		const h = canvasEl.clientHeight;
		if (w === 0 || h === 0) return;

		const dark = isDark();
		gridCtx.clearRect(0, 0, w, h);

		const rects = tilesRef.map((t) => ({
			l: t.x * state.zoom + state.panX,
			t: t.y * state.zoom + state.panY,
			r: (t.x + t.width) * state.zoom + state.panX,
			b: (t.y + t.height) * state.zoom + state.panY,
		}));

		function insideTile(px, py) {
			for (let i = 0; i < rects.length; i++) {
				const r = rects[i];
				if (px >= r.l && px <= r.r && py >= r.t && py <= r.b) {
					return true;
				}
			}
			return false;
		}

		const step = CELL * state.zoom;
		const majorStep = MAJOR * state.zoom;
		const offX = ((state.panX % majorStep) + majorStep) % majorStep;
		const offY = ((state.panY % majorStep) + majorStep) % majorStep;

		const dotOffX = ((state.panX % step) + step) % step;
		const dotOffY = ((state.panY % step) + step) % step;
		const dotSize = Math.max(1, 1.5 * state.zoom);
		const minorFade = Math.min(1, Math.max(0,
			(state.zoom - 0.5) / (0.75 - 0.5),
		));
		if (minorFade > 0) {
			const minorAlpha = dark ? 0.15 * minorFade : 0.25 * minorFade;
			gridCtx.fillStyle = dark
				? `rgba(255,255,255,${minorAlpha})`
				: `rgba(0,0,0,${minorAlpha})`;
			const halfDot = dotSize / 2;
			for (let x = dotOffX; x <= w; x += step) {
				for (let y = dotOffY; y <= h; y += step) {
					const px = Math.round(x - halfDot);
					const py = Math.round(y - halfDot);
					if (insideTile(x, y)) continue;
					gridCtx.fillRect(px, py, dotSize, dotSize);
				}
			}
		}

		const majorFade = Math.min(1, Math.max(0,
			(state.zoom - ZOOM_MIN) / (0.5 - ZOOM_MIN),
		));
		if (majorFade > 0) {
			const majorDotSize = Math.max(1.5, 1.5 * state.zoom);
			const halfMajor = majorDotSize / 2;
			const majorAlpha = dark ? 0.25 * majorFade : 0.40 * majorFade;
			gridCtx.fillStyle = dark
				? `rgba(255,255,255,${majorAlpha})`
				: `rgba(0,0,0,${majorAlpha})`;
			for (let x = offX; x <= w; x += majorStep) {
				for (let y = offY; y <= h; y += majorStep) {
					const px = Math.round(x - halfMajor);
					const py = Math.round(y - halfMajor);
					if (insideTile(x, y)) continue;
					gridCtx.fillRect(px, py, majorDotSize, majorDotSize);
				}
			}
		}
	}

	function showZoomIndicator() {
		const pct = Math.round(state.zoom * 100);
		zoomIndicatorEl.textContent = `${pct}%`;
		zoomIndicatorEl.classList.add("visible");
		clearTimeout(zoomIndicatorTimer);
		zoomIndicatorTimer = setTimeout(() => {
			zoomIndicatorEl.classList.remove("visible");
		}, 1200);
	}

	function updateCanvas() {
		drawGrid();
		if (onUpdate) onUpdate();
	}

	function snapBackZoom() {
		const fx = lastZoomFocalX;
		const fy = lastZoomFocalY;
		const target = state.zoom > ZOOM_MAX ? ZOOM_MAX : ZOOM_MIN;

		function animate() {
			const prevScale = state.zoom;
			state.zoom += (target - state.zoom) * 0.15;

			if (Math.abs(state.zoom - target) < 0.001) {
				state.zoom = target;
			}

			const ratio = state.zoom / prevScale - 1;
			state.panX -= (fx - state.panX) * ratio;
			state.panY -= (fy - state.panY) * ratio;
			showZoomIndicator();
			updateCanvas();

			if (state.zoom === target) {
				zoomSnapRaf = null;
				return;
			}
			zoomSnapRaf = requestAnimationFrame(animate);
		}

		zoomSnapRaf = requestAnimationFrame(animate);
	}

	function applyZoom(deltaY, focalX, focalY) {
		if (zoomSnapRaf) {
			cancelAnimationFrame(zoomSnapRaf);
			zoomSnapRaf = null;
		}
		clearTimeout(zoomSnapTimer);

		const prevScale = state.zoom;
		const MAX_ZOOM_DELTA = 25;
		const clamped = Math.sign(deltaY)
			* Math.min(Math.abs(deltaY), MAX_ZOOM_DELTA);
		let factor = Math.exp((-clamped * 0.6) / 100);

		if (state.zoom >= ZOOM_MAX && factor > 1) {
			const overshoot = state.zoom / ZOOM_MAX - 1;
			const damping = 1 / (1 + overshoot * ZOOM_RUBBER_BAND_K);
			factor = 1 + (factor - 1) * damping;
			state.zoom *= factor;
		} else if (state.zoom <= ZOOM_MIN && factor < 1) {
			const overshoot = ZOOM_MIN / state.zoom - 1;
			const damping = 1 / (1 + overshoot * ZOOM_RUBBER_BAND_K);
			factor = 1 - (1 - factor) * damping;
			state.zoom *= factor;
		} else {
			state.zoom *= factor;
		}

		const ratio = state.zoom / prevScale - 1;
		state.panX -= (focalX - state.panX) * ratio;
		state.panY -= (focalY - state.panY) * ratio;
		lastZoomFocalX = focalX;
		lastZoomFocalY = focalY;

		if (state.zoom > ZOOM_MAX || state.zoom < ZOOM_MIN) {
			zoomSnapTimer = setTimeout(snapBackZoom, 150);
		}

		showZoomIndicator();
		updateCanvas();
	}

	canvasEl.addEventListener("wheel", (e) => {
		e.preventDefault();

		if (shouldZoom(e)) {
			const rect = canvasEl.getBoundingClientRect();
			applyZoom(e.deltaY, e.clientX - rect.left, e.clientY - rect.top);
		} else {
			state.panX -= e.deltaX * 1.2;
			state.panY -= e.deltaY * 1.2;
			updateCanvas();
		}
	}, { passive: false });

	new ResizeObserver(() => {
		const w = canvasEl.clientWidth;
		const h = canvasEl.clientHeight;
		if (!state) { prevCanvasW = w; prevCanvasH = h; return; }
		state.panX += (w - prevCanvasW) / 2;
		state.panY += (h - prevCanvasH) / 2;
		prevCanvasW = w;
		prevCanvasH = h;
		resizeGridCanvas();
		updateCanvas();
	}).observe(canvasEl);

	resizeGridCanvas();

	return {
		init(viewportState, callback) {
			state = viewportState;
			onUpdate = callback;
			updateCanvas();
		},
		updateCanvas,
		redrawGrid: drawGrid,
		applyZoom,
		setPan(x, y) {
			state.panX = x;
			state.panY = y;
			updateCanvas();
		},
	};
}
