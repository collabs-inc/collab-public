# Agent Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right sidebar panel containing a single persistent terminal webview for running a chief agent.

**Architecture:** Restore the old right sidebar DOM structure as `#panel-agent`, generalize `createPanel()` with `validModes` and `prefKey` config, remap keyboard shortcuts (`Cmd+\` → toggle agent, `` Cmd+` `` → cycle left sidebar), and spawn a terminal webview using the existing `terminal-tile` app with CWD pinned to `~/.collaborator/`.

**Tech Stack:** Electron (main + renderer), vanilla JS (shell), React + TypeScript (terminal-tile webview), node-pty sidecar

---

### Task 1: Generalize panel-manager with `validModes` and `prefKey`

**Files:**
- Modify: `collab-electron/src/windows/shell/src/panel-manager.js`
- Modify: `collab-electron/src/windows/shell/src/renderer.js:169-190` (panel creation call)

- [ ] **Step 1: Add `validModes` and `prefKey` to `createPanel()` config**

In `panel-manager.js`, add `validModes` and `prefKey` to the destructured config (with defaults for backward compat during this task):

```js
const {
    panel, resizeHandle, toggle,
    label, defaultWidth, direction,
    validModes = ["closed", "files", "tiles"],
    prefKey = "sidebar-mode",
    getAllWebviews = () => [],
    onVisibilityChanged = () => {},
    onModeChanged = () => {},
} = config;
```

- [ ] **Step 2: Replace hardcoded mode validation in `initPrefs()`**

Change `panel-manager.js:174`:

```js
// Before:
if (prefMode != null && ["closed", "files", "tiles"].includes(prefMode)) {
    mode = prefMode;
} else {
    mode = "files";
}

// After:
if (prefMode != null && validModes.includes(prefMode)) {
    mode = prefMode;
} else {
    mode = validModes[1] || "closed";
}
```

- [ ] **Step 3: Replace all hardcoded `"sidebar-mode"` and `"files"` references**

In `panel-manager.js`:

a) Replace all occurrences of `savePref("sidebar-mode", mode)` with `savePref(prefKey, mode)`. There are 5 occurrences: in `toggle()`, `toggleFiles()`, `toggleTiles()`, `setMode()`, and `setVisible()`.

b) Replace the initial variable declarations (lines 36-37):

```js
// Before:
let mode = "files";
let lastOpenMode = "files";

// After:
let mode = validModes[1] || "closed";
let lastOpenMode = validModes[1] || "closed";
```

c) Replace the hardcoded `"files"` fallback in `toggle()` (line 188):

```js
// Before:
mode = lastOpenMode || "files";

// After:
mode = lastOpenMode || validModes[1] || "closed";
```

d) Replace the hardcoded `"files"` fallback in `setVisible()` (line 219):

```js
// Before:
mode = lastOpenMode || "files";

// After:
mode = lastOpenMode || validModes[1] || "closed";
```

- [ ] **Step 4: Add `cycle()` method**

Add a new method to the returned object in `panel-manager.js`:

```js
cycle() {
    const openModes = validModes.filter(m => m !== "closed");
    if (mode === "closed") {
        mode = openModes[0] || "closed";
    } else {
        const idx = openModes.indexOf(mode);
        if (idx >= 0 && idx < openModes.length - 1) {
            mode = openModes[idx + 1];
        } else {
            lastOpenMode = mode;
            mode = "closed";
        }
    }
    savePref(prefKey, mode);
    applyVisibility();
    onModeChanged(mode);
},
```

- [ ] **Step 5: Update left sidebar `createPanel()` call in renderer.js**

At `renderer.js:169`, pass explicit `validModes` and `prefKey`:

```js
const panelManager = createPanel("nav", {
    panel: panelNav,
    resizeHandle: navResizeHandle, toggle: navToggle,
    label: "Navigator",
    defaultWidth: 280,
    direction: 1,
    validModes: ["closed", "files", "tiles"],
    prefKey: "sidebar-mode",
    getAllWebviews,
    onVisibilityChanged(visible) { ... },
    onModeChanged(mode) { ... },
});
```

- [ ] **Step 6: Verify the left sidebar still works**

