# Collaborator — Windows Port

This document describes the changes made to run Collaborator on Windows 10/11 (x64).

## Quick Start (Development)

### Prerequisites

- **Node.js** 20+ (LTS recommended)
- **npm** or **bun** (the project uses bun, but npm works too)
- **Python 3** + **Visual Studio Build Tools** (for `node-pty` native module)
  ```powershell
  npm install -g windows-build-tools
  # or install Visual Studio Build Tools manually with "Desktop development with C++" workload
  ```

### Install & Run

```powershell
cd collab-electron
npm install          # or: bun install
npm run dev          # starts Electron in dev mode with HMR
```

### Build for Windows

```powershell
# NSIS installer + portable
npm run package:win

# Portable .exe only
npm run package:win-portable
```

Output goes to `dist/`.

---

## What Changed (vs. macOS-only Original)

### 1. Terminal System (`src/main/pty.ts` + `tmux.ts`)

**Problem:** The original used `tmux` (Unix terminal multiplexer) for session persistence. tmux doesn't exist on Windows.

**Solution:** Platform-branched implementation:

| | macOS/Linux | Windows |
|---|---|---|
| Terminal backend | tmux + node-pty | node-pty (ConPTY) directly |
| Session persistence | tmux manages sessions | In-memory; metadata on disk |
| Scrollback recovery | `tmux capture-pane` | Not available (ConPTY limitation) |
| Default shell | `$SHELL` or `/bin/zsh` | PowerShell 7 → PowerShell 5 → cmd.exe |

The public API (`createSession`, `reconnectSession`, `writeToSession`, etc.) is unchanged — all branching is internal.

### 2. IPC Server (`src/main/json-rpc-server.ts`)

**Problem:** Used Unix domain socket (`~/.collaborator/ipc.sock`). Not available on Windows.

**Solution:**
- Windows: Named pipe `\\.\pipe\collaborator-ipc`
- macOS/Linux: Unix socket (unchanged)

The same JSON-RPC 2.0 protocol works over both transports.

### 3. CLI Installer (`src/main/cli-installer.ts`)

**Problem:** Installed shell script to `~/.local/bin/` with `chmod 0o755`.

**Solution:**
- Windows: installs `collab.cmd` to `%LOCALAPPDATA%\Collaborator\bin\`
- macOS/Linux: unchanged (`~/.local/bin/collab`)

### 4. Main Window (`src/main/index.ts`)

Changes:
- **Title bar:** Uses `titleBarOverlay` (Windows native) instead of `vibrancy`/`trafficLightPosition` (macOS)
- **PATH resolution:** macOS Finder PATH fix skipped on Windows
- **UTF-8:** Sets `PYTHONIOENCODING` on Windows instead of `LANG`
- **Full screen shortcut:** F11 on Windows, Ctrl+Cmd+F on macOS
- **Menu:** Settings/Quit added to File menu on Windows (no app-name menu)
- **collab-file protocol:** Handles Windows drive letter paths (`C:/...`)

### 5. File Operations (`src/main/files.ts`)

- Path separator handling uses `path.sep` instead of hardcoded `/`
- Backslashes normalized to forward slashes for gitignore filter matching

### 6. Build Config (`package.json`)

Added:
- `package:win` / `package:win-portable` scripts
- `win` target config (NSIS installer + portable)
- `nsis` options (custom install dir, shortcuts)
- Windows-specific `extraResources` (CLI script)
- Mac-specific `extraResources` (tmux, terminfo) moved into `mac` section

### 7. New Files

- `scripts/collab-cli.cmd` — Windows CLI launcher (uses named pipes via PowerShell)
- `install.ps1` — PowerShell one-liner installer
- `WINDOWS-PORT.md` — this file

---

## Critical: `ELECTRON_RUN_AS_NODE` Environment Variable

If Electron fails to start with errors like `Cannot find module 'electron'` or `process.type` is `undefined`, check if `ELECTRON_RUN_AS_NODE=1` is set in your shell environment. This variable (often set by VS Code, Claude Code, or other Electron-based tools) forces the Electron binary to run as plain Node.js, completely skipping Electron's API initialization.

The `dev` script uses `cross-env` to automatically clear this variable:
```json
"dev": "cross-env ELECTRON_RUN_AS_NODE= electron-vite dev"
```

If running Electron manually, unset it first:
```powershell
$env:ELECTRON_RUN_AS_NODE = ""
```

## Known Limitations

1. **No session persistence across app restart** — tmux sessions survive app restarts on macOS; on Windows, closing the app kills all terminal sessions. This is a ConPTY limitation.

2. **No scrollback recovery** — On macOS, `tmux capture-pane` provides scrollback history when reconnecting. On Windows, reconnecting a session starts with an empty buffer.

3. **PowerShell startup time** — PowerShell 5 (`powershell.exe`) has noticeable startup lag. Install PowerShell 7 (`pwsh.exe`) for a faster experience.

4. **ConPTY quirks** — Windows 10 builds before 1903 have limited ConPTY support. Windows 11 recommended.

5. **node-pty build on Windows** — requires Visual Studio Build Tools with C++ workload. If `electron-rebuild` fails with Spectre errors, install Spectre-mitigated libraries from VS Installer, or patch `winpty.gyp` to set `SpectreMitigation: 'false'`.

---

## Install (End User)

### PowerShell One-Liner

```powershell
irm https://raw.githubusercontent.com/collaborator-ai/collab-public/main/collab-electron/install.ps1 | iex
```

### Manual

Download the latest `.exe` installer or portable `.zip` from [GitHub Releases](https://github.com/collaborator-ai/collab-public/releases).
