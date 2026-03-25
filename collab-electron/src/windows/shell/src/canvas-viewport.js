const ZOOM_LEVELS = [0.25, 0.5, 1, 1.5];
const ZOOM_MIN = ZOOM_LEVELS[0];
const ZOOM_MAX = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
const CELL = 20;
const MAJOR = 80;

const isMac = typeof navigator !== "undefined" && navigator.platform.startsWith("Mac");

function nearestZoomIndex(zoom) {
	let best = 0;
	let bestDist = Math.abs(zoom - ZOOM_LEVELS[0]);
	for (let i = 1; i < ZOOM_LEVELS.length; i++) {
		const d = Math.abs(zoom - ZOOM_LEVELS[i]);
		if (d < bestDist) { bestDist = d; best = i; }
	}
	return best;
}

export { ZOOM_LEVELS };

export function shouldZoom(e, mac = isMac) {
	return e.ctrlKey || (mac && e.metaKey);
}

function isDark() {
	return document.documentElement.classList.contains("dark");
}

export function createViewport(canvasEl, gridCanvas) {
	const gridCtx = gridCanvas.getContext("2d");
	let state = null;
	let onUpdate = null;
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

		const step = CELL * state.zoom;
		const majorStep = MAJOR * state.zoom;
		const offX = ((state.panX % majorStep) + majorStep) % majorStep;
		const offY = ((state.panY % majorStep) + majorStep) % majorStep;

		const dotOffX = ((state.panX % step) + step) % step;
		const dotOffY = ((state.panY % step) + step) % step;
		const dotSize = Math.max(1, 1.5 * state.zoom);
		gridCtx.fillStyle = dark
			? "rgba(255,255,255,0.22)"
			: "rgba(0,0,0,0.20)";
		for (let x = dotOffX; x <= w; x += step) {
			for (let y = dotOffY; y <= h; y += step) {
				const px = Math.round(x);
				const py = Math.round(y);
				gridCtx.fillRect(px, py, dotSize, dotSize);
			}
		}

		const majorDotSize = Math.max(1, 1.5 * state.zoom);
		gridCtx.fillStyle = dark
			? "rgba(255,255,255,0.40)"
			: "rgba(0,0,0,0.35)";
		for (let x = offX; x <= w; x += majorStep) {
			for (let y = offY; y <= h; y += majorStep) {
				const px = Math.round(x);
				const py = Math.round(y);
				gridCtx.fillRect(px, py, majorDotSize, majorDotSize);
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

	let zoomDeltaAccum = 0;
	const SNAP_THRESHOLD = 30;

	const ZOOM_DURATION = 180;

	function easeOutCubic(t) {
		return 1 - (1 - t) ** 3;
	}

	function animateToZoom(target, fx, fy) {
		if (zoomSnapRaf) {
			cancelAnimationFrame(zoomSnapRaf);
			zoomSnapRaf = null;
		}

		const startZoom = state.zoom;
		const startPanX = state.panX;
		const startPanY = state.panY;
		const startTime = performance.now();

		function animate(now) {
			const t = Math.min((now - startTime) / ZOOM_DURATION, 1);
			const eased = easeOutCubic(t);

			const prevScale = state.zoom;
			state.zoom = startZoom + (target - startZoom) * eased;

			const ratio = state.zoom / prevScale - 1;
			state.panX -= (fx - state.panX) * ratio;
			state.panY -= (fy - state.panY) * ratio;
			showZoomIndicator();
			updateCanvas();

			if (t < 1) {
				zoomSnapRaf = requestAnimationFrame(animate);
			} else {
				zoomSnapRaf = null;
			}
		}

		zoomSnapRaf = requestAnimationFrame(animate);
	}

	function applyZoom(deltaY, focalX, focalY) {
		lastZoomFocalX = focalX;
		lastZoomFocalY = focalY;

		zoomDeltaAccum += deltaY;

		if (Math.abs(zoomDeltaAccum) < SNAP_THRESHOLD) return;

		const direction = zoomDeltaAccum > 0 ? -1 : 1;
		zoomDeltaAccum = 0;

		const curIdx = nearestZoomIndex(state.zoom);
		const nextIdx = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, curIdx + direction));
		const target = ZOOM_LEVELS[nextIdx];

		if (target === state.zoom) return;

		animateToZoom(target, focalX, focalY);
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
		applyZoom,
	};
}
