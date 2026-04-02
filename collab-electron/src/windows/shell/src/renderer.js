import "./shell.css";
import {
	tiles, getTile, defaultSize, inferTileType,
	selectTile, clearSelection, getSelectedTiles,
} from "./canvas-state.js";
import { attachMarquee } from "./tile-interactions.js";
import { initDarkMode, applyCanvasOpacity } from "./dark-mode.js";
import { createWebview, isFocusSearchShortcut } from "./webview-factory.js";
import { createViewport } from "./canvas-viewport.js";
import { createEdgeIndicators } from "./edge-indicators.js";
import { createPanel } from "./panel-manager.js";
import { createWorkspaceManager } from "./workspace-manager.js";
import { createCanvasRpc } from "./canvas-rpc.js";
import { createTileManager } from "./tile-manager.js";
import { updateTileTitle } from "./tile-renderer.js";
import { normalizeCommandName } from "@collab/shared/path-utils";
import { initKeyboardShortcut as initPerfOverlay } from "./perf-overlay.js";

const CANVAS_DBLCLICK_SUPPRESS_MS = 500;
const IS_WINDOWS = window.shellApi.getPlatform() === "win32";

const viewportState = { panX: 0, panY: 0, zoom: 1 };

const canvasEl = document.getElementById("panel-viewer");
const gridCanvas = document.getElementById("grid-canvas");
canvasEl.tabIndex = -1;

document.documentElement.classList.toggle("platform-win", IS_WINDOWS);
document.body.classList.toggle("platform-win", IS_WINDOWS);

// -- Dark mode --

initDarkMode(() => viewport.updateCanvas());

let broadcastCanvasOpacity = () => {};
const DEFAULT_CANVAS_OPACITY = 50;
let lastCanvasOpacity = DEFAULT_CANVAS_OPACITY;

window.shellApi.getPref("canvasOpacity").then((v) => {
	lastCanvasOpacity = v != null ? v : DEFAULT_CANVAS_OPACITY;
	applyCanvasOpacity(lastCanvasOpacity);
	broadcastCanvasOpacity();
});

window.shellApi.onPrefChanged((key, value) => {
	if (key === "canvasOpacity") {
		lastCanvasOpacity = value;
		applyCanvasOpacity(value);
		broadcastCanvasOpacity();
	}
});

// -- Viewport --

const viewport = createViewport(canvasEl, gridCanvas);

/** Convert in-memory panX/panY state to a center-point for persistence. */
function toCenterPointState(state) {
	const { panX, panY, zoom } = state.viewport;
	const w = canvasEl.clientWidth;
	const h = canvasEl.clientHeight;
	return {
		...state,
		viewport: {
			centerX: (w / 2 - panX) / zoom,
			centerY: (h / 2 - panY) / zoom,
			zoom,
		},
	};
}

// -- Init --

