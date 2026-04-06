import { getTileLabel } from "./tile-renderer.js";

function getTileTypeLabel(type) {
	if (type === "image") return "img";
	return type;
}

export function isFullyOffScreen(tile, vw, vh, panX, panY, zoom) {
	const left = tile.x * zoom + panX;
	const top = tile.y * zoom + panY;
	const right = left + tile.width * zoom;
	const bottom = top + tile.height * zoom;
	return right <= 0 || left >= vw || bottom <= 0 || top >= vh;
}

export function rayRectIntersect(cx, cy, tx, ty, vw, vh) {
	const dx = tx - cx;
	const dy = ty - cy;
	const INSET = 8;
	let tMin = Infinity;
	let ix = cx;
	let iy = cy;

	// Left edge (x=0)
	if (dx < 0) {
		const t = (0 - cx) / dx;
		const y = cy + t * dy;
		if (t > 0 && t < tMin && y >= 0 && y <= vh) {
			tMin = t; ix = INSET; iy = y;
		}
	}
	// Right edge (x=vw)
	if (dx > 0) {
		const t = (vw - cx) / dx;
		const y = cy + t * dy;
		if (t > 0 && t < tMin && y >= 0 && y <= vh) {
			tMin = t; ix = vw - INSET; iy = y;
		}
	}
	// Top edge (y=0)
	if (dy < 0) {
		const t = (0 - cy) / dy;
		const x = cx + t * dx;
		if (t > 0 && t < tMin && x >= 0 && x <= vw) {
			tMin = t; ix = x; iy = INSET;
		}
	}
	// Bottom edge (y=vh)
	if (dy > 0) {
		const t = (vh - cy) / dy;
		const x = cx + t * dx;
		if (t > 0 && t < tMin && x >= 0 && x <= vw) {
			tMin = t; ix = x; iy = vh - INSET;
		}
	}

	return { x: ix, y: iy };
}

