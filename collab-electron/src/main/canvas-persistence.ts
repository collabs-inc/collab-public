import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as crypto from "node:crypto";
import { COLLAB_DIR } from "./paths";

const STATE_DIR = COLLAB_DIR;
const STATE_FILE = join(STATE_DIR, "canvas-state.json");

interface TileState {
  id: string;
  type: "term" | "note" | "code" | "image" | "graph" | "browser";
  x: number;
  y: number;
  width: number;
  height: number;
  filePath?: string;
  folderPath?: string;
  url?: string | null;
  workspacePath?: string;
  ptySessionId?: string;
  zIndex: number;
}

interface CanvasState {
  version: 1;
  tiles: TileState[];
  viewport: {
    centerX: number;
    centerY: number;
    zoom: number;
  };
}

function sanitizeCoord(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export async function loadState(): Promise<CanvasState | null> {
  try {
    const raw = await readFile(STATE_FILE, "utf-8");
    const state = JSON.parse(raw) as CanvasState;
    if (state.version !== 1) return null;
    for (const tile of state.tiles) {
      tile.x = sanitizeCoord(tile.x);
      tile.y = sanitizeCoord(tile.y);
    }
    return state;
  } catch {
    return null;
  }
}

let saving = false;
let pendingState: CanvasState | null = null;

export async function saveState(state: CanvasState): Promise<void> {
  pendingState = state; // always keep latest

  if (saving) return; // drainer will pick up pendingState

  saving = true;
  try {
    while (pendingState !== null) {
      const toSave = pendingState;
      pendingState = null; // clear before async work

      if (!existsSync(STATE_DIR)) {
        await mkdir(STATE_DIR, { recursive: true });
      }
      const tmp = join(
        tmpdir(),
        `canvas-state-${crypto.randomUUID()}.json`,
      );
      const json = JSON.stringify(toSave, null, 2);
      await writeFile(tmp, json, "utf-8");
      try {
        await rename(tmp, STATE_FILE);
      } catch {
        // rename can fail on Windows when another process holds the target.
        await writeFile(STATE_FILE, json, "utf-8");
      }
    }
  } finally {
    saving = false;
  }
}
