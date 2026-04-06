# Files & Tiles: Unified Sidebar

Consolidate the right-hand terminal list sidebar and the left-hand nav sidebar into a single left sidebar with two modes — files and tiles — switched via a segmented control or keyboard shortcuts. Remove the right sidebar entirely.

## Motivation

The current two-sidebar layout (nav on left, terminal list on right) wastes screen real estate for what are conceptually both navigator UIs. The terminal list only shows terminals, ignoring browser and graph tiles. Unifying them into one sidebar frees horizontal space for the canvas and provides a single place to navigate everything in the workspace.

## Design decisions

| Decision           | Choice                                                                                                       | Rationale                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Sidebar states     | Three-state: `closed`, `files`, `tiles`                                                                      | Two dedicated toggles; clean mental model                             |
| Toggle: files      | `Cmd+\` toggles files mode (open/close); switches to files if in tiles mode                                  | Preserves existing shortcut for nav sidebar                           |
| Toggle: tiles      | `Cmd+`` toggles tiles mode (open/close); switches to tiles if in files mode                                  | Preserves existing shortcut for terminal list                         |
| Mode switcher UI   | Segmented control `[Files] [Tiles]` in nav toolbar                                                           | Direct switching without cycling through closed state                 |
| Right sidebar      | Remove entirely (`#panel-terminal`, resize handle, toggle, webview, prefs)                                   | Full replacement, not coexistence                                     |
| Tile list scope    | All canvas tiles (terminals, browsers, graphs, future types)                                                 | Universal navigator, not terminal-specific                            |
| Tile list layout   | Flat list, no grouping                                                                                       | Group tiles (nestable folders of tiles) are a separate future feature |
| Tile entry format  | Two lines: type icon with status badge + title; indented description line                                    | Enough context to identify a tile without opening it                  |
| Tile click action  | Pan/zoom canvas to bring tile into view and select it                                                        | Navigate-to, not open-in-sidebar                                      |
| Search: files      | `Cmd+P` opens sidebar in files mode, focuses search                                                          | Familiar shortcut (VS Code convention)                                |
| Search: tiles      | `Cmd+K` opens sidebar in tiles mode, focuses search                                                          | Repurposes existing `Cmd+K` which was file search                     |
| Search bar         | Single search input, placeholder adapts to mode                                                              | One component, two contexts                                           |
| Search matching    | Substring on title + path (files) or title + description (tiles)                                             | Simple, no fuzzy matching needed yet                                  |
| Tile data flow     | Shell renderer sends tile data to tile-list webview via IPC                                                  | Same pattern as nav webview receiving file data                       |
| Live updates       | Tile list updates as tiles are created, removed, or change state                                             | Tile manager already tracks this; forward events over IPC             |
| Preference storage | `sidebar-mode`: `"closed"` / `"files"` / `"tiles"` replaces `panel-visible-nav` and `panel-visible-terminal` | Single key for the three-state                                        |
| Sidebar width      | `panel-width-nav` preference retained, shared across both modes                                              | One sidebar, one width                                                |
| Canvas flex        | `#panel-viewer` becomes `flex: 1` (was `flex: 3`)                                                            | No right panel to balance against                                     |

## Architecture

### State machine

```text
         ┌─────────┐
    ┌───→│ closed  │───→──┐
    │    └─────────┘      │
    │                     ▼
┌───┴────┐          ┌─────────┐
│ tiles  │←─────────│  files  │
└────────┘          └─────────┘
```

Transitions:

* `Cmd+\`: if closed → files. If files → closed. If tiles → files.

* `Cmd+``: if closed → tiles. If tiles → closed. If files → tiles.

* Segmented control click: switches between `files` and `tiles` (sidebar stays open)

* `Cmd+P`: jumps to `files`, opens sidebar if closed, focuses search

* `Cmd+K`: jumps to `tiles`, opens sidebar if closed, focuses search

State is persisted as `sidebar-mode` in config.

### Shell layout changes

**Current HTML structure:**

```text
#panels (flex row)
├── #panel-nav          (left sidebar)
├── #nav-resize         (resize handle)
├── #panel-viewer       (canvas)
├── #terminal-resize    (resize handle)  ← REMOVE
└── #panel-terminal     (right sidebar)  ← REMOVE
```

**New HTML structure:**

```text
#panels (flex row)
├── #panel-nav          (unified sidebar)
├── #nav-resize         (resize handle)
└── #panel-viewer       (canvas, flex: 1)
```