export function createEdgeIndicators({
	canvasEl, edgeIndicatorsEl, viewportState,
	getTiles, getTileDOMs, onViewportUpdate,
}) {
	let activeTooltipEl = null;
	let panAnimRaf = null;
	/** @type {Map<string, HTMLElement>} */
	const edgeDotMap = new Map();
	/** @type {Map<string, number>} */
	const edgeDotFadeOuts = new Map();

	function panToTile(tile, { targetZoom } = {}) {
		if (panAnimRaf) {
			cancelAnimationFrame(panAnimRaf);
			panAnimRaf = null;
		}

		const vw = canvasEl.clientWidth;
		const vh = canvasEl.clientHeight;
		const endZoom = targetZoom ?? viewportState.zoom;
		const targetX =
			vw / 2 - (tile.x + tile.width / 2) * endZoom;
		const targetY =
			vh / 2 - (tile.y + tile.height / 2) * endZoom;
		const startX = viewportState.panX;
		const startY = viewportState.panY;
		const startZoom = viewportState.zoom;
		const startTime = performance.now();
		const DURATION = 350;

		function easeOut(t) {
			return 1 - Math.pow(1 - t, 3);
		}

		const tileDOMs = getTileDOMs();
		const dom = tileDOMs.get(tile.id);
		if (dom) {
			dom.container.classList.add("edge-indicator-highlight");
			setTimeout(() => {
				dom.container.classList.remove(
					"edge-indicator-highlight",
				);
			}, 1200);
		}

		function step(now) {
			const elapsed = now - startTime;
			const t = Math.min(elapsed / DURATION, 1);
			const e = easeOut(t);
			viewportState.panX = startX + (targetX - startX) * e;
			viewportState.panY = startY + (targetY - startY) * e;
			if (targetZoom != null) {
				viewportState.zoom =
					startZoom + (endZoom - startZoom) * e;
			}
			onViewportUpdate();

			if (t < 1) {
				panAnimRaf = requestAnimationFrame(step);
			} else {
				panAnimRaf = null;
			}
		}

		panAnimRaf = requestAnimationFrame(step);
	}

	function panToTiles(tilesToFocus) {
		if (tilesToFocus.length === 1) {
			panToTile(tilesToFocus[0]);
			return;
		}

		if (panAnimRaf) {
			cancelAnimationFrame(panAnimRaf);
			panAnimRaf = null;
		}

		const PADDING = 60;
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const t of tilesToFocus) {
			if (t.x < minX) minX = t.x;
			if (t.y < minY) minY = t.y;
			if (t.x + t.width > maxX) maxX = t.x + t.width;
			if (t.y + t.height > maxY) maxY = t.y + t.height;
		}

		const vw = canvasEl.clientWidth;
		const vh = canvasEl.clientHeight;
		const bboxW = maxX - minX + PADDING * 2;
		const bboxH = maxY - minY + PADDING * 2;
		const zoom = Math.min(vw / bboxW, vh / bboxH, 1);
		const cx = (minX + maxX) / 2;
		const cy = (minY + maxY) / 2;
		const targetX = vw / 2 - cx * zoom;
		const targetY = vh / 2 - cy * zoom;

		const startX = viewportState.panX;
		const startY = viewportState.panY;
		const startZoom = viewportState.zoom;
		const startTime = performance.now();
		const DURATION = 350;

		function easeOut(t) {
			return 1 - Math.pow(1 - t, 3);
		}

		const tileDOMs = getTileDOMs();
		for (const t of tilesToFocus) {
			const dom = tileDOMs.get(t.id);
			if (dom) {
				dom.container.classList.add("edge-indicator-highlight");
				setTimeout(() => {
					dom.container.classList.remove(
						"edge-indicator-highlight",
					);
				}, 1200);
			}
		}

		function step(now) {
			const elapsed = now - startTime;
			const t = Math.min(elapsed / DURATION, 1);
			const e = easeOut(t);
			viewportState.panX = startX + (targetX - startX) * e;
			viewportState.panY = startY + (targetY - startY) * e;
			viewportState.zoom = startZoom + (zoom - startZoom) * e;
			onViewportUpdate();

			if (t < 1) {
				panAnimRaf = requestAnimationFrame(step);
			} else {
				panAnimRaf = null;
			}
		}

		panAnimRaf = requestAnimationFrame(step);
	}

	function removeTooltip() {
		if (activeTooltipEl) {
			activeTooltipEl.remove();
			activeTooltipEl = null;
		}
	}

	function showTooltip(dot, tile, dotX, dotY, vw, vh) {
		removeTooltip();
		const tooltip = document.createElement("div");
		tooltip.className = "edge-dot-tooltip";
		const label = getTileLabel(tile);
		const typeStr = getTileTypeLabel(tile.type);
		tooltip.textContent = `${typeStr}: ${label.name}`;
		edgeIndicatorsEl.appendChild(tooltip);

		const PAD = 6;
		const tw = tooltip.offsetWidth;
		const th = tooltip.offsetHeight;

		let tx = dotX - tw / 2;
		let ty = dotY - th / 2;

		if (dotX <= PAD + 4) tx = dotX + PAD;
		else if (dotX >= vw - PAD - 4) tx = dotX - PAD - tw;
		if (dotY <= PAD + 4) ty = dotY + PAD;
		else if (dotY >= vh - PAD - 4) ty = dotY - PAD - th;

		tx = Math.max(PAD, Math.min(tx, vw - tw - PAD));
		ty = Math.max(PAD, Math.min(ty, vh - th - PAD));

		tooltip.style.left = `${tx}px`;
		tooltip.style.top = `${ty}px`;
		activeTooltipEl = tooltip;
	}

	function updateEdgeIndicators() {
		activeTooltipEl = null;

		const vw = canvasEl.clientWidth;
		const vh = canvasEl.clientHeight;
		const vcx = vw / 2;
		const vcy = vh / 2;

		const activeIds = new Set();
		const tiles = getTiles();

		for (const tile of tiles) {
			if (!isFullyOffScreen(
				tile, vw, vh,
				viewportState.panX, viewportState.panY, viewportState.zoom,
			)) continue;

			activeIds.add(tile.id);

			const tcx =
				tile.x * viewportState.zoom +
				viewportState.panX +
				(tile.width * viewportState.zoom) / 2;
			const tcy =
				tile.y * viewportState.zoom +
				viewportState.panY +
				(tile.height * viewportState.zoom) / 2;
			const { x: dotX, y: dotY } =
				rayRectIntersect(vcx, vcy, tcx, tcy, vw, vh);

			let dot = edgeDotMap.get(tile.id);
			if (dot) {
				const fadeTimer = edgeDotFadeOuts.get(tile.id);
				if (fadeTimer != null) {
					clearTimeout(fadeTimer);
					edgeDotFadeOuts.delete(tile.id);
					dot.classList.add("visible");
				}
			} else {
				dot = document.createElement("div");
				dot.className = "edge-dot";

				dot.addEventListener("mouseenter", () => {
					const ctx = dot._edgeCtx;
					if (ctx) {
						showTooltip(
							dot, ctx.tile,
							ctx.dotX, ctx.dotY, ctx.vw, ctx.vh,
						);
					}
				});
				dot.addEventListener("mouseleave", removeTooltip);
				dot.addEventListener("click", () => {
					removeTooltip();
					const ctx = dot._edgeCtx;
					if (ctx) panToTile(ctx.tile);
				});

				edgeIndicatorsEl.appendChild(dot);
				edgeDotMap.set(tile.id, dot);
				requestAnimationFrame(() => dot.classList.add("visible"));
			}
			dot.style.left = `${dotX}px`;
			dot.style.top = `${dotY}px`;
			dot._edgeCtx = { tile, dotX, dotY, vw, vh };
		}

		for (const [id, dot] of edgeDotMap) {
			if (activeIds.has(id)) continue;
			if (edgeDotFadeOuts.has(id)) continue;
			dot.classList.remove("visible");
			edgeDotFadeOuts.set(id, setTimeout(() => {
				dot.remove();
				edgeDotMap.delete(id);
				edgeDotFadeOuts.delete(id);
			}, 200));
		}
	}

	return {
		update() {
			updateEdgeIndicators();
		},
		panToTile,
		panToTiles,
	};
}
