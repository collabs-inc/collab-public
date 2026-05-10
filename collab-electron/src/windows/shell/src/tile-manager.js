import {
	tiles, addTile, removeTile, getTile, bringToFront,
	generateId, defaultSize, inferTileType, snapToGrid,
	selectTile, deselectTile, toggleTileSelection,
	clearSelection, isSelected, getSelectedTiles,
} from "./canvas-state.js";
import {
	createTileDOM, positionTile, updateTileTitle, getTileLabel,
} from "./tile-renderer.js";
import { workspaceRootMatch } from "@collab/shared/path-utils";
import { attachDrag, attachResize } from "./tile-interactions.js";
import { findAutoPlacement } from "./canvas-rpc.js";
import { pushCommand, undo, redo } from "./canvas-undo.js";

/**
 * Returns true if the tile's screen-space rectangle overlaps the viewport.
 */
function isInViewport(tile, panX, panY, zoom, canvasW, canvasH) {
	const sx = tile.x * zoom + panX, sy = tile.y * zoom + panY;
	const sw = tile.width * zoom, sh = tile.height * zoom;
	return sx + sw > 0 && sx < canvasW && sy + sh > 0 && sy < canvasH;
}

/**
 * Tile lifecycle manager: creation, deletion, persistence, webview
 * spawning, focus, selection visuals, and canvas save/restore.
 */
