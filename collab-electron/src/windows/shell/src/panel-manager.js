/**
 * Generic panel factory for left/right sidebar panels.
 *
 * @param {string} side - Panel identifier ("nav", "agent")
 * @param {object} config
 * @param {HTMLElement} config.panel - The panel DOM element
 * @param {HTMLElement} config.resizeHandle - The resize drag handle
 * @param {HTMLElement} config.toggle - The toggle button
 * @param {string} config.label - Human-readable label ("Navigator", "Agent")
 * @param {number} config.defaultWidth - Default panel width in pixels
 * @param {1|-1} config.direction - Resize drag direction: 1=left panel, -1=right panel
 * @param {string[]} [config.validModes] - Ordered list of modes; first must be "closed", second is default open mode
 * @param {string} [config.defaultMode] - Initial mode when no saved pref exists (defaults to validModes[1])
 * @param {string} [config.prefKey] - Preference key for persisting the current mode
 * @param {() => Array} [config.getAllWebviews] - Returns all webviews for pointer-event blocking during resize
 * @param {(visible: boolean) => void} [config.onVisibilityChanged] - Called when visibility changes
 * @param {(mode: string) => void} [config.onModeChanged] - Called when mode changes
 */
function getPanelConstraints(side) {
	const s = getComputedStyle(document.documentElement);
	const min = parseInt(
		s.getPropertyValue(`--panel-${side}-min`).trim(), 10,
	);
	const max = parseInt(
		s.getPropertyValue(`--panel-${side}-max`).trim(), 10,
	);
	return { min, max };
}

