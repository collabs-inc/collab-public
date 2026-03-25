import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  protocol,
  screen,
  session,
  shell,
  webContents as webContentsModule,
  type WebContents,
} from "electron";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  loadConfig,
  saveConfig,
  getPref,
  setPref,
  type WindowState,
} from "./config";
import { registerIpcHandlers, setMainWindow } from "./ipc";
import { registerCanvasRpc } from "./canvas-rpc";
import { registerIntegrationsIpc } from "./integrations";
import {
  registerMethod,
  startJsonRpcServer,
  stopJsonRpcServer,
} from "./json-rpc-server";
import * as watcher from "./watcher";
import * as gitReplay from "./git-replay";
import { DISABLE_GIT_REPLAY } from "@collab/shared/replay-types";
import * as pty from "./pty";
import { updateManager, setupUpdateIPC } from "./updater";
import {
  initMainAnalytics,
  trackEvent,
  shutdownAnalytics,
  getDeviceId,
} from "./analytics";
import { stopImageWorker } from "./image-service";
import { installCli } from "./cli-installer";

// macOS apps launched from Finder don't inherit the user's shell
// LANG, so child processes (tmux, shells) default to ASCII.
if (!process.env.LANG || !process.env.LANG.includes("UTF-8")) {
  process.env.LANG = "en_US.UTF-8";
}

process.on("uncaughtException", (error) => {
  trackEvent("app_crash", {
    type: "uncaughtException",
    message: error.message,
    stack: error.stack,
  });
  console.error("[crash] Uncaught exception:", error);
});

process.on("unhandledRejection", (reason) => {
  const error =
    reason instanceof Error ? reason : new Error(String(reason));
  trackEvent("app_crash", {
    type: "unhandledRejection",
    message: error.message,
    stack: error.stack,
  });
  console.error("[crash] Unhandled rejection:", error);
});

if (import.meta.env.DEV) {
  app.setPath("userData", join(app.getPath("userData"), "dev"));
}

let mainWindow: BrowserWindow | null = null;
let pendingFilePath: string | null = null;
let config = loadConfig();
let shuttingDown = false;

// Apply saved theme preference (light/dark/system)
const savedTheme = config.ui.theme;
if (savedTheme === "light" || savedTheme === "dark") {
  nativeTheme.themeSource = savedTheme;
} else {
  nativeTheme.themeSource = "system";
}
let globalZoomLevel = 0;

if (!app.isPackaged) {
  // Vite dev uses a relaxed renderer policy for HMR; suppress Electron's
  // repeated dev-only security banner so actionable logs stay visible.
  process.env["ELECTRON_DISABLE_SECURITY_WARNINGS"] = "true";
}

// macOS GUI apps launched from Finder get a minimal PATH from launchd.
// Resolve the user's full shell PATH so child processes (terminal, git) work.
if (app.isPackaged && process.platform === "darwin") {
  try {
    const shell = process.env["SHELL"] || "/bin/zsh";
    const output = execFileSync(
      shell,
      ["-l", "-c", 'printf "%s" "$PATH"'],
      { encoding: "utf8", timeout: 5000 },
    );
    const resolved = output.split("\n").pop()!;
    if (resolved.includes("/")) {
      process.env["PATH"] = resolved;
    }
  } catch {
    // Fall through with the default PATH if shell resolution fails.
  }
}

const DEFAULT_STATE: WindowState = {
  x: 0,
  y: 0,
  width: 1200,
  height: 800,
};

function boundsVisibleOnAnyDisplay(bounds: WindowState): boolean {
  const displays = screen.getAllDisplays();
  return displays.some((display) => {
    const { x, y, width, height } = display.workArea;
    return (
      bounds.x < x + width &&
      bounds.x + bounds.width > x &&
      bounds.y < y + height &&
      bounds.y + bounds.height > y
    );
  });
}

function saveWindowState(state: WindowState): void {
  try {
    config.window_state = state;
    saveConfig(config);
  } catch (err) {
    console.error("Failed to save window state:", err);
  }
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null;

function debouncedSaveWindowState(): void {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized() || mainWindow.isMaximized()) return;
    const { x, y, width, height } = mainWindow.getNormalBounds();
    saveWindowState({ x, y, width, height });
  }, 500);
}