export function createTileManager({
	tileLayer, viewportState, configs,
	getAllWebviews, isSpaceHeld,
	onSaveDebounced, onSaveImmediate,
	onNoteSurfaceFocus, onFocusSurface,
	onTerminalSessionCreated,
	onTerminalTileClosed,
	onTileFocused,
	onTileDblClick,
	getWorkspaceHash,
}) {
	/** @type {Map<string, {container: HTMLElement, contentArea: HTMLElement, titleText: HTMLElement, webview?: HTMLElement}>} */
	const tileDOMs = new Map();
	let saveTimer = null;
	let focusedTileId = null;

	// Viewport read-only accessor for tile-interactions
	const viewport = {
		get panX() { return viewportState.panX; },
		get panY() { return viewportState.panY; },
		get zoom() { return viewportState.zoom; },
	};

	// -- Coordinate validation --

	function safeCoord(v) {
		return Number.isFinite(v) ? v : 0;
	}

	// -- Canvas persistence --

	function getCanvasStateForSave() {
		return {
			version: 1,
			tiles: tiles.map((t) => ({
				id: t.id,
				type: t.type,
				x: safeCoord(t.x),
				y: safeCoord(t.y),
				width: t.width,
				height: t.height,
				filePath: t.filePath,
				folderPath: t.folderPath,
				workspacePath: t.workspacePath,
				ptySessionId: t.ptySessionId,
				url: t.url,
				zIndex: t.zIndex,
			})),
			viewport: {
				panX: viewportState.panX,
				panY: viewportState.panY,
				zoom: viewportState.zoom,
			},
		};
	}

	function saveCanvasDebounced() {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			onSaveDebounced(getCanvasStateForSave());
		}, 500);
	}

	function saveCanvasImmediate() {
		clearTimeout(saveTimer);
		onSaveImmediate(getCanvasStateForSave());
	}

	// -- Tile positioning --

	function repositionAllTiles() {
		for (const tile of tiles) {
			const dom = tileDOMs.get(tile.id);
			if (!dom) continue;
			positionTile(
				dom.container, tile,
				viewportState.panX, viewportState.panY,
				viewportState.zoom,
			);
		}
	}

	// -- Selection visuals --

	function syncSelectionVisuals() {
		for (const [id, dom] of tileDOMs) {
			dom.container.classList.toggle(
				"tile-selected", isSelected(id),
			);
		}
	}

	// -- Focus management --

	function clearTileFocusRing() {
		for (const [, d] of tileDOMs) {
			d.container.classList.remove("tile-focused");
		}
	}

	function blurCanvasTileGuest(id = focusedTileId) {
		if (!id) return;
		const dom = tileDOMs.get(id);
		if (!dom?.webview) return;
		try { dom.webview.send("shell-blur"); } catch { /* noop */ }
		try { dom.webview.blur(); } catch { /* noop */ }
	}

	function forwardClickToWebview(webview, mouseEvent) {
		if (!webview.isConnected) return;
		if (
			typeof webview.isLoading === "function" &&
			webview.isLoading()
		) {
			return;
		}
		const rect = webview.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return;
		const x = Math.round(
			(mouseEvent.clientX - rect.left)
			* (webview.offsetWidth / rect.width),
		);
		const y = Math.round(
			(mouseEvent.clientY - rect.top)
			* (webview.offsetHeight / rect.height),
		);
		if (x < 0 || y < 0) return;
		if (x > webview.offsetWidth || y > webview.offsetHeight) return;
		webview.sendInputEvent({
			type: "mouseDown", x, y, button: "left", clickCount: 1,
		});
		webview.sendInputEvent({
			type: "mouseUp", x, y, button: "left", clickCount: 1,
		});
	}

	function focusCanvasTile(id, mouseEvent) {
		const tile = getTile(id);
		if (tile) {
			bringToFront(tile);
			repositionAllTiles();
		}
		const dom = tileDOMs.get(id);
		if (dom && dom.webview) {
			if (focusedTileId && focusedTileId !== id) {
				blurCanvasTileGuest(focusedTileId);
			}
			focusedTileId = id;
			if (onTileFocused) {
				onTileFocused(tile);
			}
			clearTileFocusRing();
			dom.container.classList.add("tile-focused");
			dom.webview.focus();
			onNoteSurfaceFocus("canvas-tile");

			if (
				mouseEvent && mouseEvent.button === 0 &&
				tile.type !== "browser"
			) {
				forwardClickToWebview(dom.webview, mouseEvent);
			}
		}
	}

	// -- Webview spawning --

	function spawnTerminalWebview(tile, autoFocus = false) {
		const dom = tileDOMs.get(tile.id);
		if (!dom) return;

		const wv = document.createElement("webview");
		const termConfig = configs.terminalTile;
		const params = new URLSearchParams();
		if (tile.ptySessionId) {
			params.set("sessionId", tile.ptySessionId);
			params.set("restored", "1");
		} else if (tile.cwd) {
			params.set("cwd", tile.cwd);
		}
		const qs = params.toString();
		wv.setAttribute(
			"src",
			qs ? `${termConfig.src}?${qs}` : termConfig.src,
		);
		wv.setAttribute("preload", termConfig.preload);
		wv.setAttribute(
			"webpreferences", "contextIsolation=yes, sandbox=yes",
		);
		wv.style.width = "100%";
		wv.style.height = "100%";
		wv.style.border = "none";

		dom.contentArea.appendChild(wv);
		dom.webview = wv;

		wv.addEventListener("dom-ready", () => {
			if (autoFocus) focusCanvasTile(tile.id);
			wv.addEventListener("before-input-event", () => {});
		});

		wv.addEventListener("ipc-message", (event) => {
			if (event.channel === "pty-session-id") {
				tile.ptySessionId = event.args[0];
				saveCanvasDebounced();
				if (onTerminalSessionCreated) {
					onTerminalSessionCreated(tile);
				}
			}
		});

	}

	function spawnGraphWebview(tile) {
		const dom = tileDOMs.get(tile.id);
		if (!dom) return;

		const wv = document.createElement("webview");
		const graphConfig = configs.graphTile;
		const params = new URLSearchParams();
		params.set("folder", tile.folderPath);
		params.set("workspace", tile.workspacePath ?? "");
		const qs = params.toString();
		wv.setAttribute("src", `${graphConfig.src}?${qs}`);
		wv.setAttribute("preload", graphConfig.preload);
		wv.setAttribute(
			"webpreferences", "contextIsolation=yes, sandbox=yes",
		);
		wv.style.width = "100%";
		wv.style.height = "100%";
		wv.style.border = "none";

		dom.contentArea.appendChild(wv);
		dom.webview = wv;
	}

	function spawnBrowserWebview(tile, autoFocus = false) {
		const dom = tileDOMs.get(tile.id);
		if (!dom) return;

		if (!tile.url) {
			if (autoFocus && dom.urlInput) {
				dom.urlInput.focus();
			}
			return;
		}

		let url = tile.url;
		if (!/^https?:\/\//i.test(url)) {
			const isLocal = /^localhost(:|$)/i.test(url) ||
				/^127\.0\.0\.1(:|$)/.test(url);
			url = (isLocal ? "http://" : "https://") + url;
			tile.url = url;
		}
		const blocked = /^(javascript|file|data):/i;
		if (blocked.test(url)) return;

		const wv = document.createElement("webview");
		wv.setAttribute("src", url);
		wv.setAttribute("allowpopups", "");
		const wsHash = getWorkspaceHash ? getWorkspaceHash() : "default";
		wv.setAttribute("partition", `persist:ws-${wsHash}`);
		wv.setAttribute(
			"webpreferences", "contextIsolation=yes, sandbox=yes",
		);
		wv.style.width = "100%";
		wv.style.height = "100%";
		wv.style.border = "none";

		dom.contentArea.appendChild(wv);
		dom.webview = wv;

		const stopSvg = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>`;
		const reloadSvg = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3v4h-4"/><path d="M12.36 10a5 5 0 1 1-.96-5.36L13 7"/></svg>`;

		function updateNavState() {
			if (dom.navBack) {
				dom.navBack.disabled = !wv.canGoBack();
			}
			if (dom.navForward) {
				dom.navForward.disabled = !wv.canGoForward();
			}
		}

		// Replace buttons with clones to strip stale listeners
		for (const key of ["navBack", "navForward", "navReload"]) {
			if (dom[key]) {
				const fresh = dom[key].cloneNode(true);
				dom[key].replaceWith(fresh);
				dom[key] = fresh;
			}
		}

		if (dom.navBack) {
			dom.navBack.addEventListener("click", (e) => {
				e.stopPropagation();
				if (wv.canGoBack()) wv.goBack();
			});
		}
		if (dom.navForward) {
			dom.navForward.addEventListener("click", (e) => {
				e.stopPropagation();
				if (wv.canGoForward()) wv.goForward();
			});
		}
		if (dom.navReload) {
			dom.navReload.addEventListener("click", (e) => {
				e.stopPropagation();
				if (wv.isLoading()) {
					wv.stop();
				} else {
					wv.reload();
				}
			});
		}

		wv.addEventListener("dom-ready", () => {
			wv.setZoomFactor(0.85);
		});

		function clearErrors() {
			for (const el of [
				...dom.contentArea.querySelectorAll(".tile-load-error"),
			]) {
				el.remove();
			}
		}

		wv.addEventListener("did-start-loading", () => {
			clearErrors();
			wv.style.display = "";
			if (dom.navReload) {
				dom.navReload.innerHTML = stopSvg;
				dom.navReload.title = "Stop";
			}
		});

		wv.addEventListener("did-stop-loading", () => {
			if (dom.navReload) {
				dom.navReload.innerHTML = reloadSvg;
				dom.navReload.title = "Reload";
			}
			updateNavState();
		});

		wv.addEventListener("did-navigate", (e) => {
			tile.url = e.url;
			if (dom.urlInput) dom.urlInput.value = e.url;
			updateTileTitle(dom, tile);
			updateNavState();
			saveCanvasDebounced();
		});

		wv.addEventListener("did-navigate-in-page", (e) => {
			if (e.isMainFrame) {
				tile.url = e.url;
				if (dom.urlInput) dom.urlInput.value = e.url;
				updateTileTitle(dom, tile);
				updateNavState();
				saveCanvasDebounced();
			}
		});

		wv.addEventListener("did-fail-load", (e) => {
			if (e.errorCode === -3) return;
			if (!e.isMainFrame) return;
			clearErrors();
			wv.style.display = "none";
			const errDiv = document.createElement("div");
			errDiv.className = "tile-load-error";
			errDiv.style.cssText =
				"padding:20px;color:#888;font-size:13px;";
			errDiv.textContent =
				`Failed to load: ${e.validatedURL || tile.url}`;
			dom.contentArea.appendChild(errDiv);
		});

		wv.addEventListener("render-process-gone", () => {
			const crashDiv = document.createElement("div");
			crashDiv.style.cssText =
				"padding:20px;color:#888;font-size:13px;";
			crashDiv.textContent =
				"Page crashed. Edit the URL and press Enter to reload.";
			if (dom.webview) {
				dom.contentArea.removeChild(dom.webview);
				dom.webview = null;
			}
			dom.contentArea.appendChild(crashDiv);
		});

		if (autoFocus) {
			wv.addEventListener(
				"dom-ready", () => focusCanvasTile(tile.id),
			);
		}
	}

	// -- Tile CRUD --

	function createCanvasTile(type, cx, cy, extra = {}) {
		const size = defaultSize(type);
		const tile = addTile({
			id: extra.id || generateId(),
			type,
			x: cx,
			y: cy,
			width: extra.width || size.width,
			height: extra.height || size.height,
			...extra,
		});
		snapToGrid(tile);
		window.shellApi.trackEvent("tile_created", { type });

		const dom = createTileDOM(tile, {
			onClose: (id) => closeCanvasTile(id),
			onFocus: (id, e) => {
				if (e && e.shiftKey) {
					toggleTileSelection(id);
					syncSelectionVisuals();
					return;
				}
				clearSelection();
				syncSelectionVisuals();
				focusCanvasTile(id, e);
			},
			onOpenInViewer: (id) => {
				const t = getTile(id);
				if (t?.filePath) {
					window.shellApi.trackEvent(
						"tile_opened_in_viewer", { type: t.type },
					);
					window.shellApi.selectFile(t.filePath);
				}
			},
			onNavigate: (id, url) => {
				const t = getTile(id);
				if (!t || t.type !== "browser") return;
				t.url = url;
				const d = tileDOMs.get(id);
				if (d?.webview) {
					d.contentArea.removeChild(d.webview);
					d.webview = null;
				}
				spawnBrowserWebview(t);
				saveCanvasImmediate();
			},
		});

		// Double-click title bar → center tile in viewport
		dom.titleBar.addEventListener("dblclick", (e) => {
			e.stopPropagation();
			if (onTileDblClick) onTileDblClick(tile);
		});

		attachDrag(dom.titleBar, tile, {
			viewport,
			onUpdate: repositionAllTiles,
			disablePointerEvents: (wvs) => {
				for (const w of wvs) {
					w.webview.style.pointerEvents = "none";
				}
			},
			enablePointerEvents: (wvs) => {
				for (const w of wvs) {
					w.webview.style.pointerEvents = "";
				}
			},
			getAllWebviews,
			getGroupDragContext: () => {
				if (
					!isSelected(tile.id) ||
					getSelectedTiles().length <= 1
				) {
					return null;
				}
				return getSelectedTiles().map((t) => ({
					tile: t,
					container: tileDOMs.get(t.id)?.container,
					startX: t.x,
					startY: t.y,
				}));
			},
			onShiftClick: (id) => {
				toggleTileSelection(id);
				syncSelectionVisuals();
			},
			onFocus: (id, e) => focusCanvasTile(id, e),
			isSpaceHeld,
			contentOverlay: dom.contentOverlay,
			onDragEnd: (tileId, before, after) => {
				pushCommand({ type: "tile-move", tileId, before, after });
				saveCanvasDebounced();
			},
		});
		attachResize(
			dom.container, tile, viewport,
			repositionAllTiles,
			getAllWebviews,
			(tileId, before, after) => {
				pushCommand({ type: "tile-resize", tileId, before, after });
				saveCanvasDebounced();
			},
			() => focusCanvasTile(tile.id),
		);

		tileLayer.appendChild(dom.container);
		tileDOMs.set(tile.id, dom);
		positionTile(
			dom.container, tile,
			viewportState.panX, viewportState.panY,
			viewportState.zoom,
		);

		return tile;
	}

	function closeCanvasTile(id) {
		const tile = getTile(id);
		if (tile) {
			pushCommand({ type: "tile-delete", tileId: id, deletedTile: { ...tile } });
		}
		const dom = tileDOMs.get(id);
		if (dom) {
			dom.container.remove();
			tileDOMs.delete(id);
		}
		deselectTile(id);
		if (tile) {
			window.shellApi.trackEvent(
				"tile_closed", { type: tile.type },
			);
			if (tile.type === "term" && tile.ptySessionId) {
				window.shellApi.ptyKillSession(tile.ptySessionId);
				if (onTerminalTileClosed) {
					onTerminalTileClosed(tile.ptySessionId);
				}
			}
		}
		removeTile(id);
		saveCanvasImmediate();
	}

	function createFileTile(type, cx, cy, filePath) {
		const tile = createCanvasTile(type, cx, cy, { filePath });
		const dom = tileDOMs.get(tile.id);
		if (!dom) return tile;

		if (type === "image") {
			const imgContainer = document.createElement("div");
			imgContainer.style.cssText = "overflow:hidden;width:100%;height:100%;cursor:grab;";

			const img = document.createElement("img");
			img.src = `collab-file://${tile.filePath}`;
			img.style.cssText = "width:100%;height:100%;object-fit:contain;transform-origin:center;pointer-events:none;";
			img.draggable = false;
			imgContainer.appendChild(img);

			let imgZoom = 1, imgPanX = 0, imgPanY = 0;
			function applyTransform() {
				img.style.transform = `translate(${imgPanX}px, ${imgPanY}px) scale(${imgZoom})`;
			}

			// Wheel zoom (stopPropagation prevents canvas zoom)
			imgContainer.addEventListener("wheel", (e) => {
				e.stopPropagation(); e.preventDefault();
				imgZoom = Math.max(0.1, Math.min(10, imgZoom * Math.exp(-e.deltaY * 0.003)));
				applyTransform();
			}, { passive: false });

			// Drag to pan
			let dragging = false, sx = 0, sy = 0, spx = 0, spy = 0;
			imgContainer.addEventListener("mousedown", (e) => {
				if (e.button !== 0) return;
				dragging = true; sx = e.clientX; sy = e.clientY; spx = imgPanX; spy = imgPanY;
				imgContainer.style.cursor = "grabbing";
			});
			window.addEventListener("mousemove", (e) => {
				if (!dragging) return;
				imgPanX = spx + (e.clientX - sx) / imgZoom;
				imgPanY = spy + (e.clientY - sy) / imgZoom;
				applyTransform();
			});
			window.addEventListener("mouseup", () => { dragging = false; imgContainer.style.cursor = "grab"; });

			// Double-click to reset
			imgContainer.addEventListener("dblclick", () => {
				imgZoom = 1; imgPanX = 0; imgPanY = 0; applyTransform();
			});

			dom.contentArea.appendChild(imgContainer);
		} else {
			const wv = document.createElement("webview");
			const viewerConfig = configs.viewer;
			const mode = type === "note" ? "note" : "code";
			const viewerParams = new URLSearchParams();
			if (typeof filePath === "string" && filePath.length > 0) {
				viewerParams.set("tilePath", filePath);
			}
			viewerParams.set("tileMode", mode);
			wv.setAttribute(
				"src",
				`${viewerConfig.src}?${viewerParams.toString()}`,
			);
			wv.setAttribute("preload", viewerConfig.preload);
			wv.setAttribute(
				"webpreferences",
				"contextIsolation=yes, sandbox=yes",
			);
			wv.style.width = "100%";
			wv.style.height = "100%";
			wv.style.border = "none";

			dom.contentArea.appendChild(wv);
			dom.webview = wv;

			wv.addEventListener("dom-ready", () => {});
		}

		saveCanvasImmediate();
		return tile;
	}

	function createGraphTile(cx, cy, folderPath, workspacePath) {
		const tile = createCanvasTile("graph", cx, cy, {
			folderPath, workspacePath,
		});
		spawnGraphWebview(tile);
		saveCanvasImmediate();
		return tile;
	}

	function clearCanvasBatch() {
		for (const [, dom] of tileDOMs) {
			dom.container.remove();
		}
		tileDOMs.clear();
		clearSelection();
		tiles.length = 0;
		focusedTileId = null;
	}

	function clearCanvas(viewportObj) {
		const tileIds = tiles.map((t) => t.id);
		for (const id of tileIds) {
			closeCanvasTile(id);
		}
		viewportState.panX = 0;
		viewportState.panY = 0;
		viewportState.zoom = 1;
		viewportObj.updateCanvas();
		saveCanvasImmediate();
	}

	// -- Canvas state restore --

	function spawnTileContent(tile) {
		if (tile.type === "term") {
			spawnTerminalWebview(tile);
		} else if (tile.type === "graph" && tile.folderPath) {
			spawnGraphWebview(tile);
		} else if (tile.type === "browser") {
			spawnBrowserWebview(tile);
		} else if (tile.filePath) {
			// File tiles inline-create their content; nothing extra needed.
		}
	}

	function restoreCanvasState(savedTiles) {
		const canvasW = tileLayer.offsetWidth;
		const canvasH = tileLayer.offsetHeight;

		for (const saved of savedTiles) {
			let cx = saved.x;
			let cy = saved.y;
			if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
				const size = defaultSize(saved.type);
				const pos = findAutoPlacement(
					tiles, size.width, size.height,
				);
				cx = pos.x;
				cy = pos.y;
			}

			if (saved.type === "term") {
				// Terminal tiles always spawn eagerly (PTY session bindings).
				const tile = createCanvasTile(
					"term", cx, cy, {
						id: saved.id,
						width: saved.width,
						height: saved.height,
						zIndex: saved.zIndex,
						ptySessionId: saved.ptySessionId,
					},
				);
				spawnTerminalWebview(tile);
			} else if (saved.type === "graph" && saved.folderPath) {
				const tile = createCanvasTile(
					"graph", cx, cy, {
						id: saved.id,
						width: saved.width,
						height: saved.height,
						zIndex: saved.zIndex,
						folderPath: saved.folderPath,
						workspacePath: saved.workspacePath,
					},
				);
				if (isInViewport(tile, viewportState.panX, viewportState.panY, viewportState.zoom, canvasW, canvasH)) {
					spawnGraphWebview(tile);
				} else {
					tile.deferred = true;
					const placeholder = document.createElement("div");
					placeholder.className = "tile-deferred-placeholder";
					placeholder.textContent = getTileLabel(tile);
					tileDOMs.get(tile.id)?.contentArea.appendChild(placeholder);
				}
			} else if (saved.type === "browser") {
				const tile = createCanvasTile(
					"browser", cx, cy, {
						id: saved.id,
						width: saved.width,
						height: saved.height,
						zIndex: saved.zIndex,
						url: saved.url,
					},
				);
				if (isInViewport(tile, viewportState.panX, viewportState.panY, viewportState.zoom, canvasW, canvasH)) {
					spawnBrowserWebview(tile);
				} else {
					tile.deferred = true;
					const placeholder = document.createElement("div");
					placeholder.className = "tile-deferred-placeholder";
					placeholder.textContent = getTileLabel(tile);
					tileDOMs.get(tile.id)?.contentArea.appendChild(placeholder);
				}
			} else if (saved.filePath) {
				const tileObj = {
					type: saved.type,
					x: saved.x, y: saved.y,
					width: saved.width, height: saved.height,
					filePath: saved.filePath,
				};
				if (isInViewport(tileObj, viewportState.panX, viewportState.panY, viewportState.zoom, canvasW, canvasH)) {
					createFileTile(saved.type, saved.x, saved.y, saved.filePath);
				} else {
					const tile = createCanvasTile(
						saved.type, saved.x, saved.y, {
							id: saved.id,
							width: saved.width,
							height: saved.height,
							zIndex: saved.zIndex,
							filePath: saved.filePath,
						},
					);
					tile.deferred = true;
					const placeholder = document.createElement("div");
					placeholder.className = "tile-deferred-placeholder";
					placeholder.textContent = getTileLabel(tile);
					tileDOMs.get(tile.id)?.contentArea.appendChild(placeholder);
				}
			}
		}
	}

	// -- Deferred tile spawning --

	function checkDeferredTiles() {
		const canvasW = tileLayer.offsetWidth;
		const canvasH = tileLayer.offsetHeight;

		for (const tile of tiles) {
			if (!tile.deferred) continue;
			if (!isInViewport(tile, viewportState.panX, viewportState.panY, viewportState.zoom, canvasW, canvasH)) continue;

			tile.deferred = false;
			const dom = tileDOMs.get(tile.id);
			if (!dom) continue;

			// Remove placeholder(s).
			for (const el of dom.contentArea.querySelectorAll(".tile-deferred-placeholder")) {
				el.remove();
			}

			// Spawn content.
			if (tile.type === "graph" && tile.folderPath) {
				spawnGraphWebview(tile);
			} else if (tile.type === "browser") {
				spawnBrowserWebview(tile);
			} else if (tile.filePath && tile.type !== "image") {
				// Recreate file-viewer webview inline (matches createFileTile logic).
				const wv = document.createElement("webview");
				const viewerConfig = configs.viewer;
				const mode = tile.type === "note" ? "note" : "code";
				const viewerParams = new URLSearchParams();
				if (typeof tile.filePath === "string" && tile.filePath.length > 0) {
					viewerParams.set("tilePath", tile.filePath);
				}
				viewerParams.set("tileMode", mode);
				wv.setAttribute(
					"src",
					`${viewerConfig.src}?${viewerParams.toString()}`,
				);
				wv.setAttribute("preload", viewerConfig.preload);
				wv.setAttribute("webpreferences", "contextIsolation=yes, sandbox=yes");
				wv.style.width = "100%";
				wv.style.height = "100%";
				wv.style.border = "none";
				dom.contentArea.appendChild(wv);
				dom.webview = wv;
			} else if (tile.filePath && tile.type === "image") {
				// Recreate image viewer inline.
				const imgContainer = document.createElement("div");
				imgContainer.style.cssText = "overflow:hidden;width:100%;height:100%;cursor:grab;";
				const img = document.createElement("img");
				img.src = `collab-file://${tile.filePath}`;
				img.style.cssText = "width:100%;height:100%;object-fit:contain;transform-origin:center;pointer-events:none;";
				img.draggable = false;
				imgContainer.appendChild(img);
				dom.contentArea.appendChild(imgContainer);
			}
		}
	}

	let _deferredCheckTimer = null;
	function checkDeferredTilesDebounced() {
		clearTimeout(_deferredCheckTimer);
		_deferredCheckTimer = setTimeout(checkDeferredTiles, 200);
	}

	// -- Tile updates for external events --

	function updateTileForRename(oldPath, newPath) {
		let anyUpdated = false;
		for (const t of tiles) {
			if (t.filePath === oldPath) {
				t.filePath = newPath;
				t.type = inferTileType(newPath);
				const dom = tileDOMs.get(t.id);
				if (dom) updateTileTitle(dom, t);
				anyUpdated = true;
			}
			if (
				t.type === "graph" && t.folderPath &&
				workspaceRootMatch(oldPath, t.folderPath)
			) {
				t.folderPath =
					newPath + t.folderPath.slice(oldPath.length);
				const dom = tileDOMs.get(t.id);
				if (dom) {
					updateTileTitle(dom, t);
					if (dom.webview) {
						dom.webview.send(
							"scope-changed", t.folderPath,
						);
					}
				}
				anyUpdated = true;
			}
		}
		if (anyUpdated) saveCanvasDebounced();
	}

	function closeTilesForDeletedPaths(deletedPaths) {
		const deleted = new Set(deletedPaths);
		for (const t of [...tiles]) {
			if (t.filePath && deleted.has(t.filePath)) {
				closeCanvasTile(t.id);
			}
			if (
				t.type === "graph" && t.folderPath &&
				deleted.has(t.folderPath)
			) {
				closeCanvasTile(t.id);
			}
		}
	}

	function broadcastToTileWebviews(channel, ...args) {
		for (const [, dom] of tileDOMs) {
			if (dom.webview) dom.webview.send(channel, ...args);
		}
	}

	return {
		createCanvasTile,
		closeCanvasTile,
		focusCanvasTile,
		blurCanvasTileGuest,
		clearTileFocusRing,
		repositionAllTiles,
		syncSelectionVisuals,
		spawnTerminalWebview,
		spawnGraphWebview,
		spawnBrowserWebview,
		createFileTile,
		createGraphTile,
		clearCanvas,
		clearCanvasBatch,
		getCanvasStateForSave,
		restoreCanvasState,
		checkDeferredTiles,
		checkDeferredTilesDebounced,
		getTileDOMs: () => tileDOMs,
		getFocusedTileId: () => focusedTileId,
		setFocusedTileId: (id) => { focusedTileId = id; },
		updateTileForRename,
		closeTilesForDeletedPaths,
		broadcastToTileWebviews,
		saveCanvasDebounced,
		saveCanvasImmediate,
		executeUndo() {
			const cmd = undo();
			if (!cmd) return;
			switch (cmd.type) {
				case "tile-move": {
					const tile = getTile(cmd.tileId);
					if (tile) { tile.x = cmd.before.x; tile.y = cmd.before.y; snapToGrid(tile); this.repositionAllTiles(); this.saveCanvasDebounced(); }
					break;
				}
				case "tile-resize": {
					const tile = getTile(cmd.tileId);
					if (tile) { tile.width = cmd.before.width; tile.height = cmd.before.height; snapToGrid(tile); this.repositionAllTiles(); this.saveCanvasDebounced(); }
					break;
				}
				case "tile-delete": {
					addTile({ ...cmd.deletedTile });
					this.restoreCanvasState([cmd.deletedTile]);
					this.saveCanvasImmediate();
					break;
				}
			}
		},
		executeRedo() {
			const cmd = redo();
			if (!cmd) return;
			switch (cmd.type) {
				case "tile-move": {
					const tile = getTile(cmd.tileId);
					if (tile) { tile.x = cmd.after.x; tile.y = cmd.after.y; snapToGrid(tile); this.repositionAllTiles(); this.saveCanvasDebounced(); }
					break;
				}
				case "tile-resize": {
					const tile = getTile(cmd.tileId);
					if (tile) { tile.width = cmd.after.width; tile.height = cmd.after.height; snapToGrid(tile); this.repositionAllTiles(); this.saveCanvasDebounced(); }
					break;
				}
				case "tile-delete": {
					this.closeCanvasTile(cmd.tileId);
					break;
				}
			}
		},
	};
}
