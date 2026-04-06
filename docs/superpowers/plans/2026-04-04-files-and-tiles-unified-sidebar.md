# Files & Tiles Unified Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the right-hand terminal list sidebar and left-hand nav sidebar into a single left sidebar with files/tiles toggle, removing the right sidebar entirely.

**Architecture:** The left panel (`#panel-nav`) becomes a three-state sidebar (closed/files/tiles) controlled by a panel manager with dedicated toggle shortcuts (`Cmd+\` for files, `Cmd+`` for tiles). A new `tile-list` React webview replaces the terminal-list, showing all canvas tile types. The right sidebar (`#panel-terminal`) and all its infrastructure are removed.

**Tech Stack:** Electron, vanilla JS (shell/renderer), React + TypeScript (tile-list webview), electron-vite

**Spec:** `docs/superpowers/specs/2026-04-04-files-and-tiles-unified-sidebar-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/windows/shell/src/panel-manager.js` | Three-state sidebar manager |
| Modify | `src/main/index.ts` | Shortcut action names + new `Cmd+P` binding |
| Modify | `out/renderer/shell/index.html` | Remove right sidebar elements, add segmented control |
| Modify | `src/windows/shell/src/shell.css` | Remove terminal panel styles, add segmented control styles |
| Modify | `src/windows/shell/src/renderer.js` | New shortcut handlers, webview switching, tile data forwarding |
| Create | `src/windows/tile-list/index.html` | Entry HTML for tile-list webview |
| Create | `src/windows/tile-list/src/main.tsx` | React DOM mount |
| Create | `src/windows/tile-list/src/App.tsx` | Tile list React component |
| Create | `src/windows/tile-list/src/App.css` | Tile list styles |
| Modify | `electron.vite.config.ts` | Add tile-list build entry |
| Modify | `src/main/index.ts` (view config) | Register tile-list view config |
| Modify | `src/preload/shell.ts` | Add `tileList` to `AllViewConfigs` |
| Modify | `src/preload/universal.ts` | Add `onTileListMessage` IPC listener |
| Modify | `src/windows/nav/src/App.tsx` | Remove `Cmd+K` handler, wire `Cmd+P` via IPC |

---

### Task 1: Three-State Panel Manager

**Files:**
- Modify: `collab-electron/src/windows/shell/src/panel-manager.js`

The panel manager currently uses boolean `visible` state. Change it to a three-state `mode` (`"closed"` / `"files"` / `"tiles"`) with dedicated toggle methods. The nav panel is the only consumer — the terminal panel manager will be removed in Task 5.

- [ ] **Step 1: Read the current panel manager**

Read `collab-electron/src/windows/shell/src/panel-manager.js` in full. Note the `visible` variable (boolean), `toggle()`, `setVisible()`, `isVisible()`, `initPrefs()`, `applyVisibility()`, and `savePref`/`loadPref` helpers.

- [ ] **Step 2: Add mode state and new methods**

Replace the boolean `visible` with a string `mode` and add the new API. Keep the existing visibility logic in `applyVisibility()` — it still works since `mode !== "closed"` maps to the old `visible === true`.

Add to the returned object:

```javascript
getMode() { return mode; },

toggleFiles() {
  if (mode === "files") mode = "closed";
  else mode = "files";
  savePref(`sidebar-mode`, mode);
  applyVisibility();
  onModeChanged(mode);
},

toggleTiles() {
  if (mode === "tiles") mode = "closed";
  else mode = "tiles";
  savePref(`sidebar-mode`, mode);
  applyVisibility();
  onModeChanged(mode);
},

setMode(m) {
  mode = m;
  savePref(`sidebar-mode`, m);
  applyVisibility();
  onModeChanged(mode);
},
```

Update `applyVisibility()` to use `mode !== "closed"` where it currently uses `visible`. Update the toggle button's `aria-label` to reflect the current mode.

