import "./logger";
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
import path, { join } from "node:path";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { fromCollabFileUrl } from "@collab/shared/collab-file-url";
import {
  loadConfig,
  saveConfig,
  getPref,
  setPref,
  getTerminalBackend,
  getTerminalMode,
  getInProcessTerminals,
  getGpuRenderer,
  getUncapFrameRate,
  type WindowState,
  type TerminalTarget,
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
import { listTerminalTargets } from "./terminal-target";
import { readSessionMeta } from "./tmux";

// macOS apps launched from Finder don't inherit the user's shell
// LANG, so child processes (tmux, shells) default to ASCII.
if (!process.env.LANG || !process.env.LANG.includes("UTF-8")) {
  process.env.LANG = "en_US.UTF-8";
}

process.on("uncaughtException", (error) => {
  // node-pty on Windows queues resize commands internally and executes them
  // asynchronously in a Socket data handler.  If the pty exits between the
  // queue and the execution the resize throws — but there is no way to wrap
  // this in a try/catch from userland.  Swallow it instead of logging a
  // scary "[crash]" line for every dead terminal.
  if (error.message === "Cannot resize a pty that has already exited") {
    trackEvent("pty_resize_after_exit");
    return;
  }

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
  const fullScreenAccelerator = isMac ? "Ctrl+Cmd+F" : "F11";

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
          accelerator: fullScreenAccelerator,
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

let splashWindow: BrowserWindow | null = null;
let pendingMaximize = false;

const SPLASH_HTML = `<!doctype html><html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#f8f8f8;--fg:#202020;--muted:#71717b;--border:#cecece;--accent:#22a05a;--dot:rgba(0,0,0,0.08);--dot-hi:rgba(34,160,90,0.25)}
@media(prefers-color-scheme:dark){:root{--bg:#121212;--fg:#dcdcdc;--muted:#848484;--border:rgba(255,255,255,0.2);--accent:#48d282;--dot:rgba(255,255,255,0.07);--dot-hi:rgba(72,210,130,0.35)}}
body{width:100vw;height:100vh;overflow:hidden;background:var(--bg);display:flex;align-items:center;justify-content:center;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;-webkit-app-region:drag}
canvas{position:absolute;inset:0;width:100%;height:100%}
.center{position:relative;display:flex;flex-direction:column;align-items:center;gap:14px;animation:fu .5s ease-out both}
@keyframes fu{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
.wm{font-size:20px;font-weight:600;letter-spacing:.12em;color:var(--fg);text-transform:lowercase}
.bt{width:160px;height:3px;border-radius:2px;background:var(--border);overflow:hidden}
.bf{width:30%;height:100%;border-radius:2px;background:var(--accent);animation:bi 1.5s ease-in-out infinite}
@keyframes bi{0%{transform:translateX(-160px)}100%{transform:translateX(160px)}}
.st{color:var(--muted);font-size:11px;letter-spacing:.04em}
</style></head><body>
<canvas id="g"></canvas>
<div class="center"><div class="wm">collaborator</div><div class="bt"><div class="bf"></div></div><div class="st" id="st"></div></div>
<script>
var c=document.getElementById("g"),x=c.getContext("2d"),d=devicePixelRatio||1;
c.width=c.offsetWidth*d;c.height=c.offsetHeight*d;x.setTransform(d,0,0,d,0,0);
var S=36,dk=matchMedia("(prefers-color-scheme:dark)").matches,
dc=dk?"rgba(255,255,255,0.07)":"rgba(0,0,0,0.08)",
dh=dk?"rgba(72,210,130,0.35)":"rgba(34,160,90,0.25)",
w=c.offsetWidth,h=c.offsetHeight,cols=Math.ceil(w/S)+1,rows=Math.ceil(h/S)+1,
cx=w/2,cy=h/2,md=Math.hypot(cx,cy),t0=performance.now();
function draw(n){var t=(n-t0)/1e3;x.clearRect(0,0,w,h);
for(var r=0;r<rows;r++)for(var i=0;i<cols;i++){
var px=i*S,py=r*S,dd=Math.hypot(px-cx,py-cy)/md,a=t-dd*.5;
if(a<0)continue;var al=Math.min(a/.3,1),p=.5+.5*Math.sin(t*2-dd*4),hi=p>.92&&a>.4;
x.globalAlpha=al*(hi?1:.7);x.fillStyle=hi?dh:dc;
x.beginPath();x.arc(px,py,hi?1.8:1,0,6.283);x.fill()}
x.globalAlpha=1;requestAnimationFrame(draw)}requestAnimationFrame(draw);
var msgs=["Pondering","Ruminating","Manifesting","Percolating","Coalescing",
"Vibing","Synthesizing","Noodling","Concocting","Fermenting",
"Marinating","Simmering","Crystallizing","Conjuring","Transmuting",
"Effervescing","Calibrating","Harmonizing","Orchestrating","Materializing",
"Incubating","Galvanizing","Catalyzing","Distilling","Unfurling"],
se=document.getElementById("st"),used=[];
function pick(){if(used.length>=msgs.length)used=[];var i;do{i=Math.floor(Math.random()*msgs.length)}while(used.includes(i));
used.push(i);return msgs[i]}
var TI=60,DI=35,WAIT=1500;
function typeOut(str,cb){var i=0;se.innerHTML='<span class="cu"></span>';
var iv=setInterval(function(){i++;se.innerHTML=str.slice(0,i)+'<span class="cu"></span>';
if(i>=str.length){clearInterval(iv);cb()}},TI)}
function eraseOut(str,cb){var i=str.length;se.innerHTML=str+'<span class="cu"></span>';
var iv=setInterval(function(){i--;se.innerHTML=str.slice(0,i)+'<span class="cu"></span>';
if(i<=0){clearInterval(iv);cb()}},DI)}
function cycle(){var w=pick()+"...";typeOut(w,function(){setTimeout(function(){eraseOut(w,function(){setTimeout(cycle,200)})},WAIT)})}
cycle();
<\/script><style>.cu{display:inline-block;width:1.5px;height:1em;background:var(--muted);vertical-align:text-bottom;
margin-left:1px;animation:blink .8s step-end infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}<\/style></body></html>`;

function createSplashWindow(
  display: Electron.Display,
): BrowserWindow {
  const splashWidth = 420;
  const splashHeight = 320;
  const { x, y, width, height } = display.workArea;
  const splash = new BrowserWindow({
    width: splashWidth,
    height: splashHeight,
    x: Math.round(x + (width - splashWidth) / 2),
    y: Math.round(y + (height - splashHeight) / 2),
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#121212",
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });
  splash.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(SPLASH_HTML)}`,
  );
  return splash;
}

function closeSplash(): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  splashWindow = null;
}

function createWindow(): void {
  const saved = config.window_state;
  const useSaved =
    saved !== null &&
    (saved.isMaximized || boundsVisibleOnAnyDisplay(saved));
  const state = useSaved ? saved : DEFAULT_STATE;
  pendingMaximize = !!state.isMaximized;

  // Show splash on the display where the main window will appear.
  const targetPoint = useSaved
    ? { x: state.x + Math.round(state.width / 2), y: state.y + Math.round(state.height / 2) }
    : screen.getCursorScreenPoint();
  const targetDisplay = screen.getDisplayNearestPoint(targetPoint);
  splashWindow = createSplashWindow(targetDisplay);

  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    show: false,
    width: state.width,
    height: state.height,
    minWidth: 400,
    minHeight: 400,
    webPreferences: {
      preload: getPreloadPath("shell"),
      contextIsolation: true,
      sandbox: true,
      webviewTag: true,
    },
  };

  if (process.platform === "darwin") {
    Object.assign(windowOptions, {
      titleBarStyle: "hidden",
      vibrancy: "under-window",
      visualEffectState: "active",
      trafficLightPosition: { x: 14, y: 12 },
    } satisfies Partial<Electron.BrowserWindowConstructorOptions>);
  }

  if (process.platform === "win32") {
    Object.assign(windowOptions, {
      backgroundColor: "#00000000",
      backgroundMaterial: "mica",
    } satisfies Partial<Electron.BrowserWindowConstructorOptions>);
  }

  if (useSaved) {
    windowOptions.x = state.x;
    windowOptions.y = state.y;
  }

  mainWindow = new BrowserWindow(windowOptions);

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
  pty.registerShellWebContents(mainWindow.webContents.id);
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
  "terminal:list-targets",
  () => listTerminalTargets(),
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
  async (
    event,
    params?: {
      cwd?: string;
      cols?: number;
      rows?: number;
      tileId?: string;
      target?: TerminalTarget;
    },
  ) => {
    let cwd = params?.cwd;
    if (typeof cwd === "string" && cwd.length > 0) {
      const resolved = path.resolve(cwd);
      try {
        const s = await fs.stat(resolved);
        if (!s.isDirectory()) cwd = undefined;
      } catch {
        cwd = undefined;  // falls back to homedir in createSession
      }
    }
    return pty.createSession(
      cwd,
      event.sender.id,
      params?.cols,
      params?.rows,
      params?.target,
      params?.tileId,
    );
  },
);

ipcMain.handle(
  "pty:write",
  (event, { sessionId, data }: { sessionId: string; data: string }) => {
    pty.assertSessionId(sessionId);
    if (typeof data !== "string" || data.length > 1_048_576) return;
    if (!pty.isSessionOwner(sessionId, event.sender.id)) return;
    pty.writeToSession(sessionId, data);
  },
);

ipcMain.handle(
  "pty:send-raw-keys",
  (event, { sessionId, data }: { sessionId: string; data: string }) => {
    pty.assertSessionId(sessionId);
    if (typeof data !== "string" || data.length > 1_048_576) return;
    if (!pty.isSessionOwner(sessionId, event.sender.id)) return;
    pty.sendRawKeys(sessionId, data);
  },
);

ipcMain.handle(
  "pty:resize",
  (
    event,
    {
      sessionId,
      cols,
      rows,
    }: { sessionId: string; cols: number; rows: number },
  ) => {
    pty.assertSessionId(sessionId);
    if (!pty.isSessionOwner(sessionId, event.sender.id)) return;
    return pty.resizeSession(sessionId, cols, rows);
  },
);

ipcMain.handle(
  "pty:kill",
  (event, { sessionId }: { sessionId: string }) => {
    pty.assertSessionId(sessionId);
    if (!pty.isSessionOwner(sessionId, event.sender.id)) return;
    return pty.killSession(sessionId);
  },
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
  ) => {
    pty.assertSessionId(sessionId);
    return pty.reconnectSession(
      sessionId, cols, rows, event.sender.id,
    );
  },
);

ipcMain.handle(
  "pty:discover",
  (event) => {
    if (mainWindow && event.sender.id !== mainWindow.webContents.id) return [];
    return pty.discoverSessions();
  },
);

ipcMain.handle(
  "pty:read-meta",
  (event, sessionId: string) => {
    pty.assertSessionId(sessionId);
    if (!pty.isSessionOwner(sessionId, event.sender.id)) return null;
    return readSessionMeta(sessionId);
  },
);

ipcMain.handle(
  "pty:clean-detached",
  (event, activeSessionIds: string[]) => {
    if (mainWindow && event.sender.id !== mainWindow.webContents.id) return;
    return pty.cleanDetachedSessions(activeSessionIds);
  },
);

ipcMain.handle(
  "pty:foreground-process",
  (event, sessionId: string) => {
    pty.assertSessionId(sessionId);
    if (!pty.isSessionOwner(sessionId, event.sender.id)) return null;
    return pty.getForegroundProcess(sessionId);
  },
);

ipcMain.handle(
  "pty:capture",
  (
    event,
    { sessionId, lines }: { sessionId: string; lines?: number },
  ) => {
    pty.assertSessionId(sessionId);
    if (!pty.isSessionOwner(sessionId, event.sender.id)) return "";
    const safeLines = typeof lines === "number"
      ? Math.max(1, Math.min(lines, 10000))
      : undefined;
    return pty.captureSession(sessionId, safeLines);
  },
);

ipcMain.handle(
  "shell:get-in-process-terminals",
  () => getInProcessTerminals()
);

ipcMain.handle(
  "shell:get-gpu-renderer",
  () => getGpuRenderer()
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
  await pty.shutdownSidecarIfIdle();
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

// Conditionally unlock frame rate based on user preference.
// Must be set before app.whenReady() — takes effect on next launch.
if (getUncapFrameRate()) {
  app.commandLine.appendSwitch("disable-frame-rate-limit");
}

app.whenReady().then(async () => {
  // Set a standard Chrome user-agent on the browser tile session so sites
  // (especially Google OAuth) treat it as a real browser, not an embedded webview.
  const browserSession = session.fromPartition("persist:browser");
  const electronUA = browserSession.getUserAgent();
  browserSession.setUserAgent(
    electronUA.replace(/\s*Electron\/\S+/, ""),
  );

  protocol.handle("collab-file", (request) => {
    const filePath = fromCollabFileUrl(request.url);
    return net.fetch(pathToFileURL(filePath).toString());
  });

  shuttingDown = false;

  // Show splash as early as possible — before heavy init work.
  buildAppMenu();
  createWindow();
  registerToggleShortcuts(mainWindow!);

  // Heavy init runs while the splash is visible.
  watcher.startWorker();
  registerIpcHandlers(config);
  registerIntegrationsIpc();
  setupUpdateIPC();
  updateManager.init({
    onBeforeQuit: () => shutdownBackgroundServices(),
  });

  if (
    getTerminalMode() !== "tmux"
    && getTerminalBackend() === "sidecar"
  ) {
    pty.ensureSidecar().catch((err) => {
      console.error("Sidecar failed to start:", err);
    });
  }

  // Defer CLI installation — not needed for startup.
  setTimeout(() => installCli(), 3000);

  initMainAnalytics();
  trackEvent("app_launched");

  mainWindow!.webContents.on("did-finish-load", () => {
    if (pendingMaximize) mainWindow!.maximize();
    mainWindow!.show();
    closeSplash();
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