function sendShortcut(action: string): void {
  mainWindow?.webContents.send("shell:shortcut", action);
}

const cmdOrCtrl = (input: Electron.Input): boolean =>
  input.meta || input.control;
const shiftCmdOrCtrl = (input: Electron.Input): boolean =>
  input.shift && (input.meta || input.control);
const ctrlOnly = (input: Electron.Input): boolean =>
  input.control && !input.meta;

interface ShortcutEntry {
  modifier: (input: Electron.Input) => boolean;
  action: string;
}

const TOGGLE_SHORTCUTS: Record<string, ShortcutEntry> = {
  Backslash: { modifier: cmdOrCtrl, action: "toggle-nav" },
  Backquote: { modifier: cmdOrCtrl, action: "toggle-terminal-list" },
  Comma: { modifier: cmdOrCtrl, action: "toggle-settings" },
  KeyO: { modifier: shiftCmdOrCtrl, action: "add-workspace" },
  KeyK: { modifier: cmdOrCtrl, action: "focus-search" },
  KeyN: { modifier: cmdOrCtrl, action: "new-tile" },
  KeyW: { modifier: cmdOrCtrl, action: "close-tile" },
};

const TOGGLE_SHORTCUT_KEYS: Record<string, ShortcutEntry> = {
  "\\": TOGGLE_SHORTCUTS.Backslash!,
  "`": TOGGLE_SHORTCUTS.Backquote!,
  ",": TOGGLE_SHORTCUTS.Comma!,
  o: TOGGLE_SHORTCUTS.KeyO!,
  k: TOGGLE_SHORTCUTS.KeyK!,
  n: TOGGLE_SHORTCUTS.KeyN!,
  w: TOGGLE_SHORTCUTS.KeyW!,
};

function normalizeShortcutKey(key: string | undefined): string | null {
  if (!key) return null;
  return key.length === 1 ? key.toLowerCase() : key;
}

function resolveToggleShortcut(
  input: Electron.Input,
): ShortcutEntry | undefined {
  const shortcut = TOGGLE_SHORTCUTS[input.code];
  if (shortcut) return shortcut;
  const normalizedKey = normalizeShortcutKey(input.key);
  return normalizedKey
    ? TOGGLE_SHORTCUT_KEYS[normalizedKey]
    : undefined;
}

function attachShortcutListener(target: WebContents): void {
  target.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;

    const toggle = resolveToggleShortcut(input);
    if (toggle && toggle.modifier(input)) {
      event.preventDefault();
      if (!input.isAutoRepeat) sendShortcut(toggle.action);
    }
  });
}

function isBrowserTileWebview(wc: WebContents): boolean {
  try {
    return wc.session === session.fromPartition("persist:browser");
  } catch {
    return false;
  }
}

function attachBrowserShortcuts(
  wc: WebContents,
  hostWindow: BrowserWindow,
): void {
  wc.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const cmd = input.meta || input.control;
    if (!cmd) {
      if (input.key === "Escape" && wc.isLoading()) {
        event.preventDefault();
        wc.stop();
      }
      return;
    }

    if (input.code === "KeyL" || input.key === "l") {
      event.preventDefault();
      hostWindow.webContents.send(
        "browser-tile:focus-url", wc.id,
      );
    } else if (input.code === "BracketLeft" || input.key === "[") {
      event.preventDefault();
      if (wc.canGoBack()) wc.goBack();
    } else if (input.code === "BracketRight" || input.key === "]") {
      event.preventDefault();
      if (wc.canGoForward()) wc.goForward();
    } else if (input.code === "KeyR" || input.key === "r") {
      event.preventDefault();
      wc.reload();
    }
  });
}

function registerToggleShortcuts(win: BrowserWindow): void {
  attachShortcutListener(win.webContents);

  win.webContents.on("did-attach-webview", (_event, wc) => {
    wc.once("did-finish-load", () => {
      attachShortcutListener(wc);
      if (isBrowserTileWebview(wc)) {
        attachBrowserShortcuts(wc, win);
      }
      if (globalZoomLevel !== 0) {
        wc.setZoomLevel(globalZoomLevel);
      }
    });
  });
}