async function init() {
	const [
		configs, workspaceData,
		prefNavWidth, prefNavVisible,
		prefTermWidth, prefTermVisible,
	] = await Promise.all([
		window.shellApi.getViewConfig(),
		window.shellApi.workspaceList(),
		window.shellApi.getPref("panel-width-nav"),
		window.shellApi.getPref("panel-visible-nav"),
		window.shellApi.getPref("panel-width-terminal"),
		window.shellApi.getPref("panel-visible-terminal"),
	]);

	// DOM elements
	const panelNav = document.getElementById("panel-nav");
	const panelViewer = document.getElementById("panel-viewer");
	const navResizeHandle = document.getElementById("nav-resize");
	const navToggle = document.getElementById("nav-toggle");
	const workspaceTrigger =
		document.getElementById("workspace-trigger");
	const workspaceTriggerParent =
		document.getElementById("workspace-trigger-parent");
	const workspaceTriggerName =
		document.getElementById("workspace-trigger-name");
	const workspaceMenuItems =
		document.getElementById("workspace-menu-items");
	const wsAddOption =
		document.getElementById("ws-add-option");
	const settingsOverlay =
		document.getElementById("settings-overlay");
	const settingsBackdrop =
		document.getElementById("settings-backdrop");
	const settingsModal = document.getElementById("settings-modal");
	const settingsBtn = document.getElementById("settings-btn");
	const updatePill = document.getElementById("update-pill");
	const dragDropOverlay =
		document.getElementById("drag-drop-overlay");
	const tileLayer = document.getElementById("tile-layer");
	const panelTerminal =
		document.getElementById("panel-terminal");
	const terminalResizeHandle =
		document.getElementById("terminal-resize");
	const terminalToggle =
		document.getElementById("terminal-toggle");

	// -- State --

	let dragCounter = 0;
	let settingsModalOpen = false;
	let activeSurface = "canvas";
	let lastNonModalSurface = "canvas";
	let shiftHeld = false;
	let spaceHeld = false;
	let isPanning = false;
	let suppressCanvasDblClickUntil = 0;

	// -- Drag-and-drop handler (shared with webviews) --

	function handleDndMessage(channel) {
		if (channel === "dnd:dragenter") {
			dragCounter++;
			if (dragCounter === 1 && dragDropOverlay) {
				dragDropOverlay.classList.add("visible");
				for (const h of getAllWebviews()) {
					h.webview.style.pointerEvents = "none";
				}
			}
		} else if (channel === "dnd:dragleave") {
			dragCounter = Math.max(0, dragCounter - 1);
			if (dragCounter === 0 && dragDropOverlay) {
				dragDropOverlay.classList.remove("visible");
			}
		} else if (channel === "dnd:drop") {
			dragCounter = 0;
			if (dragDropOverlay) {
				dragDropOverlay.classList.remove("visible");
			}
			for (const h of getAllWebviews()) {
				h.webview.style.pointerEvents = "";
			}
		}
	}

	// -- Singleton webviews --

	const singletonViewer = createWebview(
		"viewer", configs.viewer, panelViewer, handleDndMessage,
	);
	singletonViewer.webview.style.display = "none";
	singletonViewer.webview.addEventListener("focus", () => {
		noteSurfaceFocus("viewer");
	});
	singletonViewer.setBeforeInput((event, detail) => {
		if (!isFocusSearchShortcut(detail)) return;
		event.preventDefault();
		handleShortcut("focus-search");
	});

	const singletonWebviews = {
		settings: createWebview(
			"settings", configs.settings,
			settingsModal, handleDndMessage,
		),
	};
	singletonWebviews.settings.webview.addEventListener("focus", () => {
		noteSurfaceFocus("settings");
	});

	const terminalListWebview = createWebview(
		"terminal-list", configs.terminalList,
		panelTerminal, handleDndMessage,
	);

	// -- Panel manager --

	const panelManager = createPanel("nav", {
		panel: panelNav,
		resizeHandle: navResizeHandle, toggle: navToggle,
		label: "Navigator",
		defaultWidth: 280,
		direction: 1,
		getAllWebviews,
		onVisibilityChanged(visible) {
			if (visible) {
				requestAnimationFrame(() => {
					singletonViewer.send("nav-visibility", true);
				});
			} else {
				singletonViewer.send("nav-visibility", false);
			}
		},
	});
	panelManager.initPrefs(prefNavWidth, prefNavVisible);

	const terminalPanel = createPanel("terminal", {
		panel: panelTerminal,
		resizeHandle: terminalResizeHandle,
		toggle: terminalToggle,
		label: "Terminals",
		defaultWidth: 240,
		direction: -1,
		getAllWebviews,
	});
	terminalPanel.initPrefs(prefTermWidth, prefTermVisible);

	function syncTerminalTileMeta(tile, meta) {
		if (!meta) return;
		tile.cwd = meta.cwdHostPath || meta.cwd || tile.cwd;
		tile.displayName = meta.displayName || tile.displayName;
		const dom = tileManager.getTileDOMs().get(tile.id);
		if (dom) {
			updateTileTitle(dom, tile);
		}
	}

	function buildTerminalListEntry(tile, meta) {
		if (!tile?.ptySessionId || !meta) return null;
		return {
			sessionId: tile.ptySessionId,
			displayName: meta.displayName || "Terminal",
			commandName: normalizeCommandName(
				meta.command || meta.shell || "shell",
			) || "shell",
			cwd: meta.cwdHostPath || meta.cwd || tile.cwd || "~",
			foreground: null,
			tileId: tile.id,
		};
	}

	// -- Workspace manager --

	const workspaceManager = createWorkspaceManager({
		panelNav, workspaceMenuItems,
		workspaceTriggerParent, workspaceTriggerName,
		configs, createWebview, handleDndMessage,
		onNoteSurfaceFocus: noteSurfaceFocus,
		onSwitch(index) {
			window.shellApi.workspaceSwitch(index);
		},
		onApplyNavVisibility() {
			panelManager.applyVisibility();
		},
	});

	// Forward canvas opacity to all nav webviews
	broadcastCanvasOpacity = () => {
		if (lastCanvasOpacity == null) return;
		const opacity = Math.max(0, Math.min(100, Number(lastCanvasOpacity) || 0)) / 100;
		for (const nav of workspaceManager.getAllNavWebviews()) {
			nav.send("canvas-opacity", opacity);
		}
		terminalListWebview.send("canvas-opacity", opacity);
	};
	broadcastCanvasOpacity();

	// -- Tile manager --

	const tileManager = createTileManager({
		tileLayer, viewportState, configs,
		getAllWebviews,
		isSpaceHeld: () => spaceHeld,
		onSaveDebounced(state) {
			window.shellApi.canvasSaveState(
				toCenterPointState(state),
			);
		},
		onSaveImmediate(state) {
			window.shellApi.canvasSaveState(
				toCenterPointState(state),
			);
		},
		onNoteSurfaceFocus: noteSurfaceFocus,
		onFocusSurface: focusSurface,
		async onTerminalSessionCreated(tile) {
			const discovered =
				await window.shellApi.ptyDiscover?.() ?? [];
			const session = discovered.find(
				(entry) => entry.sessionId === tile.ptySessionId,
			);
			syncTerminalTileMeta(tile, session?.meta);
			const entry = buildTerminalListEntry(tile, session?.meta);
			if (entry) {
				terminalListWebview.send("terminal-list:add", entry);
			}
		},
		onTerminalTileClosed(sessionId) {
			terminalListWebview.send(
				"terminal-list:remove", sessionId,
			);
		},
		onTileFocused(tile) {
			terminalListWebview.send(
				"terminal-list:focus",
				tile?.ptySessionId || null,
			);
		},
		onTileDblClick(tile) {
			edgeIndicators.panToTile(tile);
		},
	});

	// -- Edge indicators --

	const edgeIndicators = createEdgeIndicators({
		canvasEl,
		edgeIndicatorsEl: document.getElementById("edge-indicators"),
		viewportState,
		getTiles: () => tiles,
		getTileDOMs: () => tileManager.getTileDOMs(),
		onViewportUpdate() {
			viewport.updateCanvas();
		},
	});

	// -- Canvas RPC --

	const handleCanvasRpc = createCanvasRpc({
		tileManager, viewportState, viewport, workspaceManager,
		edgeIndicators,
	});

	// -- Wire viewport updates --

	viewport.init(viewportState, () => {
		tileManager.repositionAllTiles();
		edgeIndicators.update();
		tileManager.saveCanvasDebounced();
	});

	edgeIndicators.update();

	// -- Surface focus management --

	function noteSurfaceFocus(surface) {
		if (settingsModalOpen && surface !== "settings") {
			focusSurface("settings");
			return;
		}
		if (
			activeSurface === "canvas-tile" &&
			surface !== "canvas-tile"
		) {
			tileManager.blurCanvasTileGuest();
		}
		activeSurface = surface;
		if (surface !== "settings") {
			lastNonModalSurface = surface;
		}
		const canvasOwned =
			surface === "canvas" || surface === "canvas-tile";
		canvasEl.classList.toggle("canvas-focused", canvasOwned);
		if (surface !== "canvas-tile") {
			tileManager.clearTileFocusRing();
		}
	}

	function isViewerVisible() {
		return singletonViewer.webview.style.display !== "none";
	}

	function resolveSurface(surface = lastNonModalSurface) {
		if (surface === "canvas-tile" && tileManager.getFocusedTileId()) {
			const dom = tileManager.getTileDOMs()
				.get(tileManager.getFocusedTileId());
			if (dom && dom.webview) return "canvas-tile";
		}
		if (surface === "viewer" && !isViewerVisible()) {
			surface = null;
		}
		if (
			surface === "nav" &&
			!(panelManager.isVisible() &&
				workspaceManager.getActiveWorkspace())
		) {
			surface = null;
		}
		if (surface === "viewer") return "viewer";
		if (surface === "nav") return "nav";
		if (
			panelManager.isVisible() &&
			workspaceManager.getActiveWorkspace()
		) return "nav";
		if (isViewerVisible()) return "viewer";
		return "canvas";
	}

	function focusSurface(surface = lastNonModalSurface) {
		if (
			surface === "canvas-tile" &&
			tileManager.getFocusedTileId()
		) {
			const dom = tileManager.getTileDOMs()
				.get(tileManager.getFocusedTileId());
			if (dom && dom.webview) {
				dom.webview.focus();
				noteSurfaceFocus("canvas-tile");
				return;
			}
		}

		requestAnimationFrame(() => {
			window.focus();
			if (surface === "settings") {
				singletonWebviews.settings.webview.focus();
				noteSurfaceFocus("settings");
				return;
			}
			const resolved = resolveSurface(surface);
			const workspace = workspaceManager.getActiveWorkspace();
			if (resolved === "nav" && workspace) {
				workspace.nav.webview.focus();
				noteSurfaceFocus("nav");
				return;
			}
			if (resolved === "viewer" && isViewerVisible()) {
				singletonViewer.webview.focus();
				noteSurfaceFocus("viewer");
				return;
			}
			canvasEl.focus();
			noteSurfaceFocus("canvas");
		});
	}

	function setUnderlyingShellInert(inert) {
		const panelsEl = document.getElementById("panels");
		panelsEl.inert = inert;
		navToggle.inert = inert;
		workspaceTrigger.inert = inert;
		wsAddOption.inert = inert;
	}

	function blurNonModalSurfaces() {
		canvasEl.blur();
		navToggle.blur();
		workspaceTrigger.blur();
		singletonViewer.webview.blur();
		for (const ws of workspaceManager.getWorkspaces()) {
			ws.nav.webview.blur();
		}
	}

	// -- getAllWebviews aggregator --

	function getAllWebviews() {
		const all = [];
		for (const wv of workspaceManager.getAllNavWebviews()) {
			all.push(wv);
		}
		all.push(singletonViewer);
		all.push(terminalListWebview);
		all.push(singletonWebviews.settings);
		for (const [, dom] of tileManager.getTileDOMs()) {
			if (dom.webview) {
				all.push({
					webview: dom.webview,
					send: (ch, ...args) => {
						if (dom.webview) dom.webview.send(ch, ...args);
					},
				});
			}
		}
		return all;
	}

	// -- Window + canvas focus listeners --

	window.addEventListener("focus", () => {
		noteSurfaceFocus("shell");
	});
	canvasEl.addEventListener("focus", () => {
		noteSurfaceFocus("canvas");
	});
	canvasEl.classList.add("canvas-focused");

	// -- Double-click to create terminal tile --

	canvasEl.addEventListener("dblclick", (e) => {
		if (
			spaceHeld || isPanning ||
			Date.now() < suppressCanvasDblClickUntil
		) return;
		if (
			e.target !== canvasEl && e.target !== gridCanvas &&
			e.target !== tileLayer
		) return;

		const rect = canvasEl.getBoundingClientRect();
		const screenX = e.clientX - rect.left;
		const screenY = e.clientY - rect.top;
		const cx = (screenX - viewportState.panX) / viewportState.zoom;
		const cy = (screenY - viewportState.panY) / viewportState.zoom;

		const ws = workspaceManager.getActiveWorkspace();
		const cwd = ws ? ws.path : undefined;
		const tile = tileManager.createCanvasTile(
			"term", cx, cy, { cwd },
		);
		tileManager.spawnTerminal(tile, true);
		tileManager.saveCanvasImmediate();
	});

	// -- Right-click context menu --

	canvasEl.addEventListener("contextmenu", async (e) => {
		if (
			e.target !== canvasEl && e.target !== gridCanvas &&
			e.target !== tileLayer
		) return;
		e.preventDefault();

		const rect = canvasEl.getBoundingClientRect();
		const screenX = e.clientX - rect.left;
		const screenY = e.clientY - rect.top;
		const cx = (screenX - viewportState.panX) / viewportState.zoom;
		const cy = (screenY - viewportState.panY) / viewportState.zoom;

		const selected = await window.shellApi.showContextMenu([
			{ id: "new-terminal", label: "New terminal tile" },
			{ id: "new-browser", label: "New browser tile" },
		]);

		if (selected === "new-terminal") {
			const ws = workspaceManager.getActiveWorkspace();
			const cwd = ws ? ws.path : undefined;
			const tile = tileManager.createCanvasTile(
				"term", cx, cy, { cwd },
			);
			tileManager.spawnTerminal(tile, true);
			tileManager.saveCanvasImmediate();
		} else if (selected === "new-browser") {
			const tile = tileManager.createCanvasTile(
				"browser", cx, cy,
			);
			tileManager.spawnBrowserWebview(tile, true);
			tileManager.saveCanvasImmediate();
		}
	});

	// -- Workspace dropdown --

	workspaceTrigger.addEventListener("click", () => {
		if (workspaceManager.isDropdownOpen()) {
			workspaceManager.closeDropdown();
		} else {
			workspaceManager.openDropdown();
		}
	});

	document.addEventListener("click", (e) => {
		if (!workspaceManager.isDropdownOpen()) return;
		const dropdown =
			document.getElementById("workspace-dropdown");
		if (!dropdown.contains(e.target)) {
			workspaceManager.closeDropdown();
		}
	});

	document.addEventListener("focusin", (event) => {
		if (!settingsModalOpen) return;
		if (settingsOverlay.contains(event.target)) return;
		focusSurface("settings");
	});

	wsAddOption.addEventListener("click", async () => {
		workspaceManager.closeDropdown();
		const result = await window.shellApi.workspaceAdd();
		if (!result) return;

		const { workspaces: wsList, active } = result;
		if (
			workspaceManager.getWorkspaces().length < wsList.length
		) {
			const newPath = wsList[wsList.length - 1];
			workspaceManager.addWorkspace(newPath);
			broadcastCanvasOpacity();
		}
		workspaceManager.switchWorkspace(active);
	});

	// -- Marquee selection --

	attachMarquee(canvasEl, {
		viewport: {
			get panX() { return viewportState.panX; },
			get panY() { return viewportState.panY; },
			get zoom() { return viewportState.zoom; },
		},
		tiles: () => tiles,
		onSelectionChange: (ids) => {
			if (shiftHeld) {
				for (const id of ids) selectTile(id);
			} else {
				clearSelection();
				for (const id of ids) selectTile(id);
			}
			tileManager.syncSelectionVisuals();
			tileManager.blurCanvasTileGuest();
			tileManager.clearTileFocusRing();
			tileManager.setFocusedTileId(null);
			canvasEl.focus();
			noteSurfaceFocus("canvas");
		},
		isShiftHeld: () => shiftHeld,
		isSpaceHeld: () => spaceHeld,
		getAllWebviews,
	});

	// -- Selection keyboard handlers --

	window.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && getSelectedTiles().length > 0) {
			clearSelection();
			tileManager.syncSelectionVisuals();
			return;
		}

		if (
			(e.key === "Backspace" || e.key === "Delete") &&
			(activeSurface === "canvas" ||
				activeSurface === "canvas-tile")
		) {
			const selected = getSelectedTiles();
			if (selected.length === 0) return;

			const count = selected.length;
			window.shellApi.showConfirmDialog({
				message: count === 1
					? "Delete this tile?"
					: `Delete ${count} tiles?`,
				detail: "This cannot be undone.",
				buttons: ["Cancel", "Delete"],
			}).then((response) => {
				if (response !== 1) return;
				for (const t of selected) {
					tileManager.closeCanvasTile(t.id);
				}
				clearSelection();
				tileManager.syncSelectionVisuals();
			});
		}
	});

	// -- Shift scroll passthrough --

	window.addEventListener("keydown", (e) => {
		if (e.key === "Shift" && !shiftHeld) {
			shiftHeld = true;
			canvasEl.classList.add("shift-held");
		}
	});

	window.addEventListener("keyup", (e) => {
		if (e.key === "Shift") {
			shiftHeld = false;
			canvasEl.classList.remove("shift-held");
		}
	});

	window.addEventListener("blur", () => {
		if (shiftHeld) {
			shiftHeld = false;
			canvasEl.classList.remove("shift-held");
		}
	});

	// -- Space+click and middle-click pan --

	window.addEventListener("keydown", (e) => {
		if (e.code === "Space" && !e.target.closest?.("webview") && !e.target.closest?.(".terminal-embed-container")) {
			e.preventDefault();
			if (!e.repeat && !spaceHeld) {
				spaceHeld = true;
				canvasEl.classList.add("space-held");
				for (const h of getAllWebviews()) {
					h.webview.blur();
				}
			}
		}
	});

	window.addEventListener("keyup", (e) => {
		if (e.code === "Space") {
			spaceHeld = false;
			if (!isPanning) {
				canvasEl.classList.remove("space-held");
			}
		}
	});

	window.addEventListener("blur", () => {
		if (spaceHeld) {
			spaceHeld = false;
			canvasEl.classList.remove("space-held", "panning");
		}
	});

	canvasEl.addEventListener("mousedown", (e) => {
		const shouldPan =
			e.button === 1 || (e.button === 0 && spaceHeld);
		if (!shouldPan) return;

		e.preventDefault();
		suppressCanvasDblClickUntil =
			Date.now() + CANVAS_DBLCLICK_SUPPRESS_MS;
		isPanning = true;
		canvasEl.classList.add("panning");

		const startMX = e.clientX;
		const startMY = e.clientY;
		const startPanX = viewportState.panX;
		const startPanY = viewportState.panY;

		for (const h of getAllWebviews()) {
			h.webview.style.pointerEvents = "none";
		}

		// Use CSS transform on the tile layer during pan for smooth 60fps.
		// This avoids per-tile style updates and grid redraws on every frame.
		const tileLayer = document.getElementById("tile-layer");
		let panRafId = 0;

		function onMove(ev) {
			viewportState.panX = startPanX + (ev.clientX - startMX);
			viewportState.panY = startPanY + (ev.clientY - startMY);
			if (!panRafId) {
				panRafId = requestAnimationFrame(() => {
					panRafId = 0;
					// Translate the entire tile layer instead of repositioning each tile
					if (tileLayer) {
						const dx = viewportState.panX - startPanX;
						const dy = viewportState.panY - startPanY;
						tileLayer.style.transform = `translate(${dx}px, ${dy}px)`;
					}
					viewport.drawGrid();
				});
			}
		}

		function onUp() {
			isPanning = false;
			if (panRafId) { cancelAnimationFrame(panRafId); panRafId = 0; }
			// Reset transform and do proper tile repositioning
			if (tileLayer) { tileLayer.style.transform = ""; }
			viewport.updateCanvas();
			canvasEl.classList.remove("panning");
			if (!spaceHeld) {
				canvasEl.classList.remove("space-held");
			}
			document.removeEventListener("mousemove", onMove);
			document.removeEventListener("mouseup", onUp);
			for (const h of getAllWebviews()) {
				h.webview.style.pointerEvents = "";
			}
		}

		document.addEventListener("mousemove", onMove);
		document.addEventListener("mouseup", onUp);
	});

	// -- Shortcuts --

	function focusActiveNavSearch() {
		const workspace = workspaceManager.getActiveWorkspace();
		if (!workspace) return;
		focusSurface("nav");
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				workspace.nav.send("focus-search");
			});
		});
	}

	function handleShortcut(action) {
		if (settingsModalOpen && action !== "toggle-settings") {
			focusSurface("settings");
			return;
		}
		if (action === "toggle-settings") {
			window.shellApi.toggleSettings();
		} else if (action === "toggle-nav") {
			panelManager.toggle();
		} else if (action === "focus-search") {
			if (workspaceManager.getActiveWorkspace()) {
				if (!panelManager.isVisible()) {
					panelManager.setVisible(true);
				}
				focusActiveNavSearch();
			}
		} else if (action === "add-workspace") {
			wsAddOption.click();
		} else if (action === "toggle-terminal-list") {
			terminalPanel.toggle();
		} else if (action === "new-tile") {
			const rect = canvasEl.getBoundingClientRect();
			const size = defaultSize("term");
			const cx =
				(rect.width / 2 - viewportState.panX) /
				viewportState.zoom - size.width / 2;
			const cy =
				(rect.height / 2 - viewportState.panY) /
				viewportState.zoom - size.height / 2;
			const ws = workspaceManager.getActiveWorkspace();
			const cwd = ws ? ws.path : undefined;
			const tile = tileManager.createCanvasTile(
				"term", cx, cy, { cwd },
			);
			tileManager.spawnTerminal(tile, true);
			tileManager.saveCanvasImmediate();
		} else if (action === "close-tile") {
			const focusedId = tileManager.getFocusedTileId();
			if (focusedId) {
				tileManager.closeCanvasTile(focusedId);
				tileManager.setFocusedTileId(null);
				canvasEl.focus();
				noteSurfaceFocus("canvas");
			}
		}
	}

	window.shellApi.onShortcut(handleShortcut);

	// -- Performance overlay (F3) --
	initPerfOverlay();

	window.addEventListener("keydown", (event) => {
		if (!isFocusSearchShortcut(event)) return;
		event.preventDefault();
		handleShortcut("focus-search");
	});

	window.addEventListener("keydown", (event) => {
		if (!event.metaKey || event.shiftKey || event.altKey) return;
		if (event.key === "n") {
			event.preventDefault();
			handleShortcut("new-tile");
		} else if (event.key === "w") {
			event.preventDefault();
			handleShortcut("close-tile");
		}
	});

	// -- Browser tile Cmd+L focus URL --

	window.shellApi.onBrowserTileFocusUrl((webContentsId) => {
		for (const [, dom] of tileManager.getTileDOMs()) {
			if (!dom.webview || !dom.urlInput) continue;
			if (dom.webview.getWebContentsId() === webContentsId) {
				dom.urlInput.readOnly = false;
				dom.urlInput.focus();
				dom.urlInput.select();
				break;
			}
		}
	});

	// -- IPC forwarding --

	window.shellApi.onForwardToWebview(
		(target, channel, ...args) => {
			if (target === "settings") {
				singletonWebviews.settings.send(channel, ...args);
			} else if (target === "nav") {
				const ws = workspaceManager.getActiveWorkspace();
				if (ws) ws.nav.send(channel, ...args);
			} else if (
				target === "viewer" ||
				target.startsWith("viewer:")
			) {
				if (channel === "file-selected") {
					const hasSelectedFile = !!args[0];
					if (!hasSelectedFile) {
						singletonViewer.webview.blur();
					}
					singletonViewer.webview.style.display =
						hasSelectedFile ? "" : "none";
					if (!hasSelectedFile) {
						focusSurface(lastNonModalSurface);
					}
				}
				if (channel === "file-renamed") {
					tileManager.updateTileForRename(
						args[0], args[1],
					);
				}
				if (channel === "files-deleted") {
					tileManager.closeTilesForDeletedPaths(args[0]);
				}
				if (channel !== "workspace-changed") {
					singletonViewer.send(channel, ...args);
				}
				if (
					channel === "fs-changed" ||
					channel === "file-renamed" ||
					channel === "wikilinks-updated" ||
					channel.startsWith("agent:") ||
					channel === "replay:data"
				) {
					tileManager.broadcastToTileWebviews(
						channel, ...args,
					);
				}
			} else if (target === "canvas") {
				if (channel === "open-terminal") {
					const cwd = args[0];
					const size = defaultSize("term");
					const rect = canvasEl.getBoundingClientRect();
					const cx =
						(rect.width / 2 - viewportState.panX) /
						viewportState.zoom - size.width / 2;
					const cy =
						(rect.height / 2 - viewportState.panY) /
						viewportState.zoom - size.height / 2;
					const tile = tileManager.createCanvasTile(
						"term", cx, cy, { cwd },
					);
					tileManager.spawnTerminal(tile, true);
					tileManager.saveCanvasImmediate();
				}
				if (channel === "open-browser-tile") {
					const url = args[0];
					const sourceWcId = args[1];
					let srcTile = null;
					for (const [id, d] of tileManager.getTileDOMs()) {
						if (
							d.webview &&
							d.webview.getWebContentsId() === sourceWcId
						) {
							srcTile = getTile(id);
							break;
						}
					}
					const x = srcTile ? srcTile.x + 40 : 0;
					const y = srcTile ? srcTile.y + 40 : 0;
					const extra = { url };
					if (srcTile) {
						extra.width = srcTile.width;
						extra.height = srcTile.height;
					}
					const newTile = tileManager.createCanvasTile(
						"browser", x, y, extra,
					);
					tileManager.spawnBrowserWebview(newTile, true);
					tileManager.saveCanvasImmediate();
				}
				if (channel === "create-graph-tile") {
					const folderPath = args[0];
					const size = defaultSize("graph");
					const rect = canvasEl.getBoundingClientRect();
					const cx =
						(rect.width / 2 - viewportState.panX) /
						viewportState.zoom - size.width / 2;
					const cy =
						(rect.height / 2 - viewportState.panY) /
						viewportState.zoom - size.height / 2;
					const ws =
						workspaceManager.getActiveWorkspace();
					const wsPath = ws?.path ?? "";
					tileManager.createGraphTile(
						cx, cy, folderPath, wsPath,
					);
				}
			}
		},
	);

	// -- Canvas pinch from tile webviews --

	window.shellApi.onCanvasPinch((deltaY) => {
		const rect = canvasEl.getBoundingClientRect();
		viewport.applyZoom(
			deltaY, rect.width / 2, rect.height / 2,
		);
	});

	// -- Canvas RPC --

	window.shellApi.onCanvasRpcRequest(handleCanvasRpc);

	// -- PTY lifecycle forwarding --

	window.shellApi.onPtyExit((payload) => {
		terminalListWebview.send("pty-exit", payload);

		for (const [id] of tileManager.getTileDOMs()) {
			const tile = getTile(id);
			if (
				tile?.type === "term" &&
				tile.ptySessionId === payload.sessionId
			) {
				tileManager.closeCanvasTile(id);
				break;
			}
		}
	});

	window.shellApi.onPtyStatusChanged((payload) => {
		terminalListWebview.send("pty-status-changed", payload);
	});

	// -- Terminal list init + click-to-focus --

	terminalListWebview.webview.addEventListener(
		"dom-ready", async () => {
			const discovered =
				await window.shellApi.ptyDiscover?.() ?? [];
			const initEntries = [];
			for (const [id] of tileManager.getTileDOMs()) {
				const tile = getTile(id);
				if (tile?.type === "term" && tile.ptySessionId) {
					const disc = discovered.find(
						(d) => d.sessionId === tile.ptySessionId,
					);
					if (!disc) {
						continue;
					}
					syncTerminalTileMeta(tile, disc.meta);
					const entry = buildTerminalListEntry(tile, disc.meta);
					if (entry) {
						initEntries.push(entry);
					}
				}
			}

			terminalListWebview.send(
				"terminal-list:init", initEntries,
			);

			const focusedId = tileManager.getFocusedTileId();
			if (focusedId) {
				const tile = getTile(focusedId);
				terminalListWebview.send(
					"terminal-list:focus",
					tile?.ptySessionId || null,
				);
			}
		},
	);

	terminalListWebview.webview.addEventListener(
		"ipc-message", (event) => {
			if (event.channel === "terminal-list:peek-tile") {
				const sessionId = event.args[0];
				for (const [id] of tileManager.getTileDOMs()) {
					const tile = getTile(id);
					if (
						tile?.type === "term" &&
						tile.ptySessionId === sessionId
					) {
						edgeIndicators.panToTile(tile);
						break;
					}
				}
			}
		},
	);

	// -- Nav resize --

	panelManager.setupResize(() => {
		panelManager.updateTogglePosition();
	});

	const panelsEl = document.getElementById("panels");
	new ResizeObserver(() => {
		panelManager.updateTogglePosition();
		terminalPanel.updateTogglePosition();
	}).observe(panelsEl);

	// -- Nav toggle --

	navToggle.addEventListener("click", () => {
		panelManager.toggle();
	});

	terminalToggle.addEventListener("click", () => {
		terminalPanel.toggle();
	});

	// -- Settings --

	settingsBackdrop.addEventListener("click", () => {
		window.shellApi.closeSettings();
	});

	window.shellApi.onSettingsToggle((action) => {
		const open = action === "open";
		settingsModalOpen = open;
		if (open) {
			blurNonModalSurfaces();
		} else {
			singletonWebviews.settings.webview.blur();
		}
		setUnderlyingShellInert(open);
		settingsOverlay.classList.toggle("visible", open);
		if (open) {
			focusSurface("settings");
			return;
		}
		focusSurface(lastNonModalSurface);
	});

	// -- Update pill --

	let updateState = { status: "idle" };
	const isDevMode = import.meta.env.DEV;

	function renderUpdatePill() {
		if (updateState.status === "downloading") {
			updatePill.style.display = "inline-block";
			updatePill.classList.add("is-downloading");
			updatePill.classList.remove("is-error");
			updatePill.textContent =
				`Updating ${Math.round(updateState.progress ?? 0)}%`;
			updatePill.title = "Downloading update...";
		} else if (updateState.status === "installing") {
			updatePill.style.display = "inline-block";
			updatePill.classList.add("is-downloading");
			updatePill.classList.remove("is-error");
			updatePill.textContent = "Installing…";
			updatePill.title =
				"Extracting and verifying update...";
		} else if (updateState.status === "available") {
			updatePill.style.display = "inline-block";
			updatePill.classList.remove("is-downloading");
			updatePill.classList.remove("is-error");
			updatePill.textContent = "Download & Update";
			updatePill.title =
				`Click to download v${updateState.version}`;
		} else if (updateState.status === "ready") {
			updatePill.style.display = "inline-block";
			updatePill.classList.remove("is-downloading");
			updatePill.classList.remove("is-error");
			updatePill.textContent = "Update & Restart";
			updatePill.title =
				`Click to install v${updateState.version}`;
		} else if (updateState.status === "error") {
			updatePill.style.display = "inline-block";
			updatePill.classList.remove("is-downloading");
			updatePill.classList.add("is-error");
			updatePill.textContent = "Update failed — retry";
			updatePill.title =
				updateState.error || "Update failed";
		} else if (isDevMode) {
			updatePill.style.display = "inline-block";
			updatePill.classList.remove("is-downloading");
			updatePill.classList.remove("is-error");
			updatePill.textContent =
				updateState.status === "checking"
					? "Checking…"
					: "Check for Update";
			updatePill.title = "Click to check for updates";
		} else {
			updatePill.style.display = "none";
			updatePill.classList.remove("is-downloading");
			updatePill.classList.remove("is-error");
		}
	}

	window.shellApi.updateGetStatus().then((s) => {
		updateState = s;
		renderUpdatePill();
	}).catch(() => {});

	window.shellApi.onUpdateStatus((s) => {
		updateState = s;
		renderUpdatePill();
	});

	settingsBtn.addEventListener("click", () => {
		window.shellApi.toggleSettings();
	});

	updatePill.addEventListener("click", () => {
		if (
			updateState.status === "downloading" ||
			updateState.status === "installing"
		) return;
		if (updateState.status === "available") {
			window.shellApi.updateDownload();
		} else if (updateState.status === "ready") {
			window.shellApi.updateInstall();
		} else if (updateState.status === "error") {
			updateState = { status: "idle" };
			renderUpdatePill();
			window.shellApi.updateCheck();
		} else if (
			isDevMode &&
			(updateState.status === "idle" ||
				updateState.status === "checking")
		) {
			window.shellApi.updateCheck();
		}
	});

	// -- Loading --

	window.shellApi.onLoadingDone(() => {
		checkFirstLaunchDialog();
	});

	// -- Drag-and-drop (window-level) --

	window.addEventListener("dragenter", (e) => {
		e.preventDefault();
		dragCounter++;
		if (dragCounter === 1 && dragDropOverlay) {
			dragDropOverlay.classList.add("visible");
		}
	});

	window.addEventListener("dragover", (e) => {
		e.preventDefault();
	});

	window.addEventListener("dragleave", (e) => {
		e.preventDefault();
		dragCounter = Math.max(0, dragCounter - 1);
		if (dragCounter === 0 && dragDropOverlay) {
			dragDropOverlay.classList.remove("visible");
		}
	});

	window.addEventListener("drop", async (e) => {
		e.preventDefault();
		dragCounter = 0;
		if (dragDropOverlay) {
			dragDropOverlay.classList.remove("visible");
		}

		const rect = canvasEl.getBoundingClientRect();
		const screenX = e.clientX - rect.left;
		const screenY = e.clientY - rect.top;
		const cx =
			(screenX - viewportState.panX) / viewportState.zoom;
		const cy =
			(screenY - viewportState.panY) / viewportState.zoom;

		let paths = [];
		if (window.shellApi.getDragPaths) {
			try {
				paths = await window.shellApi.getDragPaths();
			} catch { /* noop */ }
		}
		if (paths.length === 0 && e.dataTransfer?.files) {
			for (let i = 0; i < e.dataTransfer.files.length; i++) {
				const p = e.dataTransfer.files[i].path;
				if (p) paths.push(p);
			}
		}
		if (paths.length === 0) return;

		const viewerRect = panelViewer.getBoundingClientRect();
		if (e.clientX < viewerRect.left) return;

		for (let i = 0; i < paths.length; i++) {
			const filePath = paths[i];
			const type = inferTileType(filePath);
			tileManager.createFileTile(
				type, cx + i * 30, cy + i * 30, filePath,
			);
		}
	});

	if (dragDropOverlay) {
		dragDropOverlay.addEventListener("transitionend", () => {
			if (!dragDropOverlay.classList.contains("visible")) {
				for (const h of getAllWebviews()) {
					h.webview.style.pointerEvents = "";
				}
			}
		});
	}

	// -- Initialize in-process terminal mode (before tile restore) --

	await tileManager.initInProcessTerminals();

	// -- Restore canvas state --

	const savedState = await window.shellApi.canvasLoadState();
	if (savedState) {
		const { centerX, centerY, zoom } = savedState.viewport;
		const w = canvasEl.clientWidth;
		const h = canvasEl.clientHeight;
		viewportState.zoom = zoom ?? 1;
		viewportState.panX = centerX != null
			? w / 2 - centerX * viewportState.zoom
			: 0;
		viewportState.panY = centerY != null
			? h / 2 - centerY * viewportState.zoom
			: 0;
		viewport.updateCanvas();
		tileManager.restoreCanvasState(savedState.tiles);
	}

	// Kill tmux sessions that have no corresponding terminal tile
	const activeSessionIds = [];
	for (const [id] of tileManager.getTileDOMs()) {
		const tile = getTile(id);
		if (tile?.type === "term" && tile.ptySessionId) {
			activeSessionIds.push(tile.ptySessionId);
		}
	}
	window.shellApi.ptyCleanDetached?.(activeSessionIds);

	// -- Initialize workspaces --

	const { workspaces: wsPaths, active } = workspaceData;

	for (const path of wsPaths) {
		workspaceManager.addWorkspace(path);
	}

	if (workspaceManager.getWorkspaces().length === 0) {
		workspaceManager.showEmptyState();
	} else if (
		active >= 0 &&
		active < workspaceManager.getWorkspaces().length
	) {
		workspaceManager.switchWorkspace(active);
	} else if (workspaceManager.getWorkspaces().length > 0) {
		workspaceManager.switchWorkspace(0);
	}

	panelManager.applyVisibility();
	terminalPanel.applyVisibility();
	terminalPanel.setupResize(() => {
		terminalPanel.updateTogglePosition();
	});

	// -- beforeunload save --

	window.addEventListener("beforeunload", () => {
		tileManager.saveCanvasImmediate();
	});
}

