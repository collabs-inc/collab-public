# Canvas Event Log

Unified, persistent event log capturing terminal OSC events, PTY lifecycle, and user canvas actions. Enables agent observability and a future log viewer UI.

## Event Schema

Every event is a single JSON line in a session-scoped JSONL file:

```jsonc
{
  "ts": 1743868800000,
  "type": "osc:cwd",
  "tileId": "abc123",
  "sessionId": "def456",
  "data": { "cwd": "/Users/yiliu/repos/collab-public" }
}
```

- `ts` — `Date.now()` at emit time
- `type` — namespaced event type (see table below)
- `tileId` — originating tile, `null` for global events
- `sessionId` — PTY session ID, `null` for non-terminal events
- `data` — type-specific payload

### Event Types

| Type | Data | Source |
|------|------|--------|
| `osc:cwd` | `{ cwd }` | OSC 7 |
| `osc:title` | `{ title }` | OSC 0/2 |
| `osc:prompt` | `{}` | OSC 133;A |
| `osc:command-start` | `{}` | OSC 133;B |
| `osc:command-end` | `{ exitCode }` | OSC 133;D |
| `pty:created` | `{ shell, cwd, target }` | session lifecycle |
| `pty:exited` | `{ exitCode }` | session lifecycle |
| `pty:foreground` | `{ process }` | status-changed |
| `tile:created` | `{ type, cwd? }` | tile-manager |
| `tile:deleted` | `{}` | tile-manager |
| `tile:resized` | `{ width, height }` | tile-interactions |
| `tile:moved` | `{ x, y }` | tile-interactions |
| `tile:focused` | `{}` | tile-interactions |
| `tile:blurred` | `{}` | tile-interactions |

Notes:
- `osc:prompt` carries no data — OSC 133;A can optionally carry params but the prompt text itself is not available.
- `osc:command-start` carries no command text — OSC 133;B only marks "user pressed Enter." Agents should infer the command from terminal capture if needed.
- `pty:exited` and `pty:foreground` carry `tileId: null`. Agents correlate to tiles via `sessionId` using the `pty:created` event which does carry `tileId`.

## Storage

- Location: `COLLAB_DIR/events/events-{timestamp}.jsonl`
- One file per app session, created on first write
- No truncation or rotation — files accumulate across sessions
- Cleanup (delete old files) is a future concern, not a launch concern

## Components

### 1. EventLog (`src/main/event-log.ts`)

Singleton module in the main process.

```typescript
interface CanvasEvent {
  ts: number;
  type: string;
  tileId: string | null;
  sessionId: string | null;
  data: Record<string, unknown>;
}

interface EventQuery {
  types?: string[];       // glob matching, e.g. ["osc:*", "pty:exited"]
  tileId?: string;
  sessionId?: string;
  since?: number;         // timestamp lower bound
  until?: number;         // timestamp upper bound
  limit?: number;         // default 100
}
```

- `append(event)` — adds `ts`, serializes to JSON, appends line to file
- `query(params)` — reads current session file, filters in memory, returns newest-first
- File handle opened lazily on first write, kept open for app lifetime
- Closed on app quit

### 2. OSC Handlers (renderer, `TerminalTab.tsx`)

Register xterm.js parser handlers alongside existing OSC 7:

- **OSC 0 / OSC 2** — window title. Parse the string, emit `osc:title`.
- **OSC 133** — shell integration marks. Data string starts with `A`, `B`, `C`, or `D` followed by optional `;params`. Parse first character:
  - `A` → emit `osc:prompt`
  - `B` → emit `osc:command-start`
  - `D` → parse exit code from params, emit `osc:command-end`
  - `C` → ignored (no useful info beyond "output starting")

OSC handlers in `TerminalTab.tsx` emit events via `sendToHost()` (webview IPC) with `sessionId` only — they do not know their `tileId`. The shell window's `ipc-message` handler on the webview (in `tile-manager.js`) enriches the event with `tileId` from its tile-to-webview mapping before forwarding to main via `shellApi.emitCanvasEvent()`.

The existing OSC 7 handler continues to update tile CWD as before AND additionally emits an `osc:cwd` event.

### 3. Shell Integration (ZDOTDIR hooks)

Extend the existing zsh integration in `~/.collaborator/shell-integration/zsh/.zshrc`.

