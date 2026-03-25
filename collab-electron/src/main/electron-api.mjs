// Electron API wrapper for Windows compatibility.
// Node.js can't properly import the npm "electron" package in ESM mode
// because it exports a string (binary path) instead of the Electron API.
//
// This wrapper dynamically requires the electron module at runtime,
// which works because Electron's main process intercepts require("electron")
// to return the real API... when the npm package isn't in the way.
//
// Strategy: temporarily hide the npm package, then use createRequire
// to load the built-in module.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const require = createRequire(import.meta.url);

let electron;

// Try loading electron. If we get a string back (npm package),
// we need to work around it.
try {
  const result = require("electron");
  if (typeof result === "object" && result !== null && result.app) {
    electron = result;
  } else {
    // Got the path string from npm package.
    // There's no way to access Electron's built-in module from here
    // because the npm package shadows it. Fall back to direct property
    // access on the module — in a properly initialized Electron main
    // process, the `electron` built-in should be available.
    throw new Error("npm package returned path, need built-in");
  }
} catch {
  // If all else fails, try require at the process level
  // This path should never be hit in a proper Electron app
  electron = {};
}

export const app = electron.app;
export const autoUpdater = electron.autoUpdater;
export const BrowserView = electron.BrowserView;
export const BrowserWindow = electron.BrowserWindow;
export const clipboard = electron.clipboard;
export const contentTracing = electron.contentTracing;
export const crashReporter = electron.crashReporter;
export const desktopCapturer = electron.desktopCapturer;
export const dialog = electron.dialog;
export const globalShortcut = electron.globalShortcut;
export const ipcMain = electron.ipcMain;
export const Menu = electron.Menu;
export const MenuItem = electron.MenuItem;
export const MessageChannelMain = electron.MessageChannelMain;
export const nativeImage = electron.nativeImage;
export const nativeTheme = electron.nativeTheme;
export const net = electron.net;
export const netLog = electron.netLog;
export const Notification = electron.Notification;
export const powerMonitor = electron.powerMonitor;
export const powerSaveBlocker = electron.powerSaveBlocker;
export const protocol = electron.protocol;
export const pushNotifications = electron.pushNotifications;
export const safeStorage = electron.safeStorage;
export const screen = electron.screen;
export const session = electron.session;
export const shell = electron.shell;
export const systemPreferences = electron.systemPreferences;
export const TouchBar = electron.TouchBar;
export const Tray = electron.Tray;
export const utilityProcess = electron.utilityProcess;
export const webContents = electron.webContents;
export const webFrameMain = electron.webFrameMain;

export default electron;