async function checkFirstLaunchDialog() {
	const offered = await window.shellApi.hasOfferedPlugin();
	if (offered) return;

	const agents = await window.shellApi.getAgents();

	const dialog =
		document.getElementById("canvas-skill-dialog");
	const agentsContainer =
		document.getElementById("canvas-skill-agents");
	const skipBtn =
		document.getElementById("canvas-skill-skip");
	const installBtn =
		document.getElementById("canvas-skill-install");
	if (
		!dialog || !agentsContainer || !skipBtn || !installBtn
	) return;

	agentsContainer.innerHTML = "";
	const checkboxes = [];

	for (const agent of agents) {
		const row = document.createElement("label");
		row.className = "canvas-skill-agent-row";

		const checkbox = document.createElement("input");
		checkbox.type = "checkbox";
		checkbox.checked = agent.detected;
		checkbox.dataset.agentId = agent.id;
		checkboxes.push(checkbox);

		const name = document.createElement("span");
		name.className = "agent-name";
		name.textContent = agent.name;

		const badge = document.createElement("span");
		badge.className = agent.detected
			? "agent-badge detected"
			: "agent-badge not-found";
		badge.textContent =
			agent.detected ? "detected" : "not found";

		row.appendChild(checkbox);
		row.appendChild(name);
		row.appendChild(badge);
		agentsContainer.appendChild(row);
	}

	dialog.classList.remove("hidden");

	function closeDialog() {
		dialog.classList.add("hidden");
		window.shellApi.markPluginOffered();
	}

	skipBtn.addEventListener(
		"click", closeDialog, { once: true },
	);

	installBtn.addEventListener("click", async () => {
		for (const cb of checkboxes) {
			if (cb.checked) {
				await window.shellApi.installSkill(
					cb.dataset.agentId,
				);
			}
		}
		closeDialog();
	}, { once: true });
}

init();