export function createPanel(side, config) {
	const {
		panel, resizeHandle, toggle,
		label, defaultWidth, direction,
		validModes = ["closed", "files", "tiles"],
		defaultMode = validModes[1] || "closed",
		prefKey = "sidebar-mode",
		getAllWebviews = () => [],
		onVisibilityChanged = () => {},
		onModeChanged = () => {},
	} = config;

	let mode = defaultMode;
	let lastOpenMode = validModes[1] || "closed";
	let width = defaultWidth;
	const prefCache = {};

	function savePref(key, value) {
		prefCache[key] = value;
		window.shellApi.setPref(key, value);
	}

	function loadPref(key) {
		const value = prefCache[key];
		if (value == null) return null;
		return value;
	}

	function updateTogglePosition() {
		const panelsEl = document.getElementById("panels");
		const panelsRect = panelsEl.getBoundingClientRect();
		const centerY = panelsRect.top + panelsRect.height / 2;

		if (direction === 1) {
			// Left panel: toggle sits right of the panel
			if (mode !== "closed") {
				const rect = panel.getBoundingClientRect();
				toggle.style.left = `${rect.right + 8}px`;
			} else {
				toggle.style.left = `${panelsRect.left + 8}px`;
			}
			toggle.style.right = "";
		} else {
			// Right panel: toggle sits left of the panel
			if (mode !== "closed") {
				const rect = panel.getBoundingClientRect();
				toggle.style.right =
					`${panelsRect.right - rect.left + 8}px`;
			} else {
				toggle.style.right = `${8}px`;
			}
			toggle.style.left = "";
		}
		toggle.style.top = `${centerY}px`;
		toggle.style.transform = "translateY(-50%)";
	}

	function applyVisibility() {
		const visible = mode !== "closed";
		if (visible) {
			panel.style.display = "";
			resizeHandle.style.display = "";
			const stored = loadPref(`panel-width-${side}`);
			const px =
				stored != null && stored > 1 ? stored : defaultWidth;
			panel.style.flex = `0 0 ${px}px`;
		} else {
			panel.style.display = "none";
			resizeHandle.style.display = "none";
		}
		toggle.setAttribute("aria-pressed", String(visible));
		toggle.setAttribute(
			"aria-label",
			visible ? `Hide ${label} (${mode})` : `Show ${label}`,
		);
		toggle.title = visible ? `Hide ${label} (${mode})` : `Show ${label}`;
		onVisibilityChanged(visible);
		updateTogglePosition();
	}

	function setupResize(onResize = () => {}) {
		const resizeOverlay =
			document.getElementById("resize-overlay");

		resizeHandle.addEventListener("mousedown", (e) => {
			e.preventDefault();
			const startX = e.clientX;
			const startWidth =
				panel.getBoundingClientRect().width;
			let prevClamped = startWidth;

			resizeHandle.classList.add("active");
			document.body.style.cursor = "col-resize";
			document.body.style.userSelect = "none";
			if (resizeOverlay) {
				resizeOverlay.style.display = "block";
			}

			for (const h of getAllWebviews()) {
				h.webview.style.pointerEvents = "none";
			}

			function onMouseMove(e) {
				const constraints = getPanelConstraints(side);
				const delta = (e.clientX - startX) * direction;
				const unclamped = startWidth + delta;
				const clamped = Math.max(
					constraints.min,
					Math.min(constraints.max, unclamped),
				);
				const counterDelta = prevClamped - clamped;
				prevClamped = clamped;
				panel.style.flex = `0 0 ${clamped}px`;
				onResize(counterDelta);
			}

			function onMouseUp() {
				resizeHandle.classList.remove("active");
				document.removeEventListener(
					"mousemove", onMouseMove,
				);
				document.removeEventListener(
					"mouseup", onMouseUp,
				);
				document.body.style.cursor = "";
				document.body.style.userSelect = "";
				if (resizeOverlay) {
					resizeOverlay.style.display = "";
				}

				for (const h of getAllWebviews()) {
					h.webview.style.pointerEvents = "";
				}

				savePref(
					`panel-width-${side}`,
					panel.getBoundingClientRect().width,
				);
			}

			document.addEventListener("mousemove", onMouseMove);
			document.addEventListener("mouseup", onMouseUp);
		});
	}

	function initPrefs(prefWidth, prefMode) {
		if (prefWidth != null) {
			width = Number(prefWidth) || defaultWidth;
			prefCache[`panel-width-${side}`] = width;
		}
		if (prefMode != null && validModes.includes(prefMode)) {
			mode = prefMode;
		} else {
			mode = defaultMode;
		}
		applyVisibility();
	}

	return {
		applyVisibility,
		getMode() { return mode; },
		isVisible() { return mode !== "closed"; },
		toggle() {
			if (mode === "closed") {
				mode = lastOpenMode || validModes[1] || "closed";
			} else {
				lastOpenMode = mode;
				mode = "closed";
			}
			savePref(prefKey, mode);
			applyVisibility();
			onModeChanged(mode);
		},
		setMode(m) {
			mode = m;
			savePref(prefKey, m);
			applyVisibility();
			onModeChanged(mode);
		},
		setVisible(v) {
			if (v) {
				mode = lastOpenMode || validModes[1] || "closed";
			} else {
				if (mode !== "closed") lastOpenMode = mode;
				mode = "closed";
			}
			savePref(prefKey, mode);
			applyVisibility();
			onModeChanged(mode);
		},
		cycle() {
			const openModes = validModes.filter(m => m !== "closed");
			if (mode === "closed") {
				mode = openModes[0] || "closed";
			} else {
				const idx = openModes.indexOf(mode);
				if (idx >= 0 && idx < openModes.length - 1) {
					mode = openModes[idx + 1];
				} else {
					lastOpenMode = mode;
					mode = "closed";
				}
			}
			savePref(prefKey, mode);
			applyVisibility();
			onModeChanged(mode);
		},
		toggleToMode(target) {
			if (mode === target) {
				lastOpenMode = mode;
				mode = "closed";
			} else {
				mode = target;
			}
			savePref(prefKey, mode);
			applyVisibility();
			onModeChanged(mode);
		},
		updateTogglePosition,
		setupResize,
		savePref,
		loadPref,
		initPrefs,
	};
}