Add `onModeChanged` to the config destructuring (default: `() => {}`).

Update `initPrefs(prefWidth, prefMode)` to accept a mode string instead of a boolean:

```javascript
initPrefs(prefWidth, prefMode) {
  if (prefWidth != null) {
    width = Number(prefWidth) || defaultWidth;
    panel.style.flex = `0 0 ${width}px`;
  }
  if (prefMode != null && ["closed", "files", "tiles"].includes(prefMode)) {
    mode = prefMode;
  } else {
    mode = "files"; // default to files if no saved pref
  }
  applyVisibility();
},
```

Keep the old `toggle()`, `setVisible()`, `isVisible()` methods working for backward compat during migration (the nav-toggle pill button uses `toggle()`). Update `toggle()` to close if open, or reopen in last non-closed mode:

```javascript
toggle() {
  if (mode === "closed") {
    mode = lastOpenMode || "files";
  } else {
    lastOpenMode = mode;
    mode = "closed";
  }
  savePref(`sidebar-mode`, mode);
  applyVisibility();
  onModeChanged(mode);
},

isVisible() { return mode !== "closed"; },
```

Add `let lastOpenMode = "files";` at the top of the closure.

- [ ] **Step 3: Verify the build still compiles**

Run: `cd collab-electron && npx electron-vite build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/windows/shell/src/panel-manager.js
git commit -m "feat: three-state panel manager (closed/files/tiles)"
```

---

### Task 2: Main Process Shortcut Changes

**Files:**
- Modify: `collab-electron/src/main/index.ts`

Update the shortcut map to use new action names and add `Cmd+P`.

- [ ] **Step 1: Update TOGGLE_SHORTCUTS object**

In `src/main/index.ts`, find the `TOGGLE_SHORTCUTS` object (~line 183). Change:

```typescript
// Old:
Backslash: { modifier: cmdOrCtrl, action: "toggle-nav" },
Backquote: { modifier: cmdOrCtrl, action: "toggle-terminal-list" },
// ...
KeyK: { modifier: cmdOrCtrl, action: "focus-search" },

// New:
Backslash: { modifier: cmdOrCtrl, action: "toggle-files" },
Backquote: { modifier: cmdOrCtrl, action: "toggle-tiles" },
KeyP: { modifier: cmdOrCtrl, action: "focus-file-search" },
KeyK: { modifier: cmdOrCtrl, action: "focus-tile-search" },
```

Also add to `TOGGLE_SHORTCUT_KEYS`:

```typescript
p: TOGGLE_SHORTCUTS.KeyP!,
```

- [ ] **Step 2: Update menu items that reference old action names**

Search for `sendShortcut("toggle-nav")` and `sendShortcut("toggle-terminal-list")` and `sendShortcut("focus-search")` in the menu definitions (~lines 330-390). Update to `"toggle-files"`, `"toggle-tiles"`, and `"focus-tile-search"` respectively. Add a menu item for `"focus-file-search"` if appropriate.

- [ ] **Step 3: Update view config to include tile-list**

Find the `shell:get-view-config` handler (~line 515). Add `tileList`:

```typescript
tileList: { src: getRendererURL("tile-list"), preload },
```

- [ ] **Step 4: Verify build**

Run: `cd collab-electron && npx electron-vite build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: update shortcuts for unified sidebar (toggle-files, toggle-tiles, Cmd+P)"
```

---

### Task 3: Shell HTML — Remove Right Sidebar, Add Segmented Control

**Files:**
- Modify: `collab-electron/out/renderer/shell/index.html`

- [ ] **Step 1: Remove right sidebar elements**

In `index.html`:
- Remove the `#terminal-toggle` button (~lines 21-22)
- Remove `#terminal-resize` div (~line 60)
- Remove `#panel-terminal` div (~line 61)

- [ ] **Step 2: Replace workspace dropdown with segmented control**

