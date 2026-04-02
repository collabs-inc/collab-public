const ZOOM_MIN = 0.33;
const ZOOM_MAX = 1;
const ZOOM_RUBBER_BAND_K = 400;
const CELL = 20;
const MAJOR = 80;

const isMac = typeof window !== "undefined" && window.shellApi?.getPlatform() === "darwin";

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
	let zoomSnapTimer = null;
	let zoomSnapRaf = null;
	let lastZoomFocalX = 0;
	let lastZoomFocalY = 0;
	let zoomIndicatorTimer = null;
	let prevCanvasW = canvasEl.clientWidth;
	let prevCanvasH = canvasEl.clientHeight;

	const zoomIndicatorEl = document.getElementById("zoom-indicator");

	function resizeGridCanvas() {
		// Grid is now CSS-based — hide the canvas to save memory.
		gridCanvas.style.display = "none";
	}

	// CSS-based grid — GPU-composited, zero JS cost per frame during pan.
	// Uses layered radial-gradient backgrounds for minor + major dots.
	// Pan = background-position update. Zoom = background-size update.
	// No canvas drawing at all.

	// Cache zoom/theme to avoid rebuilding gradients on pure-pan frames.
	let gridCachedZoom = -1;
	let gridCachedDark = null;
	const R = 1; // dot radius
	const MIN_SPACING = 8;

	function rebuildGridStyle() {
		const dark = isDark();
		const step = CELL * state.zoom;
		const majorStep = MAJOR * state.zoom;

		if (state.zoom === gridCachedZoom && dark === gridCachedDark) return;
		gridCachedZoom = state.zoom;
		gridCachedDark = dark;

		const layers = [];
		const sizes = [];

		if (majorStep >= 4) {
			const color = dark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.4)";
			layers.push(`radial-gradient(circle ${R}px at ${R}px ${R}px, ${color} 100%, transparent 100%)`);
			sizes.push(`${majorStep}px ${majorStep}px`);
		}
		if (step >= MIN_SPACING) {
			const fade = Math.min(1, (step - MIN_SPACING) / MIN_SPACING);
			const alpha = dark ? 0.15 * fade : 0.25 * fade;
			const color = dark
				? `rgba(255,255,255,${alpha})`
				: `rgba(0,0,0,${alpha})`;
			layers.push(`radial-gradient(circle ${R}px at ${R}px ${R}px, ${color} 100%, transparent 100%)`);
			sizes.push(`${step}px ${step}px`);
		}

		if (layers.length > 0) {
			canvasEl.style.backgroundImage = layers.join(", ");
			canvasEl.style.backgroundSize = sizes.join(", ");
		} else {
			canvasEl.style.backgroundImage = "none";
		}
	}

	function drawGrid() {
		rebuildGridStyle();

		const step = CELL * state.zoom;
		const majorStep = MAJOR * state.zoom;
		const positions = [];

		if (majorStep >= 4) {
			const offX = ((state.panX % majorStep) + majorStep) % majorStep;
			const offY = ((state.panY % majorStep) + majorStep) % majorStep;
			positions.push(`${offX - R}px ${offY - R}px`);
		}
		if (step >= MIN_SPACING) {
			const offX = ((state.panX % step) + step) % step;
			const offY = ((state.panY % step) + step) % step;
			positions.push(`${offX - R}px ${offY - R}px`);
		}
		if (positions.length > 0) {
			canvasEl.style.backgroundPosition = positions.join(", ");
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
		drawGrid,
		applyZoom,
	};
}