Run the app (`bun run dev` or equivalent). Toggle the left sidebar with `` Cmd+` `` (still wired to `toggle-tiles` at this point). Confirm files/tiles switching and persistence work as before.

- [ ] **Step 7: Commit**

```bash
git add collab-electron/src/windows/shell/src/panel-manager.js collab-electron/src/windows/shell/src/renderer.js
git commit -m "refactor(panel-manager): generalize with validModes and prefKey config"
```

---

### Task 2: Add agent panel DOM and CSS

**Files:**
- Modify: `collab-electron/src/windows/shell/index.html`
- Modify: `collab-electron/src/windows/shell/src/shell.css`

- [ ] **Step 1: Add DOM elements to `index.html`**

After the `#panel-viewer` div and before the closing `</div>` of `#panels`, add:

```html
<div id="agent-resize" class="resize-handle" data-panel="agent"></div>
<div id="panel-agent"></div>
```

Also add the toggle button after `#nav-toggle`:

```html
<button type="button" id="agent-toggle" class="panel-toggle" aria-pressed="false" aria-label="Show Agent"
    title="Show Agent"></button>
```

- [ ] **Step 2: Add CSS variables and panel styles to `shell.css`**

Add to the `:root` block (after `--panel-nav-max`):

```css
--panel-agent-min: 200;
--panel-agent-max: 1000;
```

Add panel styles (after existing panel CSS):

```css
#panel-agent {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
    border-left: 1px solid var(--border);
    background: rgba(var(--bg-rgb), calc(1 - (1 - var(--canvas-opacity)) / 2));
}

.platform-win #panel-agent {
    background: rgba(var(--bg-rgb), calc(1 - (1 - var(--canvas-opacity)) / 2));
}

#panel-agent webview {
    flex: 1;
}
```

- [ ] **Step 3: Verify the page renders correctly**

Run the app. The agent panel CSS is `display: flex` but `initPrefs()` runs during `init()` while the loading overlay is still visible, setting it to `display: none` if the stored mode is `"closed"` (or no stored mode). The canvas and left sidebar should render unchanged.

- [ ] **Step 4: Commit**

```bash
git add collab-electron/src/windows/shell/index.html collab-electron/src/windows/shell/src/shell.css
git commit -m "feat(shell): add agent panel DOM and CSS"
```

---

### Task 3: Wire agent panel manager in renderer

**Files:**
- Modify: `collab-electron/src/windows/shell/src/renderer.js`

- [ ] **Step 1: Read agent panel prefs in `init()`**

At `renderer.js:72-81`, add `prefAgentWidth` and `prefAgentMode` to the `Promise.all`:

```js
const [
    configs, workspaceData,
    prefNavWidth, prefSidebarMode,
    prefAgentWidth, prefAgentMode,
] = await Promise.all([
    window.shellApi.getViewConfig(),
    window.shellApi.workspaceList(),
    window.shellApi.getPref("panel-width-nav"),
    window.shellApi.getPref("sidebar-mode"),
    window.shellApi.getPref("panel-width-agent"),
    window.shellApi.getPref("sidebar-mode-agent"),
]);
```

- [ ] **Step 2: Get agent DOM elements**

After the existing DOM element lookups (around `renderer.js:83-102`), add:

```js
const panelAgent = document.getElementById("panel-agent");
const agentResizeHandle = document.getElementById("agent-resize");
const agentToggle = document.getElementById("agent-toggle");
```

- [ ] **Step 3: Create agent panel manager**

After the left sidebar panel manager setup (after `renderer.js:190`), add:

```js
const agentPanel = createPanel("agent", {
    panel: panelAgent,
    resizeHandle: agentResizeHandle,
    toggle: agentToggle,
    label: "Agent",
    defaultWidth: 400,
    direction: -1,
    validModes: ["closed", "open"],
    prefKey: "sidebar-mode-agent",
    getAllWebviews,
    onVisibilityChanged(visible) {
        if (visible) {
            ensureAgentTerminal();
        }
    },
});
agentPanel.initPrefs(prefAgentWidth, prefAgentMode);
```

The `ensureAgentTerminal()` function will be implemented in Task 6. For now, add a stub:

```js
function ensureAgentTerminal() {
    // TODO: Task 6 — spawn agent terminal webview
}
```

- [ ] **Step 4: Set up agent panel resize**

After the agent panel creation, add resize setup (mirroring how the left sidebar does it, but no `onResize` callback needed since the canvas is `flex: 1`):

```js
agentPanel.setupResize();
```

- [ ] **Step 5: Verify agent panel toggles via toggle button**

Run the app. Click the `#agent-toggle` pill button on the right edge. The empty `#panel-agent` div should appear/disappear, pushing the canvas.

- [ ] **Step 6: Commit**

```bash
git add collab-electron/src/windows/shell/src/renderer.js
git commit -m "feat(shell): wire agent panel manager with prefs and resize"
```