Current hook (`__collab_osc7`) is replaced by two hooks covering OSC 7 and OSC 133:

```zsh
__collab_precmd() {
  local ec="$?"
  # Guard: only emit command-end if a command actually ran
  if [ -n "$__collab_cmd_started" ]; then
    printf "\e]133;D;%d\a" "$ec"
    unset __collab_cmd_started
  fi
  printf "\e]7;file://%s%s\a" "$HOST" "$PWD"
  printf "\e]133;A\a"
}
__collab_preexec() {
  __collab_cmd_started=1
  printf "\e]133;B\a"
}
precmd_functions+=(__collab_precmd)
preexec_functions+=(__collab_preexec)
```

**Injection fallback (bash/sh, zsh when ZDOTDIR fails):**

The injection fallback path (`osc7ShellHook()` in `pty.ts`) only emits OSC 7 — no OSC 133 marks. Shell integration marks require the ZDOTDIR integration for zsh. For bash, OSC 133 support is deferred; the injection path continues to set `PROMPT_COMMAND` for OSC 7 only.

Fish emits OSC 7 natively. Fish OSC 133 support is deferred.

### 4. IPC

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `canvas:event` | renderer → main (send) | Carry `{ type, tileId, sessionId, data }` to EventLog |
| `canvas:query-log` | renderer → main (invoke) | Query with `EventQuery`, returns `CanvasEvent[]` |

The shell preload (`src/preload/shell.ts`) exposes a new `shellApi.emitCanvasEvent(payload)` method that wraps `ipcRenderer.send("canvas:event", payload)`.

PTY lifecycle events (`pty:created`, `pty:exited`, `pty:foreground`) are emitted directly from `pty.ts` in main — no IPC round-trip needed. `pty:foreground` is emitted inside `scheduleForegroundCheck()` after the `fg === prev` dedup guard.

### 5. Tile Events (renderer, shell window)

Emitted from existing code in `tile-manager.js` and `tile-interactions.js` via `shellApi.emitCanvasEvent()`:

- `tile:created` — in tile creation flow
- `tile:deleted` — in tile deletion flow
- `tile:focused` / `tile:blurred` — in focus handling
- `tile:moved` — at end of drag (not during)
- `tile:resized` — at end of resize (not during)

## Data Flow

```
Terminal tile (webview)               Shell window (renderer)
  OSC handler fires                     tile created/focused/etc
  ↓ sendToHost(sessionId, data)         ↓
  shell window ipc-message handler      ↓
  ↓ enriches with tileId               ↓
  shellApi.emitCanvasEvent()            shellApi.emitCanvasEvent()
  ↓                                     ↓
  ──────────────── ipcMain ───────────────
                      ↓
                EventLog.append()
                      ↓
                events-{ts}.jsonl


Main process (pty.ts)
  session created/exited/foreground changed
  ↓
  EventLog.append() directly
  ↓
  events-{ts}.jsonl
```

## Query Interface

```typescript
const events = await ipcRenderer.invoke("canvas:query-log", {
  types: ["osc:command-end"],
  sessionId: "abc123",
  since: 1743868000000,
  until: 1743869000000,
  limit: 10,
});
// Returns CanvasEvent[] newest-first
```

Glob matching on `types`: `"pty:*"` matches all pty events, `"osc:command-*"` matches command-start and command-end.

## Files Changed

| File | Change |
|------|--------|
| `src/main/event-log.ts` | New — EventLog singleton |
| `src/main/index.ts` | Register `canvas:event` and `canvas:query-log` IPC handlers |
| `src/main/pty.ts` | Emit `pty:created`, `pty:exited`, `pty:foreground` events; update ZDOTDIR shell integration for OSC 133 |
| `src/preload/shell.ts` | Expose `shellApi.emitCanvasEvent()` |
| `packages/components/src/Terminal/TerminalTab.tsx` | Register OSC 0, 2, 133 handlers; emit events via webview IPC |
| `src/windows/shell/src/tile-manager.js` | Emit `tile:created`, `tile:deleted` events; enrich OSC events with `tileId` in webview `ipc-message` handler |
| `src/windows/shell/src/tile-interactions.js` | Emit `tile:focused`, `tile:blurred`, `tile:moved`, `tile:resized` events |
| Shell integration files | Replace `__collab_osc7` with `__collab_precmd` / `__collab_preexec` |
