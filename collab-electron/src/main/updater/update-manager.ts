import electronUpdater from "electron-updater";
const { autoUpdater } = electronUpdater;
import { app, BrowserWindow, ipcMain, powerMonitor } from "electron";
import { trackEvent } from "../analytics";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "error";

export interface UpdateState {
  status: UpdateStatus;
  progress?: number;
  version?: string;
  releaseNotes?: string;
  error?: string;
}

const ERROR_RESET_DELAY_MS = 30_000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const INITIAL_CHECK_DELAY_MS = 5_000;

class UpdateManager {
  private state: UpdateState = { status: "idle" };
  private initialized = false;
  private errorResetTimeout: NodeJS.Timeout | null = null;
  private checkInterval: NodeJS.Timeout | null = null;
  private onBeforeQuit: (() => Promise<void>) | null = null;

  init(opts?: { onBeforeQuit?: () => Promise<void> }): void {
    if (this.initialized) return;
    this.onBeforeQuit = opts?.onBeforeQuit ?? null;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = {
      info: (msg: string) => console.log(`[updater] ${msg}`),
      warn: (msg: string) => console.warn(`[updater] ${msg}`),
      error: (msg: string) => console.error(`[updater] ${msg}`),
      debug: (msg: string) => console.debug(`[updater] ${msg}`),
    };

    autoUpdater.on("checking-for-update", () => {
      this.setState({ status: "checking" });
    });

    autoUpdater.on("update-available", (info) => {
      let releaseNotes: string | undefined;
      if (typeof info.releaseNotes === "string") {
        releaseNotes = info.releaseNotes;
      } else if (Array.isArray(info.releaseNotes)) {
        releaseNotes = info.releaseNotes
          .map((rn: { version: string; note: string }) => `## ${rn.version}\n${rn.note}`)
          .join("\n\n");
      }
      this.setState({
        status: "available",
        version: info.version,
        releaseNotes,
      });
      trackEvent("update_available", { version: info.version });
    });

    autoUpdater.on("update-not-available", () => {
      this.setState({ status: "idle" });
    });

    autoUpdater.on("download-progress", (progress) => {
      this.setState({
        status: "downloading",
        progress: Math.round(progress.percent),
      });
    });

    autoUpdater.on("update-downloaded", (info) => {
      let releaseNotes: string | undefined;
      if (typeof info.releaseNotes === "string") {
        releaseNotes = info.releaseNotes;
      } else if (Array.isArray(info.releaseNotes)) {
        releaseNotes = info.releaseNotes
          .map((rn: { version: string; note: string }) => `## ${rn.version}\n${rn.note}`)
          .join("\n\n");
      }
      this.setState({
        status: "ready",
        version: info.version,
        releaseNotes,
      });
      trackEvent("update_downloaded", { version: info.version });
    });

    autoUpdater.on("error", (err) => {
      trackEvent("update_download_failed", { error: err.message });
      this.handleError(err.message);
    });

    if (app.isPackaged) {
      setTimeout(() => this.checkForUpdates(), INITIAL_CHECK_DELAY_MS);
      this.checkInterval = setInterval(
        () => this.checkForUpdates(),
        CHECK_INTERVAL_MS,
      );
      powerMonitor.on("resume", () => this.checkForUpdates());
    } else {
      autoUpdater.forceDevUpdateConfig = true;
    }

    this.initialized = true;
  }

  async checkForUpdates(): Promise<void> {
    const s = this.state.status;
    if (s === "checking" || s === "downloading") return;
    if (s === "available" || s === "ready") return;

    if (s === "error") this.clearErrorTimeout();

    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      this.handleError((err as Error).message);
    }
  }

  async downloadAvailableUpdate(): Promise<void> {
    if (this.state.status !== "available") return;

    try {
      await autoUpdater.downloadUpdate();
    } catch (err) {
      this.handleError((err as Error).message);
    }
  }

  async install(): Promise<void> {
    if (this.state.status !== "ready") return;

    this.setState({ status: "installing", version: this.state.version });
    trackEvent("update_installing", { version: this.state.version });

    if (!app.isPackaged) return;

    // MacUpdater.quitAndInstall() uses the native Squirrel updater,
    // which terminates the process without firing before-quit. Run
    // cleanup explicitly so PTY sessions, watchers, and servers are
    // shut down on every platform.
    if (this.onBeforeQuit) {
      await this.onBeforeQuit();
    }

    autoUpdater.quitAndInstall();
  }

  getState(): UpdateState {
    return { ...this.state };
  }

  destroy(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.clearErrorTimeout();
  }

  private handleError(message: string): void {
    this.setState({ status: "error", error: message });
    this.scheduleErrorReset();
  }

  private clearErrorTimeout(): void {
    if (this.errorResetTimeout) {
      clearTimeout(this.errorResetTimeout);
      this.errorResetTimeout = null;
    }
  }

  private scheduleErrorReset(): void {
    this.clearErrorTimeout();
    this.errorResetTimeout = setTimeout(() => {
      if (this.state.status === "error") {
        this.setState({ status: "idle", error: undefined });
      }
      this.errorResetTimeout = null;
    }, ERROR_RESET_DELAY_MS);
  }

  private setState(newState: Partial<UpdateState>): void {
    this.state = { ...this.state, ...newState };
    this.broadcast();
  }

  private broadcast(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("update:status", this.state);
      }
    }
  }
}

export const updateManager = new UpdateManager();

export function setupUpdateIPC(): void {
  ipcMain.handle("update:getStatus", () => updateManager.getState());

  ipcMain.handle("update:check", async () => {
    await updateManager.checkForUpdates();
    return updateManager.getState();
  });

  ipcMain.handle("update:download", async () => {
    await updateManager.downloadAvailableUpdate();
    return updateManager.getState();
  });

  ipcMain.on("update:install", async () => {
    await updateManager.install();
  });
}
