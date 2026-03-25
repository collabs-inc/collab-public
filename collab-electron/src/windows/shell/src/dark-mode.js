/**
 * Dark mode detection and canvas opacity management.
 */

export function initDarkMode(onThemeChange) {
	const query = "(prefers-color-scheme: dark)";
	function sync() {
		document.documentElement.classList.toggle(
			"dark",
			window.matchMedia(query).matches,
		);
	}
	sync();
	window.matchMedia(query).addEventListener("change", () => {
		sync();
		onThemeChange();
	});
}

export function applyCanvasOpacity(percent) {
	const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
	document.documentElement.style.setProperty(
		"--canvas-opacity",
		String(clamped / 100),
	);
}

export function applyTileBorderColor(color) {
	if (typeof color === "string" && color.trim()) {
		document.documentElement.style.setProperty(
			"--tile-focus-border-color",
			color,
		);
	}
}

export function applyTileBorderWidth(pixels) {
	const n = Number(pixels);
	const clamped = Math.max(0, Math.min(4, Number.isNaN(n) ? 1 : n));
	document.documentElement.style.setProperty(
		"--tile-focus-border-width",
		clamped + "px",
	);
}