Replace the `#workspace-dropdown-row` contents inside `#nav-toolbar` (~lines 33-50) with:

```html
<div id="sidebar-mode-control">
  <button type="button" class="mode-btn active" data-mode="files">Files</button>
  <button type="button" class="mode-btn" data-mode="tiles">Tiles</button>
</div>
```

Keep the `#settings-btn` and `#update-pill` as-is.

- [ ] **Step 3: Commit**

```bash
git add out/renderer/shell/index.html
git commit -m "feat: remove right sidebar HTML, add segmented control"
```

---

### Task 4: Shell CSS — Remove Terminal Panel Styles, Add Segmented Control

**Files:**
- Modify: `collab-electron/src/windows/shell/src/shell.css`

- [ ] **Step 1: Remove terminal panel CSS rules**

Remove or comment out:
- `#panel-terminal` rule block (~lines 186-201)
- `--panel-terminal-min` and `--panel-terminal-max` CSS variables (~lines 20-21)
- `.panel-toggle-right` styles if they exist
- Any `#terminal-resize` specific styles

- [ ] **Step 2: Update `#panel-viewer` flex**

Change `#panel-viewer` from `flex: 3 1 0` to `flex: 1 1 0`.

- [ ] **Step 3: Add segmented control styles**

Add to the nav toolbar section of `shell.css`:

```css
#sidebar-mode-control {
  display: flex;
  flex: 1;
  background: color-mix(in srgb, var(--fg) 6%, transparent);
  border-radius: 6px;
  padding: 2px;
  gap: 1px;
  -webkit-app-region: no-drag;
}

.mode-btn {
  flex: 1;
  text-align: center;
  padding: 3px 0;
  border-radius: 4px;
  border: none;
  background: transparent;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 400;
  color: var(--muted);
  cursor: pointer;
  transition: background 0.1s ease, color 0.1s ease;
}

.mode-btn:hover {
  color: var(--fg);
}

.mode-btn.active {
  background: color-mix(in srgb, var(--fg) 10%, transparent);
  color: var(--fg);
  font-weight: 500;
}
```

- [ ] **Step 4: Update `#nav-toolbar` layout for segmented control**

Ensure `#nav-toolbar` uses a row layout for the segmented control and settings button:

```css
#nav-toolbar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding: 8px 10px;
  padding-top: calc(var(--toolbar-height) + 4px);
  border-bottom: 1px solid color-mix(in srgb, var(--fg) 6%, transparent);
}
```

Adjust `#settings-btn` positioning if needed to sit inline instead of absolute.

- [ ] **Step 5: Verify build**

Run: `cd collab-electron && npx electron-vite build`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/windows/shell/src/shell.css
git commit -m "feat: CSS for unified sidebar segmented control, remove terminal panel styles"
```

---

### Task 5: Create Tile List Webview

**Files:**
- Create: `collab-electron/src/windows/tile-list/index.html`
- Create: `collab-electron/src/windows/tile-list/src/main.tsx`
- Create: `collab-electron/src/windows/tile-list/src/App.tsx`
- Create: `collab-electron/src/windows/tile-list/src/App.css`
- Modify: `collab-electron/electron.vite.config.ts`
- Modify: `collab-electron/src/preload/shell.ts`
- Modify: `collab-electron/src/preload/universal.ts`

- [ ] **Step 1: Create `tile-list/index.html`**

Mirror the terminal-list pattern:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Tile List</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 2: Create `tile-list/src/main.tsx`**

```tsx
import { createRoot } from "react-dom/client";
import App from "./App";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
```

- [ ] **Step 3: Create `tile-list/src/App.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import "./App.css";

type TileType = "term" | "note" | "code" | "image" | "graph" | "browser";

interface TileEntry {
  id: string;
  type: TileType;
  title: string;
  description: string;
  status: "running" | "exited" | "idle" | null;
}

