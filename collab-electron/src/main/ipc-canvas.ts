import { ipcMain, type BrowserWindow } from "electron";
import * as canvasPersistence from "./canvas-persistence";

interface IpcContext {
  mainWindow: () => BrowserWindow | null;
  forwardToWebview: (
    target: string,
    channel: string,
    ...args: unknown[]
  ) => void;
}

export function registerCanvasHandlers(
  ctx: IpcContext,
): void {
  let pendingDragPaths: string[] = [];

  // Canvas persistence
  ipcMain.handle(
    "canvas:load-state",
    async () => canvasPersistence.loadState(),
  );

  ipcMain.handle(
    "canvas:save-state",
    async (_event, state) => canvasPersistence.saveState(state),
  );

  // Canvas pinch forwarding
  ipcMain.on(
    "canvas:forward-pinch",
    (_event, deltaY: number) => {
      ctx
        .mainWindow()
        ?.webContents.send("canvas:pinch", deltaY);
    },
  );

  // Cross-webview drag-and-drop
  ipcMain.on(
    "drag:set-paths",
    (_event, paths: string[]) => {
      pendingDragPaths = paths;
      ctx.forwardToWebview(
        "viewer",
        "nav-drag-active",
        true,
      );
    },
  );

  ipcMain.on("drag:clear-paths", () => {
    pendingDragPaths = [];
    ctx.forwardToWebview(
      "viewer",
      "nav-drag-active",
      false,
    );
  });

  ipcMain.handle("drag:get-paths", () => {
    const paths = pendingDragPaths;
    pendingDragPaths = [];
    return paths;
  });
}