function applyZoomToAll(level: number): void {
  globalZoomLevel = level;
  for (const wc of webContentsModule.getAllWebContents()) {
    if (!wc.isDestroyed()) wc.setZoomLevel(level);
  }
}

function buildAppMenu(): void {
  const isMac = process.platform === "darwin";

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              {
                label: "Settings\u2026",
                accelerator: "CommandOrControl+,",
                registerAccelerator: false,
                click: () => sendShortcut("toggle-settings"),
              } as Electron.MenuItemConstructorOptions,
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Tile",
          accelerator: "CommandOrControl+N",
          registerAccelerator: false,
          click: () => sendShortcut("new-tile"),
        },
        {
          label: "Close Tile",
          accelerator: "CommandOrControl+W",
          registerAccelerator: false,
          click: () => sendShortcut("close-tile"),
        },
        { type: "separator" },
        {
          label: "Open Workspace\u2026",
          accelerator: "CommandOrControl+Shift+O",
          registerAccelerator: false,
          click: () => sendShortcut("add-workspace"),
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
        { type: "separator" },
        {
          label: "Find",
          accelerator: "CommandOrControl+K",
          registerAccelerator: false,
          click: () => sendShortcut("focus-search"),
        },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Toggle Navigator",
          accelerator: "CommandOrControl+\\",
          registerAccelerator: false,
          click: () => sendShortcut("toggle-nav"),
        },
        {
          label: "Toggle Terminal List",
          accelerator: "CommandOrControl+`",
          registerAccelerator: false,
          click: () => sendShortcut("toggle-terminal-list"),
        },
        { type: "separator" },
        {
          label: "Zoom In",
          accelerator: "CommandOrControl+=",
          click: () => applyZoomToAll(globalZoomLevel + 0.25),
        },
        {
          label: "Zoom Out",
          accelerator: "CommandOrControl+-",
          click: () => applyZoomToAll(globalZoomLevel - 0.25),
        },
        {
          label: "Actual Size",
          accelerator: "CommandOrControl+0",
          click: () => applyZoomToAll(0),
        },
        { type: "separator" },
        { role: "toggleDevTools" },
        {
          label: "Toggle Full Screen",
          accelerator: "Ctrl+Cmd+F",
          click: (_, win) => win?.setFullScreen(!win.isFullScreen()),
        },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? [
              { type: "separator" as const },
              { role: "front" as const },
            ]
          : [{ role: "close" as const }]),
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function getPreloadPath(name: string): string {
  return join(__dirname, `../preload/${name}.js`);
}

function getRendererURL(name: string): string {
  if (!app.isPackaged && process.env["ELECTRON_RENDERER_URL"]) {
    return `${process.env["ELECTRON_RENDERER_URL"]}/${name}/index.html`;
  }
  return pathToFileURL(
    join(__dirname, `../renderer/${name}/index.html`),
  ).href;
}

function createWindow(): void {
  const saved = config.window_state;
  const useSaved =
    saved !== null &&
    (saved.isMaximized || boundsVisibleOnAnyDisplay(saved));
  const state = useSaved ? saved : DEFAULT_STATE;

  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: state.width,
    height: state.height,
    minWidth: 400,
    minHeight: 400,
    titleBarStyle: "hidden",
    vibrancy: "under-window",
    visualEffectState: "active",
    trafficLightPosition: { x: 14, y: 12 },
    webPreferences: {
      preload: getPreloadPath("shell"),
      contextIsolation: true,
      sandbox: true,
      webviewTag: true,
    },
  };

  if (useSaved) {
    windowOptions.x = state.x;
    windowOptions.y = state.y;
  }

  mainWindow = new BrowserWindow(windowOptions);

  if (state.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.on("move", debouncedSaveWindowState);
  mainWindow.on("resize", debouncedSaveWindowState);
  mainWindow.on("close", () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const { x, y, width, height } = mainWindow.getNormalBounds();
    saveWindowState({
      x,
      y,
      width,
      height,
      isMaximized: mainWindow.isMaximized(),
    });
  });
  mainWindow.loadURL(getRendererURL("shell"));

  setMainWindow(mainWindow);
  registerCanvasRpc(mainWindow);
}

