import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { getTheme } from "./theme";
import "@xterm/xterm/css/xterm.css";
import "./TerminalTab.css";

// Matches VS Code's TerminalDataBufferer throttle interval.
// Coalesces rapid PTY data events into a single term.write()
// call, preventing partial-render artifacts from the renderer
// processing many small sequential writes.
const DATA_BUFFER_FLUSH_MS = 5;
const IS_MAC = window.api.getPlatform() === "darwin";

interface TerminalTabProps {
	sessionId: string;
	visible: boolean;
	restored?: boolean;
	scrollbackData?: string | null;
	mode?: "tmux" | "sidecar";
}

function TerminalTab({ sessionId, visible, restored, scrollbackData, mode }: TerminalTabProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const fitRef = useRef<FitAddon | null>(null);
	const [searchVisible, setSearchVisible] = useState(false);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const searchAddonRef = useRef<SearchAddon | null>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const term = new Terminal({
			theme: getTheme(),
			fontFamily: 'Menlo, Monaco, "Courier New", monospace',
			fontSize: 12,
			fontWeight: "300",
			fontWeightBold: "500",
			cursorBlink: true,
			cursorStyle: "bar",
			cursorWidth: 2,
			scrollback: 200000,
			allowProposedApi: true,
			linkHandler: {
				activate(_event, text) {
					window.api.openExternal(text);
				},
			},
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

		const searchAddon = new SearchAddon();
		term.loadAddon(searchAddon);
		searchAddonRef.current = searchAddon;

		// Clickable URL detection
		const webLinks = new WebLinksAddon((event, uri) => {
			// Only open on Cmd+click (Mac) or Ctrl+click (other)
			if ((IS_MAC && event.metaKey) || (!IS_MAC && event.ctrlKey)) {
				window.open(uri, "_blank");
			}
		});
		term.loadAddon(webLinks);

		// Visual bell: briefly flash the terminal on bell character
		term.onBell(() => {
			container.classList.add("terminal-bell-flash");
			setTimeout(() => container.classList.remove("terminal-bell-flash"), 200);
		});

		// Delay initial fit: the webview may not have its final
		// dimensions when the page first loads. Double-rAF ensures
		// the layout pass has finished before we measure.
		requestAnimationFrame(() => {
			requestAnimationFrame(() => fit.fit());
		});

		// Auto-focus xterm when the webview already has focus (e.g.
		// tile created via Cmd+N or double-click where focusCanvasTile
		// ran before xterm mounted).
		if (document.hasFocus()) {
			term.focus();
		}

		// Keep xterm focused whenever the webview window gains focus,
		// so typing works immediately after clicking a tile title bar
		// or programmatic webview.focus() calls.
		const onWindowFocus = () => term.focus();
		window.addEventListener("focus", onWindowFocus);

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
		const copySelectionToClipboard = () => {
			const selection = term.getSelection();
			if (!selection) return false;
			void navigator.clipboard.writeText(selection).catch(() => {});
			return true;
		};

		let suppressPasteEvent = false;

		const pasteFromShortcut = () => {
			suppressPasteEvent = true;
			void pasteClipboardText();
		};

		const pasteClipboardText = async () => {
			try {
				const text = await navigator.clipboard.readText();
				if (text) {
					window.api.ptyWrite(sessionId, text);
				}
			} catch {
				// Clipboard access can fail outside a user gesture.
			}
		};

		term.attachCustomKeyEventHandler((e) => {
			if (e.key === "Enter" && e.shiftKey) {
				if (e.type === "keydown") {
					window.api.ptySendRawKeys(sessionId, "\x1b[13;2u");
				}
				return false;
			}
			const primaryModifier = IS_MAC ? e.metaKey : e.ctrlKey;
			// Search: Cmd+F to toggle search bar
			if (e.type === "keydown" && primaryModifier && e.key === "f") {
				setSearchVisible((prev) => {
					if (prev) searchAddonRef.current?.clearDecorations();
					return !prev;
				});
				return false;
			}
			if (e.type === "keydown" && primaryModifier) {
				const key = e.key.toLowerCase();
				if (key === "c" && copySelectionToClipboard()) {
					return false;
				}
				if (key === "v") {
					pasteFromShortcut();
					return false;
				}
			}
			if (e.type === "keydown" && e.shiftKey && e.key === "Insert") {
				pasteFromShortcut();
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

		let dataBuffer: Uint8Array[] = [];
		let flushTimer: number | undefined;
		let firstData = true;

		const flushData = () => {
			if (dataBuffer.length === 0) {
				flushTimer = undefined;
				return;
			}
			const chunks = dataBuffer;
			dataBuffer = [];
			flushTimer = undefined;
			if (firstData) {
				firstData = false;
				if (restored && mode !== "sidecar") {
					term.write("\x1b[2J\x1b[H");
				} else if (!restored) {
					term.reset();
				}
			}
			for (const chunk of chunks) {
				term.write(chunk);
			}
		};

		const handleData = (payload: {
			sessionId: string;
			data: Uint8Array;
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
		window.api.onPtyData(sessionId, handleData);

		term.onResize(({ cols, rows }) => {
			window.api.ptyResize(sessionId, cols, rows);
		});

		const handleCopy = (event: ClipboardEvent) => {
			const selection = term.getSelection();
			if (!selection) return;
			event.clipboardData?.setData("text/plain", selection);
			event.preventDefault();
			event.stopImmediatePropagation();
		};

		const handlePaste = (event: ClipboardEvent) => {
			if (suppressPasteEvent) {
				suppressPasteEvent = false;
				event.preventDefault();
				event.stopImmediatePropagation();
				return;
			}
			const text = event.clipboardData?.getData("text/plain");
			if (!text) return;
			window.api.ptyWrite(sessionId, text);
			event.preventDefault();
			event.stopImmediatePropagation();
		};

		container.addEventListener("copy", handleCopy, true);
		container.addEventListener("paste", handlePaste, true);

		// Drag-and-drop: insert file paths into terminal
		const handleDragOver = (e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			container.classList.add("terminal-drag-over");
		};

		const handleDragLeave = (e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			container.classList.remove("terminal-drag-over");
		};

		const handleDrop = (e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			container.classList.remove("terminal-drag-over");
			const files = e.dataTransfer?.files;
			if (files && files.length > 0) {
				const paths: string[] = [];
				for (let i = 0; i < files.length; i++) {
					// Electron File objects have a `path` property
					const filePath = (files[i] as any).path;
					if (filePath) {
						// Shell-escape the path: wrap in single quotes, escape existing single quotes
						paths.push("'" + filePath.replace(/'/g, "'\\''") + "'");
					}
				}
				if (paths.length > 0) {
					window.api.ptyWrite(sessionId, paths.join(" "));
				}
			}
		};

		container.addEventListener("dragover", handleDragOver);
		container.addEventListener("dragleave", handleDragLeave);
		container.addEventListener("drop", handleDrop);

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
		resizeObserver.observe(containerRef.current);

		const mediaQuery = window.matchMedia(
			"(prefers-color-scheme: dark)",
		);
		const onThemeChange = () => {
			term.options.theme = getTheme();
		};
		mediaQuery.addEventListener("change", onThemeChange);

		return () => {
			if (flushTimer !== undefined) {
				clearTimeout(flushTimer);
				flushData();
			}
			cancelAnimationFrame(rafId);
			window.removeEventListener("focus", onWindowFocus);
			mediaQuery.removeEventListener("change", onThemeChange);
			resizeObserver.disconnect();
			container.removeEventListener("copy", handleCopy, true);
			container.removeEventListener("paste", handlePaste, true);
			container.removeEventListener("dragover", handleDragOver);
			container.removeEventListener("dragleave", handleDragLeave);
			container.removeEventListener("drop", handleDrop);
			window.api.offPtyData(sessionId, handleData);
			offShellBlur();
			term.dispose();
			fitRef.current = null;
			searchAddonRef.current = null;
		};
	}, [sessionId]);

	useEffect(() => {
		if (visible && fitRef.current) {
			requestAnimationFrame(() => fitRef.current?.fit());
		}
	}, [visible]);

	return (
		<div style={{ display: visible ? "flex" : "none", flexDirection: "column", width: "100%", height: "100%" }}>
			{searchVisible && (
				<div className="terminal-search-bar">
					<input
						ref={searchInputRef}
						type="text"
						className="terminal-search-input"
						placeholder="Find..."
						autoFocus
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								if (e.shiftKey) {
									searchAddonRef.current?.findPrevious(e.currentTarget.value);
								} else {
									searchAddonRef.current?.findNext(e.currentTarget.value);
								}
							}
							if (e.key === "Escape") {
								e.preventDefault();
								searchAddonRef.current?.clearDecorations();
								setSearchVisible(false);
							}
						}}
						onChange={(e) => {
							searchAddonRef.current?.findNext(e.target.value);
						}}
					/>
					<button
						className="terminal-search-close"
						onClick={() => {
							searchAddonRef.current?.clearDecorations();
							setSearchVisible(false);
						}}
					>
						×
					</button>
				</div>
			)}
			<div
				ref={containerRef}
				className="terminal-tab"
				style={{ flex: 1 }}
			/>
		</div>
	);
}

export default TerminalTab;