---

### Task 4: Remap keyboard shortcuts

**Files:**
- Modify: `collab-electron/src/main/index.ts:183-203` (shortcut map)
- Modify: `collab-electron/src/main/index.ts:370-384` (View menu)
- Modify: `collab-electron/src/windows/shell/src/renderer.js:768-817` (handleShortcut)
- Modify: `collab-electron/src/windows/shell/src/panel-manager.js` (remove toggleFiles/toggleTiles)

- [ ] **Step 1: Update `TOGGLE_SHORTCUTS` in `index.ts`**

At `index.ts:183-192`, change:

```ts
// Before:
Backslash: { modifier: cmdOrCtrl, action: "toggle-files" },
Backquote: { modifier: cmdOrCtrl, action: "toggle-tiles" },

// After:
Backslash: { modifier: cmdOrCtrl, action: "toggle-agent" },
Backquote: { modifier: cmdOrCtrl, action: "cycle-sidebar" },
```

Update `TOGGLE_SHORTCUT_KEYS` accordingly:

```ts
// Before:
"\\": TOGGLE_SHORTCUTS.Backslash!,
"`": TOGGLE_SHORTCUTS.Backquote!,

// After:
"\\": TOGGLE_SHORTCUTS.Backslash!,
"`": TOGGLE_SHORTCUTS.Backquote!,
```

(These lines don't change — they reference the same objects.)

- [ ] **Step 2: Update View menu items in `index.ts`**

At `index.ts:370-384`, change:

```ts
// Before:
{
    label: "Toggle Navigator",
    accelerator: "CommandOrControl+\\",
    registerAccelerator: false,
    click: () => sendShortcut("toggle-files"),
},
{
    label: "Toggle Terminal List",
    accelerator: "CommandOrControl+`",
    registerAccelerator: false,
    click: () => sendShortcut("toggle-tiles"),
},

// After:
{
    label: "Toggle Agent",
    accelerator: "CommandOrControl+\\",
    registerAccelerator: false,
    click: () => sendShortcut("toggle-agent"),
},
{
    label: "Cycle Sidebar",
    accelerator: "CommandOrControl+`",
    registerAccelerator: false,
    click: () => sendShortcut("cycle-sidebar"),
},
```

- [ ] **Step 3: Update `handleShortcut()` in renderer.js**

At `renderer.js:775-778`, replace the `toggle-files` and `toggle-tiles` branches:

```js
// Before:
} else if (action === "toggle-files") {
    panelManager.toggleFiles();
} else if (action === "toggle-tiles") {
    panelManager.toggleTiles();
}

// After:
} else if (action === "toggle-agent") {
    agentPanel.toggle();
} else if (action === "cycle-sidebar") {
    panelManager.cycle();
}
```

- [ ] **Step 4: Remove `toggleFiles()` and `toggleTiles()` from panel-manager.js**

Delete the `toggleFiles()` and `toggleTiles()` methods from the returned object in `panel-manager.js` (lines 197-210). They are no longer called anywhere. Keep `toggle()`, `setMode()`, `setVisible()`, and the new `cycle()`.

- [ ] **Step 5: Verify shortcuts work**

Run the app. Press `Cmd+\` — agent panel should toggle open/closed. Press `` Cmd+` `` — left sidebar should cycle through closed → files → tiles → closed. Confirm `Cmd+P` and `Cmd+K` still open left sidebar to files/tiles mode respectively.

- [ ] **Step 6: Commit**

```bash
git add collab-electron/src/main/index.ts collab-electron/src/windows/shell/src/renderer.js collab-electron/src/windows/shell/src/panel-manager.js
git commit -m "feat(shortcuts): remap Cmd+\\ to agent toggle, Cmd+\` to sidebar cycle"
```

---

### Task 5: Resolve home path API for agent terminal CWD