ipcMain.handle(
  "analytics:get-device-id",
  () => getDeviceId(),
);

ipcMain.on("analytics:track-event", (_event, name, properties) => {
  trackEvent(name, properties);
});

ipcMain.handle("shell:get-view-config", () => {
  const preload = pathToFileURL(
    getPreloadPath("universal"),
  ).href;

  return {
    nav: { src: getRendererURL("nav"), preload },
    viewer: { src: getRendererURL("viewer"), preload },
    terminal: { src: getRendererURL("terminal"), preload },
    terminalTile: { src: getRendererURL("terminal-tile"), preload },
    graphTile: { src: getRendererURL("graph-tile"), preload },
    settings: { src: getRendererURL("settings"), preload },
    terminalList: { src: getRendererURL("terminal-list"), preload },
  };
});

ipcMain.handle(
  "pref:get",
  (_event, key: string) => getPref(config, key),
);

ipcMain.handle(
  "pref:set",
  (_event, key: string, value: unknown) => {
    setPref(config, key, value);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("pref:changed", key, value);
    }
  },
);

ipcMain.handle(
  "theme:set",
  (_event, mode: string) => {
    const valid = mode === "light" || mode === "dark" ? mode : "system";
    nativeTheme.themeSource = valid;
    setPref(config, "theme", valid);
  },
);

ipcMain.handle(
  "pty:create",
  (event, params?: { cwd?: string; cols?: number; rows?: number }) =>
    pty.createSession(params?.cwd, event.sender.id, params?.cols, params?.rows),
);

ipcMain.handle(
  "pty:write",
  (_event, { sessionId, data }: { sessionId: string; data: string }) =>
    pty.writeToSession(sessionId, data),
);

ipcMain.handle(
  "pty:send-raw-keys",
  (_event, { sessionId, data }: { sessionId: string; data: string }) =>
    pty.sendRawKeys(sessionId, data),
);

ipcMain.handle(
  "pty:resize",
  (
    _event,
    {
      sessionId,
      cols,
      rows,
    }: { sessionId: string; cols: number; rows: number },
  ) => pty.resizeSession(sessionId, cols, rows),
);

ipcMain.handle(
  "pty:kill",
  (_event, { sessionId }: { sessionId: string }) =>
    pty.killSession(sessionId),
);

ipcMain.handle(
  "pty:reconnect",
  (
    event,
    {
      sessionId,
      cols,
      rows,
    }: { sessionId: string; cols: number; rows: number },
  ) =>
    pty.reconnectSession(
      sessionId, cols, rows, event.sender.id,
    ),
);

ipcMain.handle(
  "pty:discover",
  () => pty.discoverSessions(),
);

ipcMain.handle(
  "pty:clean-detached",
  (_event, activeSessionIds: string[]) =>
    pty.cleanDetachedSessions(activeSessionIds),
);

ipcMain.handle(
  "pty:foreground-process",
  (_event, sessionId: string) => pty.getForegroundProcess(sessionId),
);

let settingsOpen = false;

function setSettingsOpen(open: boolean): void {
  if (!mainWindow || settingsOpen === open) return;
  settingsOpen = open;
  mainWindow.webContents.send("shell:settings", open ? "open" : "close");
}

ipcMain.on("settings:open", () => setSettingsOpen(true));

const LOG_FN_BY_LEVEL: Record<number, (...args: unknown[]) => void> = {
  0: console.debug,
  1: console.log,
  2: console.warn,
  3: console.error,
};

ipcMain.on(
  "webview:console",
  (_event, panel: string, level: number, message: string, source: string) => {
    const tag = `[webview:${panel}]`;
    const logFn = LOG_FN_BY_LEVEL[level] ?? console.log;
    logFn(`${tag} ${message}`, source ? `(${source})` : "");
  },
);