Also remove:

* `#terminal-toggle` button

* Terminal panel manager instance in renderer.js

* `panel-width-terminal` and `panel-visible-terminal` preferences

* `toggle-terminal-list` shortcut action (replaced by `toggle-tiles`)

### Nav toolbar changes

The workspace dropdown is removed by the unified-workspace-treeview spec (workspaces become section headers in the tree). This spec replaces the now-empty toolbar area with the segmented control.

**New:**

```text
┌──────────────────────────────────┐
│ [ Files ][ Tiles ]            ⚙  │
└──────────────────────────────────┘
```

The segmented control is rendered in the shell HTML inside `#nav-toolbar`, not inside the nav webview. It controls which webview content is displayed in `#nav-container`.

### Sidebar content switching

When switching modes:

* **Files mode:** Load/show the existing nav webview (file tree React app)

* **Tiles mode:** Load/show a new tile-list webview (new React app at `src/windows/tile-list/`)

Both webviews can be kept alive and swapped via `display: none` / `display: flex` to avoid reload cost. Only one is visible at a time.

### Tile list webview

New React app: `src/windows/tile-list/`

**Tile entry component:**

```text
┌──────────────────────────────┐
│ [icon●] tile-title           │  ← type icon with status badge, title
│         description text     │  ← indented muted description
└──────────────────────────────┘
```

**Type icons and status badges:**

* Terminal: terminal icon + green dot (running), gray dot (exited), no dot (idle)

* Browser: globe icon, no status badge

* Graph: chart icon, no status badge

* Future types: each provides its own icon and optional badge

**Description line by tile type:**

* Terminal: running command or exit status + elapsed time

* Browser: URL or page title

* Graph: type label + node count

**Interactions:**

* Click: pan/zoom canvas to tile, select it

* Hover: highlight (same `--color-hover` as file tree)

* No drag-and-drop, no context menu, no multi-select

**Data source:** Shell renderer forwards tile manager events over IPC:

* `tile-list-init`: initial tile array

* `tile-list-add`: new tile created

* `tile-list-remove`: tile removed

* `tile-list-update`: tile state changed (title, status, description)

### Keyboard shortcut changes

**Main process shortcut map changes:**

| Key     | Old action             | New action                                                     |
| ------- | ---------------------- | -------------------------------------------------------------- |
| `Cmd+\` | `toggle-nav`           | `toggle-files` (toggle files mode on/off; switch from tiles)   |
| `Cmd+`` | `toggle-terminal-list` | `toggle-tiles` (toggle tiles mode on/off; switch from files)   |
| `Cmd+P` | *(unbound)*            | `focus-file-search`                                            |
| `Cmd+K` | `focus-search`         | `focus-tile-search` (always tiles, regardless of current mode) |

**Renderer shortcut handler:**

* `toggle-files`: if closed → files. If files → closed. If tiles → files. Persist.

* `toggle-tiles`: if closed → tiles. If tiles → closed. If files → tiles. Persist.

* `focus-file-search`: set mode to `files`, open sidebar if closed, focus search input in nav webview

* `focus-tile-search`: set mode to `tiles`, open sidebar if closed, focus search input in tile-list webview

**Breaking change:** The nav webview's internal `Cmd+K` handler (in `App.tsx`) must be removed. `Cmd+K` is now always captured by the main process and routed to tile search. File search is triggered by `Cmd+P` via `focus-file-search`, which the shell renderer forwards to the nav webview.

### Panel manager changes

The existing `createPanel()` function in `panel-manager.js` manages a single panel with boolean visibility. This changes to a three-state manager:

* `mode`: `"closed"` | `"files"` | `"tiles"`

* `toggleFiles()`: closed→files, files→closed, tiles→files

* `toggleTiles()`: closed→tiles, tiles→closed, files→tiles

* `setMode(m)`: set mode directly (for segmented control and search shortcuts)

* `getMode()`: return current mode

* `initPrefs(width, mode)`: load saved state

The existing `#nav-toggle` pill button becomes a toggle for whichever mode is currently active (i.e., pressing it closes the sidebar; pressing it again reopens in the last active mode).

## Out of scope

* Group tiles / nesting in tile list (separate spec)

* Tile drag-and-drop from sidebar to canvas

* Tile context menus (create, delete, rename)

* Fuzzy search

* Tile thumbnails or rich previews

⠀