function isTileEntry(value: unknown): value is TileEntry {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.type === "string" &&
    typeof e.title === "string" &&
    typeof e.description === "string"
  );
}

const TYPE_ICONS: Record<TileType, string> = {
  term: "\u25A1",
  browser: "\uD83C\uDF10",
  graph: "\uD83D\uDCC8",
  note: "\uD83D\uDCC4",
  code: "\uD83D\uDCC4",
  image: "\uD83D\uDDBC\uFE0F",
};

function StatusBadge({ status }: { status: TileEntry["status"] }) {
  if (!status || status === "idle") return null;
  const cls = status === "running" ? "badge-running" : "badge-exited";
  return <div className={`status-badge ${cls}`} />;
}

function TileEntryRow({
  entry,
  focused,
  onClick,
}: {
  entry: TileEntry;
  focused: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={`tile-entry${focused ? " focused" : ""}`}
      onClick={onClick}
    >
      <div className="tile-icon">
        <span className="type-icon">{TYPE_ICONS[entry.type] || "\u25A1"}</span>
        <StatusBadge status={entry.status} />
      </div>
      <div className="tile-info">
        <div className="tile-title">{entry.title}</div>
        <div className="tile-desc">{entry.description}</div>
      </div>
    </div>
  );
}

function App() {
  const [entries, setEntries] = useState<TileEntry[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    const cleanup = window.api.onTileListMessage(
      (channel: string, ...args: unknown[]) => {
        if (channel === "tile-list:init") {
          const tiles = Array.isArray(args[0])
            ? args[0].filter(isTileEntry)
            : [];
          setEntries(tiles);
        } else if (channel === "tile-list:add") {
          const tile = args[0];
          if (!isTileEntry(tile)) return;
          setEntries((prev) => [
            ...prev.filter((e) => e.id !== tile.id),
            tile,
          ]);
        } else if (channel === "tile-list:remove") {
          const id = args[0] as string;
          setEntries((prev) => prev.filter((e) => e.id !== id));
        } else if (channel === "tile-list:update") {
          const tile = args[0];
          if (!isTileEntry(tile)) return;
          setEntries((prev) =>
            prev.map((e) => (e.id === tile.id ? tile : e)),
          );
        } else if (channel === "tile-list:focus") {
          setFocusedId(args[0] as string | null);
        }
      },
    );
    return cleanup;
  }, []);

  const handleClick = useCallback((id: string) => {
    setFocusedId(id);
    window.api.sendToHost("tile-list:peek-tile", id);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (entries.length === 0) return;
      e.preventDefault();
      const dir = e.key === "ArrowUp" ? -1 : 1;
      const currentIdx = entries.findIndex((e) => e.id === focusedId);
      const nextIdx =
        currentIdx < 0
          ? 0
          : (currentIdx + dir + entries.length) % entries.length;
      handleClick(entries[nextIdx].id);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [entries, focusedId, handleClick]);

  const filtered = filter
    ? entries.filter(
        (e) =>
          e.title.toLowerCase().includes(filter.toLowerCase()) ||
          e.description.toLowerCase().includes(filter.toLowerCase()),
      )
    : entries;

  return (
    <div className="tile-list">
      <div className="tile-search">
        <input
          type="text"
          className="tile-search-input"
          placeholder="Search tiles... \u2318K"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {filtered.map((entry) => (
        <TileEntryRow
          key={entry.id}
          entry={entry}
          focused={entry.id === focusedId}
          onClick={() => handleClick(entry.id)}
        />
      ))}
      {filtered.length === 0 && (
        <div className="tile-empty">
          {filter ? "No matching tiles" : "No tiles on canvas"}
        </div>
      )}
    </div>
  );
}

export default App;
```

- [ ] **Step 4: Create `tile-list/src/App.css`**

```css
:root {
  --running-color: #34d399;
  --exited-color: #888;
  --focus-bg: rgba(255, 255, 255, 0.06);
}

