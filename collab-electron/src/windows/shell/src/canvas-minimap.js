const MINIMAP_W = 160;
const MINIMAP_H = 112;
const PADDING_RATIO = 0.1;
const MIN_TILE_W = 4;
const MIN_TILE_H = 3;
const MIN_EXTENT_FACTOR = 3;

const TILE_COLORS = {
	term: "#4144e3",
	note: "#0bbac6",
	code: "#c9f82c",
	image: "#e12b3f",
	browser: "#9750e3",
	graph: "#e28143",
};

const TILE_OPACITY = 0.6;
const VP_BORDER_OPACITY = 0.55;
const SCRIM_OPACITY = 0.35;

export function createMinimap({ viewportEl, wrapperEl, viewportState, getTiles, viewport }) {
	const canvasEl = viewportEl;
	const canvas = wrapperEl.querySelector("canvas");
	const ctx = canvas.getContext("2d");

	let dirty = true;
	let rafId = null;
	let bounds = null;
	let minimapScale = 1;
	let offsetX = 0;
	let offsetY = 0;

	function resizeCanvas() {
		const dpr = window.devicePixelRatio || 1;
		canvas.width = MINIMAP_W * dpr;
		canvas.height = MINIMAP_H * dpr;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	}

	function computeBounds() {
		const tiles = getTiles();
		if (tiles.length === 0) return null;

		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;

		for (const t of tiles) {
			if (t.x < minX) minX = t.x;
			if (t.y < minY) minY = t.y;
			if (t.x + t.width > maxX) maxX = t.x + t.width;
			if (t.y + t.height > maxY) maxY = t.y + t.height;
		}

		let bw = maxX - minX;
		let bh = maxY - minY;

		const vw = canvasEl.clientWidth;
		const vh = canvasEl.clientHeight;
		const minW = MIN_EXTENT_FACTOR * vw;
		const minH = MIN_EXTENT_FACTOR * vh;

		if (bw < minW) {
			const cx = (minX + maxX) / 2;
			minX = cx - minW / 2;
			maxX = cx + minW / 2;
			bw = minW;
		}
		if (bh < minH) {
			const cy = (minY + maxY) / 2;
			minY = cy - minH / 2;
			maxY = cy + minH / 2;
			bh = minH;
		}

		const padW = bw * PADDING_RATIO;
		const padH = bh * PADDING_RATIO;
		minX -= padW;
		minY -= padH;
		maxX += padW;
		maxY += padH;

		return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
	}

	function computeScale(b) {
		const sx = MINIMAP_W / b.width;
		const sy = MINIMAP_H / b.height;
		minimapScale = Math.min(sx, sy);

		const contentW = b.width * minimapScale;
		const contentH = b.height * minimapScale;
		offsetX = (MINIMAP_W - contentW) / 2;
		offsetY = (MINIMAP_H - contentH) / 2;
	}

	function worldToMinimap(wx, wy) {
		return {
			x: (wx - bounds.minX) * minimapScale + offsetX,
			y: (wy - bounds.minY) * minimapScale + offsetY,
		};
	}

	function drawRoundRect(x, y, w, h, r) {
		r = Math.min(r, w / 2, h / 2);
		ctx.moveTo(x + r, y);
		ctx.lineTo(x + w - r, y);
		ctx.arcTo(x + w, y, x + w, y + r, r);
		ctx.lineTo(x + w, y + h - r);
		ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
		ctx.lineTo(x + r, y + h);
		ctx.arcTo(x, y + h, x, y + h - r, r);
		ctx.lineTo(x, y + r);
		ctx.arcTo(x, y, x + r, y, r);
		ctx.closePath();
	}

	function draw() {
		ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H);

		const tiles = getTiles();
		if (tiles.length === 0) return;

		bounds = computeBounds();
		if (!bounds) return;
		computeScale(bounds);

		for (const tile of tiles) {
			const pos = worldToMinimap(tile.x, tile.y);
			let w = tile.width * minimapScale;
			let h = tile.height * minimapScale;
			w = Math.max(w, MIN_TILE_W);
			h = Math.max(h, MIN_TILE_H);

			const hex = TILE_COLORS[tile.type] || "#888888";
			ctx.globalAlpha = TILE_OPACITY;
			ctx.fillStyle = hex;
			const gap = 0.5;
			ctx.fillRect(pos.x + gap, pos.y + gap, w - gap * 2, h - gap * 2);
		}

		const zoom = viewportState.zoom;
		const vpWorldX = -viewportState.panX / zoom;
		const vpWorldY = -viewportState.panY / zoom;
		const vpWorldW = canvasEl.clientWidth / zoom;
		const vpWorldH = canvasEl.clientHeight / zoom;

		const vpPos = worldToMinimap(vpWorldX, vpWorldY);
		let vpW = vpWorldW * minimapScale;
		let vpH = vpWorldH * minimapScale;

		let vpX = vpPos.x;
		let vpY = vpPos.y;

		if (vpX < 0) { vpW += vpX; vpX = 0; }
		if (vpY < 0) { vpH += vpY; vpY = 0; }
		if (vpX + vpW > MINIMAP_W) vpW = MINIMAP_W - vpX;
		if (vpY + vpH > MINIMAP_H) vpH = MINIMAP_H - vpY;

		const isDark = document.documentElement.classList.contains("dark");
		const vpVisible = vpW > 0 && vpH > 0;

		ctx.globalAlpha = SCRIM_OPACITY;
		ctx.fillStyle = isDark ? "#000000" : "#ffffff";
		ctx.beginPath();
		ctx.rect(0, 0, MINIMAP_W, MINIMAP_H);
		if (vpVisible) {
			drawRoundRect(vpX, vpY, vpW, vpH, 4);
		}
		ctx.fill("evenodd");

		if (vpVisible) {
			ctx.globalAlpha = VP_BORDER_OPACITY;
			ctx.strokeStyle = isDark ? "#ffffff" : "#000000";
			ctx.lineWidth = 1;
			ctx.beginPath();
			drawRoundRect(vpX, vpY, vpW, vpH, 4);
			ctx.stroke();
		}

		ctx.globalAlpha = 1;
	}

	function scheduleRedraw() {
		dirty = true;
		if (rafId) return;
		rafId = requestAnimationFrame(() => {
			rafId = null;
			if (!dirty) return;
			dirty = false;
			draw();
		});
	}

	function updateVisibility() {
		const tiles = getTiles();
		const shouldShow = tiles.length > 0;
		const isShown = wrapperEl.classList.contains("visible");

		if (shouldShow && !isShown) {
			wrapperEl.classList.add("visible");
			canvasEl.style.setProperty("--zoom-indicator-bottom", "136px");
		} else if (!shouldShow && isShown) {
			wrapperEl.classList.remove("visible");
			canvasEl.style.setProperty("--zoom-indicator-bottom", "12px");
		}
	}

	resizeCanvas();

	const minimap = {
		update() {
			updateVisibility();
			scheduleRedraw();
		},
		getViewportRect() {
			if (!bounds) return null;
			const zoom = viewportState.zoom;
			const vpWorldX = -viewportState.panX / zoom;
			const vpWorldY = -viewportState.panY / zoom;
			const vpWorldW = canvasEl.clientWidth / zoom;
			const vpWorldH = canvasEl.clientHeight / zoom;
			const vpPos = worldToMinimap(vpWorldX, vpWorldY);
			return {
				x: vpPos.x, y: vpPos.y,
				w: vpWorldW * minimapScale,
				h: vpWorldH * minimapScale,
			};
		},
		minimapToWorld(mx, my) {
			if (!bounds) return { x: 0, y: 0 };
			return {
				x: (mx - offsetX) / minimapScale + bounds.minX,
				y: (my - offsetY) / minimapScale + bounds.minY,
			};
		},
		getBounds() { return bounds; },
		getCanvas() { return canvas; },
	};

	// -- Interaction --

	let dragging = false;
	let dragOffsetX = 0;
	let dragOffsetY = 0;
	let animRafId = null;

	function getCanvasPoint(e) {
		const rect = canvas.getBoundingClientRect();
		return {
			x: (e.clientX - rect.left) * (MINIMAP_W / rect.width),
			y: (e.clientY - rect.top) * (MINIMAP_H / rect.height),
		};
	}

	function isInsideViewportRect(mx, my) {
		const vr = minimap.getViewportRect();
		if (!vr) return false;
		const tol = 4;
		return mx >= vr.x - tol && mx <= vr.x + vr.w + tol &&
			my >= vr.y - tol && my <= vr.y + vr.h + tol;
	}

	function panToMinimapPoint(mx, my) {
		const world = minimap.minimapToWorld(mx, my);
		const vw = canvasEl.clientWidth;
		const vh = canvasEl.clientHeight;
		const zoom = viewportState.zoom;
		const targetPanX = vw / 2 - world.x * zoom;
		const targetPanY = vh / 2 - world.y * zoom;
		return { targetPanX, targetPanY };
	}

	function animatePanTo(targetX, targetY) {
		if (animRafId) {
			cancelAnimationFrame(animRafId);
			animRafId = null;
		}

		const startX = viewportState.panX;
		const startY = viewportState.panY;
		const startTime = performance.now();
		const DURATION = 150;

		function easeOut(t) {
			return 1 - Math.pow(1 - t, 3);
		}

		function step(now) {
			const elapsed = now - startTime;
			const t = Math.min(elapsed / DURATION, 1);
			const e = easeOut(t);
			viewport.setPan(
				startX + (targetX - startX) * e,
				startY + (targetY - startY) * e,
			);
			if (t < 1) {
				animRafId = requestAnimationFrame(step);
			} else {
				animRafId = null;
			}
		}

		animRafId = requestAnimationFrame(step);
	}

	canvas.addEventListener("pointerdown", (e) => {
		e.stopPropagation();
		const pt = getCanvasPoint(e);

		if (isInsideViewportRect(pt.x, pt.y)) {
			dragging = true;
			const vr = minimap.getViewportRect();
			dragOffsetX = pt.x - vr.x;
			dragOffsetY = pt.y - vr.y;
			canvas.setPointerCapture(e.pointerId);
			canvas.style.cursor = "grabbing";
		} else {
			const { targetPanX, targetPanY } = panToMinimapPoint(pt.x, pt.y);
			animatePanTo(targetPanX, targetPanY);
		}
	});

	canvas.addEventListener("pointermove", (e) => {
		e.stopPropagation();
		if (dragging) {
			const pt = getCanvasPoint(e);
			const vr = minimap.getViewportRect();
			if (!vr) return;
			const newVpX = pt.x - dragOffsetX;
			const newVpY = pt.y - dragOffsetY;
			const centerMx = newVpX + vr.w / 2;
			const centerMy = newVpY + vr.h / 2;
			const world = minimap.minimapToWorld(centerMx, centerMy);
			const vw = canvasEl.clientWidth;
			const vh = canvasEl.clientHeight;
			const zoom = viewportState.zoom;
			viewport.setPan(
				vw / 2 - world.x * zoom,
				vh / 2 - world.y * zoom,
			);
		} else {
			const pt = getCanvasPoint(e);
			if (isInsideViewportRect(pt.x, pt.y)) {
				canvas.style.cursor = "grab";
			} else {
				canvas.style.cursor = "crosshair";
			}
		}
	});

	canvas.addEventListener("pointerup", (e) => {
		e.stopPropagation();
		if (dragging) {
			dragging = false;
			canvas.releasePointerCapture(e.pointerId);
			const pt = getCanvasPoint(e);
			if (isInsideViewportRect(pt.x, pt.y)) {
				canvas.style.cursor = "grab";
			} else {
				canvas.style.cursor = "crosshair";
			}
		}
	});

	canvas.addEventListener("pointercancel", (e) => {
		e.stopPropagation();
		dragging = false;
	});

	canvas.addEventListener("wheel", (e) => {
		e.stopPropagation();
	});

	canvas.style.cursor = "crosshair";

	return minimap;
}
