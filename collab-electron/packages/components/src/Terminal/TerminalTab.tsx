import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { getTheme } from "./theme";
import "@xterm/xterm/css/xterm.css";
import "./TerminalTab.css";

// Matches VS Code's TerminalDataBufferer throttle interval.
// Coalesces rapid PTY data events into a single term.write()
// call, preventing partial-render artifacts from the renderer
// processing many small sequential writes.
const DATA_BUFFER_FLUSH_MS = 5;

const DEFAULT_FONT_FAMILY = 'Menlo, Monaco, "Courier New", monospace';
const DEFAULT_FONT_SIZE = 12;

interface TerminalTabProps {
	sessionId: string;
	visible: boolean;
	restored?: boolean;
	scrollbackData?: string | null;
}

function TerminalTab({ sessionId, visible, restored, scrollbackData }: TerminalTabProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const fitRef = useRef<FitAddon | null>(null);

	useEffect(() => {
		if (!containerRef.current) return;

		let cleanup: (() => void) | null = null;
		let cancelled = false;
		const container = containerRef.current;

		Promise.all([
			window.api.getPref("terminalFontFamily").catch(() => null),
			window.api.getPref("terminalFontSize").catch(() => null),
		]).then(([rawFamily, rawSize]) => {
			if (cancelled) return;

			const fontFamily =
				typeof rawFamily === "string" && rawFamily.trim() !== ""
					? `${rawFamily.trim()}, ${DEFAULT_FONT_FAMILY}`
					: DEFAULT_FONT_FAMILY;
			const fontSize =
				typeof rawSize === "number" && rawSize >= 6 && rawSize <= 32
					? rawSize
					: DEFAULT_FONT_SIZE;

		const term = new Terminal({
			theme: getTheme(),
			fontFamily,
			fontSize,
			fontWeight: "300",
			fontWeightBold: "500",
			cursorBlink: true,
			scrollback: 200000,
			allowProposedApi: true,
		});

		const fit = new FitAddon();
		term.loadAddon(fit);
		term.open(container);
		fitRef.current = fit;

		const unicode11 = new Unicode11Addon();
		term.loadAddon(unicode11);
		term.unicode.activeVersion = "11";

		// WebGL renderer: double-buffered canvas avoids the
		// partial-paint artifacts the DOM renderer can show
		// during rapid sequential writes. Falls back to DOM
		// if the GPU context can't be acquired.
		try {
			const webgl = new WebglAddon();
			webgl.onContextLoss(() => webgl.dispose());
			term.loadAddon(webgl);
		} catch {
			// DOM renderer fallback — no action needed
		}

		// Delay initial fit: the webview may not have its final
		// dimensions when the page first loads. Double-rAF ensures
		// the layout pass has finished before we measure.
		requestAnimationFrame(() => {
			requestAnimationFrame(() => fit.fit());
		});

		if (!restored) {
			term.write(
				`\x1b[38;2;100;100;100mStarting...\x1b[0m`,
			);
		}

		if (restored && scrollbackData) {
			term.write(scrollbackData);
		}

		// Shift+Enter: inject a CSI u escape sequence directly into the
		// tmux pane (via send-keys -l) so TUI apps like Claude Code can
		// detect the shift modifier. The normal ptyWrite path goes through
		// tmux's input parser which strips modifier info in legacy mode.
		// Block both keydown AND keypress to prevent xterm from also
		// sending \r through the normal onData path.
		term.attachCustomKeyEventHandler((e) => {
			if (e.key === "Enter" && e.shiftKey) {
				if (e.type === "keydown") {
					window.api.ptySendRawKeys(sessionId, "\x1b[13;2u");
				}
				return false;
			}
			if (e.type === "keydown" && e.metaKey) {
				if (e.key === "t" || (e.key >= "1" && e.key <= "9")) {
					return false;
				}
			}
			return true;
		});

		term.onData((data: string) => {
			window.api.ptyWrite(sessionId, data);
		});

		let dataBuffer: string[] = [];
		let flushTimer: number | undefined;
		let firstData = true;

		const flushData = () => {
			const chunk = dataBuffer.join("");
			dataBuffer.length = 0;
			flushTimer = undefined;
			if (!chunk) return;
			if (firstData) {
				firstData = false;
				if (restored) {
					// Clear viewport so tmux's initial screen
					// draw has a clean surface. Scrollback from
					// capture-pane stays in xterm's buffer.
					term.write("\x1b[2J\x1b[H");
				} else {
					term.reset();
				}
			}
			term.write(chunk);
		};

		const handleData = (payload: {
			sessionId: string;
			data: string;
		}) => {
			if (payload.sessionId !== sessionId) return;
			dataBuffer.push(payload.data);
			if (flushTimer === undefined) {
				flushTimer = window.setTimeout(
					flushData,
					DATA_BUFFER_FLUSH_MS,
				);
			}
		};
		window.api.onPtyData(handleData);

		term.onResize(({ cols, rows }) => {
			window.api.ptyResize(sessionId, cols, rows);
		});

		const offShellBlur = window.api.onShellBlur(() => {
			term.blur();
			const active = document.activeElement as HTMLElement | null;
			active?.blur();
		});

		// Debounce resize via rAF to coalesce rapid events
		let rafId = 0;
		const resizeObserver = new ResizeObserver((entries) => {
			const { width, height } = entries[0].contentRect;
			if (width > 0 && height > 0) {
				cancelAnimationFrame(rafId);
				rafId = requestAnimationFrame(() => fit.fit());
			}
		});
		resizeObserver.observe(container);

		const mediaQuery = window.matchMedia(
			"(prefers-color-scheme: dark)",
		);
		const onThemeChange = () => {
			term.options.theme = getTheme();
		};
		mediaQuery.addEventListener("change", onThemeChange);

		cleanup = () => {
			if (flushTimer !== undefined) {
				clearTimeout(flushTimer);
				flushData();
			}
			cancelAnimationFrame(rafId);
			mediaQuery.removeEventListener("change", onThemeChange);
			resizeObserver.disconnect();
			window.api.offPtyData(handleData);
			offShellBlur();
			term.dispose();
			fitRef.current = null;
		};
		});

		return () => {
			cancelled = true;
			cleanup?.();
		};
	}, [sessionId]);

	useEffect(() => {
		if (visible && fitRef.current) {
			requestAnimationFrame(() => fitRef.current?.fit());
		}
	}, [visible]);

	return (
		<div
			ref={containerRef}
			className="terminal-tab"
			style={{ display: visible ? "block" : "none" }}
		/>
	);
}

export default TerminalTab;
