# Agent Sidebar: Dedicated Terminal Panel

Add a right sidebar panel containing a single persistent terminal webview, intended as the home for a chief agent (e.g. a Claude Code session). The left sidebar remains unchanged.

## Motivation

The canvas supports multiple terminal tiles, but none have a privileged, always-accessible position. A dedicated right sidebar terminal gives the user a persistent agent surface alongside the canvas — visible without scrolling or searching, toggled with a single shortcut. The existing canvas RPC and CLI skill infrastructure means any Claude Code session in this terminal can already orchestrate the canvas.

## Design decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Panel ID | `#panel-agent` with `#agent-resize` handle and `#agent-toggle` button | Describes what lives there; avoids confusion with `panel-terminal` (old tile-list sidebar) |
| Layout position | Right of `#panel-viewer`, same as the old `#panel-terminal` | Restores the pre-consolidation layout; pushes canvas, doesn't overlay |
| Panel states | Two-state: `closed`, `open` | Simple toggle, no multi-mode needed |
| Toggle shortcut | `Cmd+\` → `toggle-agent` | Most prominent shortcut goes to the primary interaction surface |
| Left sidebar shortcut | `` Cmd+` `` → `cycle-sidebar` (closed → files → tiles → closed) | Replaces two dedicated toggles with a single cycler |
| Unchanged shortcuts | `Cmd+P` (focus file search), `Cmd+K` (focus tile search), `Cmd+N` (new tile), `Cmd+W` (close tile), `Cmd+,` (settings) | These still open left sidebar to correct mode or act on canvas |
| Panel manager generalization | Pass `validModes` array and `prefKey` string as config options to `createPanel()` | Left sidebar passes `["closed", "files", "tiles"]` with prefKey `"sidebar-mode"`; agent panel passes `["closed", "open"]` with prefKey `"sidebar-mode-agent"`. Replaces hardcoded mode list and pref key |
| Removed shortcut actions | Delete `toggle-files` and `toggle-tiles` actions from renderer; remove `panelManager.toggleFiles()` and `panelManager.toggleTiles()` methods | Replaced by `cycle-sidebar` — keeping them would create dead code paths |
| Terminal type | Standard PTY session via existing node-pty sidecar | No special access or privileged IPC — same as canvas terminal tiles |
| CWD | Pinned to `~/.collaborator/` | User-level config folder; future hooks integration will inject context here |
| Webview lifecycle | Lazy init on first open, reused thereafter. Closing hides, doesn't destroy | Avoids teardown/rebuild cost on toggle |
| Not a canvas tile | Agent terminal is not in `tiles[]`, tile-list webview, or canvas state | Managed entirely as a sidebar-scoped session |
| Focus tracking | `noteSurfaceFocus("agent")` | Integrates with existing focus surface system for shortcut escaping |
| Default width | 400px | Comfortable for a terminal session |
| Resize bounds | `--panel-agent-min: 200`, `--panel-agent-max: 1000` | Consistent with existing panel constraints pattern |

## Architecture

### DOM structure

```html
#panels (flex row)
├── #panel-nav              (left sidebar, unchanged)
├── #nav-resize             (left resize handle, unchanged)
├── #panel-viewer           (canvas, flex: 1, unchanged)
├── #agent-resize           (new resize handle, class="resize-handle" data-panel="agent")
└── #panel-agent            (new right sidebar, contains terminal webview)
```

Plus `#agent-toggle` (class `panel-toggle`, right edge pill button, same style as `#nav-toggle`).

### CSS

```css
:root {
    --panel-agent-min: 200;
    --panel-agent-max: 1000;
}

#panel-agent {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
    border-left: 1px solid var(--border);
    background: rgba(var(--bg-rgb), calc(1 - (1 - var(--canvas-opacity)) / 2));
}

#panel-agent webview {
    flex: 1;
}
```

### Panel manager changes

`createPanel()` accepts two new config options — `validModes` (array of allowed mode strings) and `prefKey` (string used as the preference key for mode persistence):

```js
// Left sidebar
createPanel("nav", {
    validModes: ["closed", "files", "tiles"],
    prefKey: "sidebar-mode",
    ...
})

// Agent sidebar
createPanel("agent", {
    validModes: ["closed", "open"],
    prefKey: "sidebar-mode-agent",
    ...
})
```

- `initPrefs()` validates the stored mode against `validModes` instead of the hardcoded `["closed", "files", "tiles"]`
- `toggle()` uses `validModes[1]` as the default open mode when coming from closed
- `savePref()` calls inside mode-changing methods use `prefKey` instead of the hardcoded `"sidebar-mode"` string
- Remove `toggleFiles()` and `toggleTiles()` methods — replaced by a `cycle()` method that advances through `validModes` (wrapping from last open mode back to closed)
- All other panel manager behavior (resize, visibility, pref storage) works unchanged
- Add `cycle()` method: advances mode through `validModes` in order. If closed, goes to `validModes[1]`; if at the last mode, wraps to closed. Used by the `cycle-sidebar` shortcut action

### Focus surface integration

Add `"agent"` to the `resolveSurface()` function in the renderer, mapping it to the agent terminal webview element. This lets `focusSurface("agent")` correctly focus the terminal when the panel opens.

### Shortcut remapping

Main process `TOGGLE_SHORTCUTS` in `index.ts`:

| Key | Code | New action |
|-----|------|------------|
| `Cmd+\` | `Backslash` | `toggle-agent` |
| `` Cmd+` `` | `Backquote` | `cycle-sidebar` |

Shell renderer `handleShortcut()`:

- `toggle-agent`: calls `agentPanel.toggle()`
- `cycle-sidebar`: calls `panelManager.cycle()` — advances left sidebar through `closed → files → tiles → closed`
- Remove `toggle-files` and `toggle-tiles` action branches (replaced by `cycle-sidebar`)
- Update View menu items in `index.ts` that send `toggle-files`/`toggle-tiles` via `sendShortcut()` to use the new action names and labels

### Terminal webview lifecycle

1. On first panel open: spawn PTY session via `shellApi.ptyCreate({ cwd: "~/.collaborator/" })`
2. Create webview: `createWebview("agent-term", configs.terminal, panelAgent, handleDndMessage)`
3. Bind PTY session to webview (same wiring as canvas terminal tiles)
4. On panel close: hide webview, PTY session stays alive
5. On panel reopen: show webview, no re-creation needed
6. On app quit: save PTY session ID to prefs
7. On app launch: if `agent-pty-session` pref exists, attempt reconnect via `shellApi.ptyDiscover()`. If session gone, spawn new

### Persistence

| Preference key | Type | Purpose |
|---------------|------|---------|
| `panel-width-agent` | `number` | Panel width in pixels |
| `sidebar-mode-agent` | `string` | Panel mode: `"closed"` or `"open"` (consistent with left sidebar's string-based mode persistence) |
| `agent-pty-session` | `string` | PTY session ID for reconnection |

## Out of scope

- Claude Code hooks integration (auto-loading canvas CLI skill, injecting canvas state)
- Special IPC or privileged access for the agent terminal
- Agent-specific UI chrome (title bar, status indicators, restart button)
- Multiple agent terminals or tabbed sessions
- Auto-launching a specific command on terminal spawn