@media (prefers-color-scheme: light) {
  :root {
    --focus-bg: rgba(0, 0, 0, 0.04);
  }
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 12px;
  color: var(--text, #ccc);
  background: transparent;
  overflow-y: auto;
  overflow-x: hidden;
  user-select: none;
}

.tile-list {
  display: flex;
  flex-direction: column;
  padding: 4px 0;
}

.tile-search {
  padding: 6px 10px;
}

.tile-search-input {
  width: 100%;
  background: color-mix(in srgb, currentColor 6%, transparent);
  border: none;
  border-radius: 5px;
  padding: 5px 8px;
  font-size: 11px;
  color: inherit;
  outline: none;
  font-family: inherit;
}

.tile-search-input::placeholder {
  color: var(--muted, #666);
}

.tile-entry {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 10px;
  cursor: pointer;
  border-radius: 5px;
  margin: 0 6px;
  transition: background 80ms ease;
}

.tile-entry:hover {
  background: var(--focus-bg);
}

.tile-entry.focused {
  background: var(--focus-bg);
}

.tile-icon {
  position: relative;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
}

.type-icon {
  font-size: 13px;
  line-height: 1;
}

.status-badge {
  position: absolute;
  bottom: -1px;
  right: -2px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  border: 1px solid var(--bg, #141414);
}

.badge-running {
  background: var(--running-color);
}

.badge-exited {
  background: var(--exited-color);
}

.tile-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.tile-title {
  font-weight: 500;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tile-desc {
  font-size: 10px;
  color: var(--muted, #666);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 1px;
}

.tile-empty {
  padding: 12px;
  color: var(--muted, #666);
  font-size: 11px;
}
```

- [ ] **Step 5: Add tile-list to build config**

In `electron.vite.config.ts`, add to the `rollupOptions.input` object (~line 83):

```typescript
"tile-list": resolve(__dirname, "src/windows/tile-list/index.html"),
```

- [ ] **Step 6: Add `tileList` to preload types**

In `src/preload/shell.ts`, add `tileList: ViewConfig;` to the `AllViewConfigs` interface.

- [ ] **Step 7: Add `onTileListMessage` to universal preload**

In `src/preload/universal.ts`, add after the `onTerminalListMessage` block (~line 575):

```typescript
onTileListMessage: (
  cb: (channel: string, ...args: unknown[]) => void,
) => {
  const channels = [
    "tile-list:init",
    "tile-list:add",
    "tile-list:remove",
    "tile-list:update",
    "tile-list:focus",
  ];
  const handlers = channels.map((ch) => {
    const handler = (_event: unknown, ...args: unknown[]) =>
      cb(ch, ...args);
    ipcRenderer.on(ch, handler);
    return { ch, handler };
  });
  return () => {
    for (const { ch, handler } of handlers) {
      ipcRenderer.removeListener(ch, handler);
    }
  };
},
```

- [ ] **Step 8: Add `onFocusSearch` listener for tile-list**

In `src/preload/universal.ts`, ensure `onFocusSearch` is already exposed (it is — used by nav). The tile-list App.tsx should also listen for `focus-search` to focus its search input. Add this to App.tsx's `useEffect`:

```tsx
const focusCleanup = window.api.onFocusSearch(() => {
  // Focus the search input
  const input = document.querySelector<HTMLInputElement>('.tile-search-input');
  input?.focus();
});
return () => { cleanup(); focusCleanup(); };
```

- [ ] **Step 9: Verify build**

Run: `cd collab-electron && npx electron-vite build`
Expected: Build succeeds, `tile-list` appears in output.

- [ ] **Step 10: Commit**

```bash
git add src/windows/tile-list/ electron.vite.config.ts src/preload/shell.ts src/preload/universal.ts
git commit -m "feat: create tile-list webview with React app"
```

---

### Task 6: Renderer — Mode Switching, Webview Management, Shortcut Handling

**Files:**
- Modify: `collab-electron/src/windows/shell/src/renderer.js`

This is the largest task. The renderer orchestrates everything: panel state, webview creation, shortcut handling, and tile data forwarding.

- [ ] **Step 1: Remove terminal panel infrastructure**

In `renderer.js`:

a. Remove terminal panel pref loading from `init()` (~lines 82-83):
```javascript
// Remove these two lines:
window.shellApi.getPref("panel-width-terminal"),
window.shellApi.getPref("panel-visible-terminal"),
```

b. Remove `terminalListWebview` creation (~lines 177-180).

c. Remove `terminalPanel` creation (~lines 203-212).

d. Remove `terminalPanel.initPrefs(...)` call.

e. Remove `terminalPanel.setupResize(...)` if it exists.

f. Remove `terminalPanel.updateTogglePosition()` calls.

g. Remove DOM references: `const panelTerminal = document.getElementById("panel-terminal")`, `terminalResizeHandle`, `terminalToggle`.

- [ ] **Step 2: Update panel manager initialization for three-state**

Change pref loading to load `sidebar-mode` instead of `panel-visible-nav`:

```javascript
const prefSidebarMode = await window.shellApi.getPref("sidebar-mode");
```

Update `panelManager` creation to use `onModeChanged`:

```javascript
const panelManager = createPanel("nav", {
  panel: panelNav,
  resizeHandle: navResizeHandle, toggle: navToggle,
  label: "Navigator",
  defaultWidth: 280,
  direction: 1,
  getAllWebviews,
  onVisibilityChanged(visible) {
    if (visible) {
      requestAnimationFrame(() => {
        singletonViewer.send("nav-visibility", true);
      });
    } else {
      singletonViewer.send("nav-visibility", false);
    }
  },
  onModeChanged(mode) {
    updateSidebarContent(mode);
    updateSegmentedControl(mode);
  },
});
panelManager.initPrefs(prefNavWidth, prefSidebarMode);
```

- [ ] **Step 3: Create tile-list webview alongside nav webview**

After the `navWebview` creation, add:

```javascript
const tileListContainer = document.createElement("div");
tileListContainer.id = "tile-list-container";
tileListContainer.style.display = "none";
tileListContainer.style.flex = "1";
tileListContainer.style.minHeight = "0";
panelNav.appendChild(tileListContainer);

const tileListWebview = createWebview(
  "tile-list", configs.tileList, tileListContainer, handleDndMessage,
);
```

- [ ] **Step 4: Add `updateSidebarContent` function**

This function swaps which webview is visible:

```javascript
function updateSidebarContent(mode) {
  const showFiles = mode === "files";
  const showTiles = mode === "tiles";
  navContainer.style.display = showFiles ? "flex" : "none";
  tileListContainer.style.display = showTiles ? "flex" : "none";
}
// Initialize to current mode
updateSidebarContent(panelManager.getMode());
```

- [ ] **Step 5: Add `updateSegmentedControl` function**

Wire the segmented control buttons:

```javascript
const modeButtons = document.querySelectorAll(".mode-btn");

function updateSegmentedControl(mode) {
  for (const btn of modeButtons) {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  }
}

for (const btn of modeButtons) {
  btn.addEventListener("click", () => {
    const targetMode = btn.dataset.mode;
    if (targetMode === "files" || targetMode === "tiles") {
      panelManager.setMode(targetMode);
    }
  });
}

updateSegmentedControl(panelManager.getMode());
```

- [ ] **Step 6: Update `handleShortcut` for new actions**

Replace the shortcut handler:

```javascript
function handleShortcut(action) {
  if (settingsModalOpen && action !== "toggle-settings") {
    focusSurface("settings");
    return;
  }
  if (action === "toggle-settings") {
    window.shellApi.toggleSettings();
  } else if (action === "toggle-files") {
    panelManager.toggleFiles();
  } else if (action === "toggle-tiles") {
    panelManager.toggleTiles();
  } else if (action === "focus-file-search") {
    panelManager.setMode("files");
    requestAnimationFrame(() => {
      workspaceManager.getNavWebview().send("focus-search");
    });
  } else if (action === "focus-tile-search") {
    panelManager.setMode("tiles");
    requestAnimationFrame(() => {
      tileListWebview.send("focus-search");
    });
  } else if (action === "add-workspace") {
    wsAddBtn.click();
  } else if (action === "new-tile") {
    // ... existing new-tile logic unchanged
  } else if (action === "close-tile") {
    // ... existing close-tile logic unchanged
  }
}
```

Remove the old `"toggle-nav"`, `"toggle-terminal-list"`, and `"focus-search"` cases.

Also remove the `window.addEventListener("keydown", ...)` that calls `handleShortcut("focus-search")` (~line 762-766).

- [ ] **Step 7: Build tile entry data from canvas state**

Add a helper function to convert canvas tiles to tile-list entries:

```javascript
function buildTileListEntry(tile) {
  let title = tile.id;
  let description = "";
  let status = null;

  if (tile.type === "term") {
    title = tile.displayName || "Terminal";
    description = tile.cwd || "~";
    status = tile.ptySessionId ? "running" : "idle";
  } else if (tile.type === "browser") {
    title = tile.url || "Browser";
    description = "Browser";
  } else if (tile.type === "graph") {
    title = "Graph";
    description = tile.folderPath || "Graph";
  } else if (tile.type === "note") {
    title = tile.filePath
      ? tile.filePath.split("/").pop() || "Note"
      : "Note";
    description = "Note";
  } else if (tile.type === "code") {
    title = tile.filePath
      ? tile.filePath.split("/").pop() || "Code"
      : "Code";
    description = "Code";
  } else if (tile.type === "image") {
    title = tile.filePath
      ? tile.filePath.split("/").pop() || "Image"
      : "Image";
    description = "Image";
  }

  return { id: tile.id, type: tile.type, title, description, status };
}
```

- [ ] **Step 8: Forward tile events to tile-list webview**

Update the `tileManager` creation callbacks to forward to `tileListWebview`:

```javascript
onTerminalSessionCreated(tile) {
  // ... existing pty discover + syncTerminalTileMeta logic ...
  // Forward to tile-list
  tileListWebview.send("tile-list:update", buildTileListEntry(tile));
},
onTerminalTileClosed(sessionId) {
  // Find tile by sessionId, remove from tile-list
  for (const [id] of tileManager.getTileDOMs()) {
    const t = getTile(id);
    if (t?.type === "term" && t.ptySessionId === sessionId) {
      tileListWebview.send("tile-list:remove", id);
      break;
    }
  }
},
onTileFocused(tile) {
  tileListWebview.send("tile-list:focus", tile?.id || null);
},
```

Also add a general tile create/remove hook. After canvas state restore and after `createCanvasTile`, send:

```javascript
tileListWebview.send("tile-list:add", buildTileListEntry(tile));
```

On tile close:

```javascript
tileListWebview.send("tile-list:remove", tileId);
```

- [ ] **Step 9: Initialize tile-list on webview ready**

When the tile-list webview fires `dom-ready`, send the initial tile list:

```javascript
tileListWebview.webview.addEventListener("dom-ready", () => {
  const initEntries = [];
  for (const [id] of tileManager.getTileDOMs()) {
    const tile = getTile(id);
    if (tile) {
      initEntries.push(buildTileListEntry(tile));
    }
  }
  tileListWebview.send("tile-list:init", initEntries);

  const focusedId = tileManager.getFocusedTileId();
  if (focusedId) {
    tileListWebview.send("tile-list:focus", focusedId);
  }
});
```

- [ ] **Step 10: Handle tile-list peek (click-to-navigate)**

Listen for `tile-list:peek-tile` from the tile-list webview:

```javascript
tileListWebview.webview.addEventListener("ipc-message", (event) => {
  if (event.channel === "tile-list:peek-tile") {
    const tileId = event.args[0];
    const tile = getTile(tileId);
    if (tile) {
      edgeIndicators.panToTile(tile);
      tileManager.focusCanvasTile(tileId);
    }
  }
});
```

- [ ] **Step 11: Remove old terminal-list wiring**

Remove all `terminalListWebview.send(...)` calls, the `terminalListWebview.webview.addEventListener("ipc-message", ...)` block, and the `buildTerminalListEntry()` function. The `syncTerminalTileMeta()` function should stay — it updates tile DOM titles.

- [ ] **Step 12: Verify build**

Run: `cd collab-electron && npx electron-vite build`
Expected: Build succeeds.

- [ ] **Step 13: Commit**

```bash
git add src/windows/shell/src/renderer.js
git commit -m "feat: wire unified sidebar mode switching, tile data, and shortcuts"
```

---

### Task 7: Update Nav App — Remove Cmd+K, Wire Cmd+P

**Files:**
- Modify: `collab-electron/src/windows/nav/src/App.tsx`

- [ ] **Step 1: Remove the internal `Cmd+K` handler**

In `App.tsx`, find the `useEffect` with the keydown handler (~line 687). Remove the `Cmd+K` / `Ctrl+K` branch that calls `focusActiveSearch()`:

```typescript
// Remove this block:
if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
  e.preventDefault();
  focusActiveSearch();
  return;
}
```

The nav webview already listens for `focus-search` via `window.api.onFocusSearch()` (~line 257-261), which is how `Cmd+P` → `focus-file-search` → renderer sends `focus-search` to nav webview will work. No new code needed for that path.

- [ ] **Step 2: Verify build**

Run: `cd collab-electron && npx electron-vite build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/windows/nav/src/App.tsx
git commit -m "feat: remove Cmd+K handler from nav (now handled by main process)"
```

---

### Task 8: Cleanup and Integration Verification

**Files:**
- Various cleanup across modified files

- [ ] **Step 1: Remove terminal-list from build config**

In `electron.vite.config.ts`, remove the `"terminal-list"` entry from `rollupOptions.input`. The terminal-list webview is no longer used.

- [ ] **Step 2: Remove terminal-list from view config**

In `src/main/index.ts`, remove `terminalList` from the `shell:get-view-config` handler.

In `src/preload/shell.ts`, remove `terminalList` from `AllViewConfigs`.

- [ ] **Step 3: Remove `onTerminalListMessage` from preload**

In `src/preload/universal.ts`, remove the `onTerminalListMessage` function.

- [ ] **Step 4: Clean up `broadcastCanvasOpacity` reference**

In `renderer.js`, remove the `terminalListWebview.send("canvas-opacity", ...)` call from `broadcastCanvasOpacity` (~line 259).

- [ ] **Step 5: Full build verification**

Run: `cd collab-electron && npx electron-vite build`
Expected: Clean build with no warnings about missing references.

- [ ] **Step 6: Manual smoke test**

Launch the app: `cd collab-electron && npx electron-vite dev`

Verify:
1. Sidebar opens in files mode by default
2. Segmented control switches between files and tiles
3. `Cmd+\` toggles files mode
4. `Cmd+`` toggles tiles mode
5. `Cmd+P` opens files + focuses search
6. `Cmd+K` opens tiles + focuses search
7. Creating a terminal tile appears in tile list
8. Clicking a tile entry in sidebar pans canvas to it
9. No right sidebar visible
10. Sidebar width resizing works in both modes

- [ ] **Step 7: Commit cleanup**

```bash
git add electron.vite.config.ts src/main/index.ts src/preload/shell.ts src/preload/universal.ts src/windows/shell/src/renderer.js
git commit -m "chore: remove terminal-list webview, clean up dead references"
```