**Files:**
- Modify: `collab-electron/src/preload/shell.ts` (if `getHomePath` doesn't exist)
- Modify: `collab-electron/src/main/index.ts` (add IPC handler if needed)

- [ ] **Step 1: Check if `getHomePath` or equivalent exists**

Search `collab-electron/src/preload/shell.ts` for `getHomePath`, `homedir`, or `os.homedir`. If it already exists, skip to Task 6.

- [ ] **Step 2: Check if `ptyCreate` handles tilde expansion**

Test by creating a canvas terminal tile with CWD `~/.collaborator`. If the shell expands `~` correctly, no new API is needed — Task 6 can pass `"~/.collaborator"` directly. Skip to Task 6.

- [ ] **Step 3: If neither works, add `getHomePath` to the shell preload**

In `shell.ts`, add to the exposed API:

```ts
getHomePath: () => ipcRenderer.sendSync("get-home-path"),
```

- [ ] **Step 4: If Step 3 was needed, add IPC handler in main process**

In `index.ts`, add:

```ts
ipcMain.on("get-home-path", (event) => {
  event.returnValue = app.getPath("home");
});
```

- [ ] **Step 5: Commit (if changes were made)**

```bash
git add collab-electron/src/preload/shell.ts collab-electron/src/main/index.ts
git commit -m "feat(preload): add getHomePath API for agent terminal CWD"
```

---

### Task 6: Spawn agent terminal webview

**Files:**
- Modify: `collab-electron/src/windows/shell/src/renderer.js`

- [ ] **Step 1: Add agent PTY session pref to init**

At `renderer.js:72-81` (already modified in Task 3), add `prefAgentPty`. Use the home path resolution from Task 5:

```js
const [
    configs, workspaceData,
    prefNavWidth, prefSidebarMode,
    prefAgentWidth, prefAgentMode,
    prefAgentPty,
] = await Promise.all([
    window.shellApi.getViewConfig(),
    window.shellApi.workspaceList(),
    window.shellApi.getPref("panel-width-nav"),
    window.shellApi.getPref("sidebar-mode"),
    window.shellApi.getPref("panel-width-agent"),
    window.shellApi.getPref("sidebar-mode-agent"),
    window.shellApi.getPref("agent-pty-session"),
]);
```

- [ ] **Step 2: Implement `ensureAgentTerminal()`**

Replace the stub from Task 3 with the real implementation. Place it near the agent panel creation code:

```js
let agentTermWebview = null;
let agentPtySessionId = prefAgentPty || null;

function ensureAgentTerminal() {
    if (agentTermWebview) return;

    const termConfig = configs.terminalTile;
    const params = new URLSearchParams();
    params.set("tileId", "agent");

    if (agentPtySessionId) {
        params.set("sessionId", agentPtySessionId);
        params.set("restored", "1");
    } else {
        const homeDir = window.shellApi.getHomePath?.() || "~";
        params.set("cwd", `${homeDir}/.collaborator`);
    }

    const qs = params.toString();
    const wv = document.createElement("webview");
    wv.setAttribute(
        "src",
        qs ? `${termConfig.src}?${qs}` : termConfig.src,
    );
    wv.setAttribute("preload", termConfig.preload);
    wv.setAttribute(
        "webpreferences", "contextIsolation=yes, sandbox=yes",
    );
    wv.style.flex = "1";
    wv.style.border = "none";

    wv.addEventListener("dom-ready", () => {
        if (agentPanel.isVisible()) {
            wv.focus();
            noteSurfaceFocus("agent");
        }
    });

    wv.addEventListener("ipc-message", (event) => {
        if (event.channel === "pty-session-id") {
            agentPtySessionId = event.args[0];
            window.shellApi.setPref(
                "agent-pty-session", agentPtySessionId,
            );
        }
    });

    wv.addEventListener("console-message", (event) => {
        window.shellApi.logFromWebview(
            "agent-term", event.level, event.message, event.sourceId,
        );
    });

    panelAgent.appendChild(wv);
    agentTermWebview = { webview: wv, send(ch, ...args) { wv.send(ch, ...args); } };
}
```

- [ ] **Step 3: Add agent webview to `getAllWebviews()`**

At `renderer.js:503-518`, add the agent terminal to the aggregator:

```js
function getAllWebviews() {
    const all = [workspaceManager.getNavWebview()];
    all.push(singletonViewer);
    all.push(tileListWebview);
    all.push(singletonWebviews.settings);
    if (agentTermWebview) all.push(agentTermWebview);
    for (const [, dom] of tileManager.getTileDOMs()) {
        if (dom.webview) {
            all.push({
                webview: dom.webview,
                send: (ch, ...args) => {
                    if (dom.webview) dom.webview.send(ch, ...args);
                },
            });
        }
    }
    return all;
}
```

- [ ] **Step 4: Add agent surface to `resolveSurface()` and `focusSurface()`**

In `resolveSurface()` (around `renderer.js:428-448`), add an agent branch:

```js
if (surface === "agent" && !agentPanel.isVisible()) {
    surface = null;
}
// ... existing checks ...
if (surface === "agent") return "agent";
```

In `focusSurface()` (around `renderer.js:450-485`), add before the `requestAnimationFrame`:

```js
if (surface === "agent" && agentTermWebview && agentPanel.isVisible()) {
    agentTermWebview.webview.focus();
    noteSurfaceFocus("agent");
    return;
}
```

- [ ] **Step 5: Add agent webview focus listener**

After creating the agent webview in `ensureAgentTerminal()`, the webview's `dom-ready` handler already focuses and calls `noteSurfaceFocus("agent")`. Also add a direct focus listener:

```js
wv.addEventListener("focus", () => {
    noteSurfaceFocus("agent");
});
```

- [ ] **Step 6: Save agent PTY session on quit**

Find the existing quit/save handler in `renderer.js` (where `canvasSaveState` is called). Add:

```js
window.shellApi.setPref("agent-pty-session", agentPtySessionId);
```

If no centralized quit handler exists, the `pty-session-id` IPC message handler (Step 2) already persists the session ID immediately on creation, which is sufficient for reconnection.

- [ ] **Step 7: Auto-open agent terminal if it was visible at last quit**

After `agentPanel.initPrefs(prefAgentWidth, prefAgentMode)`, the panel manager will show the panel if the stored mode is `"open"`. The `onVisibilityChanged` callback calls `ensureAgentTerminal()`, which handles reconnection via the stored `prefAgentPty`. No additional code needed — verify this works.

- [ ] **Step 8: Verify the agent terminal works**

Run the app. Press `Cmd+\`. A terminal should appear in the right sidebar with CWD `~/.collaborator/`. Type commands — confirm they execute. Close and reopen the panel — terminal should still be alive. Quit and relaunch — terminal should reconnect to the same PTY session.

- [ ] **Step 9: Commit**

```bash
git add collab-electron/src/windows/shell/src/renderer.js
git commit -m "feat(agent): spawn persistent terminal webview in agent sidebar"
```

---

### Task 7: Broadcast canvas opacity to agent terminal

**Files:**
- Modify: `collab-electron/src/windows/shell/src/renderer.js:305-317`

- [ ] **Step 1: Add agent webview to `broadcastCanvasOpacity`**

At `renderer.js:305-317`, update the broadcast function to include the agent terminal:

```js
broadcastCanvasOpacity = () => {
    if (lastCanvasOpacity == null) return;
    const opacity = Math.max(
        0, Math.min(
            100, Number(lastCanvasOpacity) || 0,
        ),
    ) / 100;
    workspaceManager.getNavWebview().send(
        "canvas-opacity", opacity,
    );
    tileListWebview.send("canvas-opacity", opacity);
    if (agentTermWebview) {
        agentTermWebview.send("canvas-opacity", opacity);
    }
};
```

- [ ] **Step 2: Verify opacity applies to agent panel**

Run the app with the agent panel open. Change canvas opacity in settings. The agent panel background should update.

- [ ] **Step 3: Commit**

```bash
git add collab-electron/src/windows/shell/src/renderer.js
git commit -m "feat(agent): broadcast canvas opacity to agent terminal"
```

---

### Task 8: Add agent toggle to `blurNonModalSurfaces` and `setUnderlyingShellInert`

**Files:**
- Modify: `collab-electron/src/windows/shell/src/renderer.js:487-499`

- [ ] **Step 1: Update `setUnderlyingShellInert()`**

At `renderer.js:487-491`, add the agent toggle:

```js
function setUnderlyingShellInert(inert) {
    const panelsEl = document.getElementById("panels");
    panelsEl.inert = inert;
    navToggle.inert = inert;
    agentToggle.inert = inert;
    wsAddBtn.inert = inert;
}
```

- [ ] **Step 2: Update `blurNonModalSurfaces()`**

At `renderer.js:494-499`, add agent webview blur:

```js
function blurNonModalSurfaces() {
    canvasEl.blur();
    navToggle.blur();
    agentToggle.blur();
    singletonViewer.webview.blur();
    workspaceManager.getNavWebview().webview.blur();
    if (agentTermWebview) agentTermWebview.webview.blur();
}
```

- [ ] **Step 3: Verify settings modal blocks agent panel interaction**

Run the app. Open agent panel. Open settings (`Cmd+,`). Confirm the agent panel and its toggle become inert. Close settings — confirm they're interactive again.

- [ ] **Step 4: Commit**

```bash
git add collab-electron/src/windows/shell/src/renderer.js
git commit -m "feat(agent): integrate agent panel with inert and blur handlers"
```