ipcMain.on("settings:close", () => setSettingsOpen(false));
ipcMain.on("settings:toggle", () => setSettingsOpen(!settingsOpen));

function sendLoadingDone(): void {
  mainWindow?.webContents.send("shell:loading-done");
}

async function shutdownBackgroundServices(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  pty.setShuttingDown(true);
  await pty.killAllAndWait();
  watcher.stopWorker();
  if (!DISABLE_GIT_REPLAY) gitReplay.stopWorker();
  stopJsonRpcServer();
  stopImageWorker();
}

app.on("open-file", (event, path) => {
  event.preventDefault();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(
      "shell:forward", "viewer", "file-selected", path,
    );
  } else {
    pendingFilePath = path;
  }
});

protocol.registerSchemesAsPrivileged([
  {
    scheme: "collab-file",
    privileges: {
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true,
    },
  },
]);

app.on("web-contents-created", (_event, contents) => {
  const isExternal = (url: string): boolean => {
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return false;
    }
    const devOrigin = process.env["ELECTRON_RENDERER_URL"];
    if (devOrigin && url.startsWith(devOrigin)) return false;
    return true;
  };

  contents.setWindowOpenHandler(({ url, disposition }) => {
    if (isBrowserTileWebview(contents)) {
      if (disposition === "foreground-tab" || disposition === "background-tab") {
        mainWindow?.webContents.send(
          "shell:forward", "canvas", "open-browser-tile", url,
          contents.id,
        );
        return { action: "deny" };
      }
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 500,
          height: 600,
          webPreferences: {
            partition: "persist:browser",
          },
        },
      };
    }
    if (isExternal(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (isExternal(url) && !isBrowserTileWebview(contents)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
});

app.whenReady().then(async () => {
  // Set a standard Chrome user-agent on the browser tile session so sites
  // (especially Google OAuth) treat it as a real browser, not an embedded webview.
  const browserSession = session.fromPartition("persist:browser");
  const electronUA = browserSession.getUserAgent();
  browserSession.setUserAgent(
    electronUA.replace(/\s*Electron\/\S+/, ""),
  );

  protocol.handle("collab-file", (request) => {
    const filePath = decodeURIComponent(
      new URL(request.url).pathname,
    );
    return net.fetch(`file://${filePath}`);
  });

  shuttingDown = false;

  const tmuxCheck = pty.verifyTmuxAvailable();
  if (!tmuxCheck.ok) {
    console.error("tmux check failed:", tmuxCheck.message);
    if (!app.isPackaged) {
      dialog.showErrorBox(
        "tmux not found",
        `${tmuxCheck.message}\n\nThe terminal will not work until tmux is installed and on your PATH.`,
      );
    }
  }

  config = loadConfig();
  installCli();
  watcher.startWorker();
  registerIpcHandlers(config);
  registerIntegrationsIpc();
  setupUpdateIPC();
  updateManager.init({
    onBeforeQuit: () => shutdownBackgroundServices(),
  });

  buildAppMenu();
  createWindow();
  registerToggleShortcuts(mainWindow!);

  initMainAnalytics();
  trackEvent("app_launched");

  mainWindow!.webContents.on("did-finish-load", () => {
    sendLoadingDone();
    if (pendingFilePath) {
      mainWindow!.webContents.send(
        "shell:forward", "viewer", "file-selected", pendingFilePath,
      );
      pendingFilePath = null;
    }
  });

  registerMethod("ping", () => ({ pong: true }), {
    description: "Health check — returns {pong: true}",
  });
  registerMethod("workspace.getConfig", () => config, {
    description: "Return the current app configuration",
  });

  try {
    await startJsonRpcServer();
  } catch (err) {
    console.error("Failed to start JSON-RPC server:", err);
  }
});

app.on("before-quit", (event) => {
  if (!shuttingDown) {
    event.preventDefault();
    shutdownBackgroundServices().then(() => app.quit());
  }
});

app.on("window-all-closed", async () => {
  await shutdownBackgroundServices();
  await shutdownAnalytics();
  app.quit();
});
