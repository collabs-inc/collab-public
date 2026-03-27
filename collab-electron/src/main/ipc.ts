import {
  app,
  ipcMain,
  dialog,
  Menu,
  Notification,
  shell,
  type BrowserWindow,
} from "electron";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import {
  readdir,
  readFile,
  stat,
} from "node:fs/promises";
import { homedir, platform } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { createFileFilter, type FileFilter } from "./file-filter";
import fm from "front-matter";
import { saveConfig, type AppConfig } from "./config";
import {
  loadWorkspaceConfig,
  saveWorkspaceConfig,
  type WorkspaceConfig,
} from "./workspace-config";
import { buildWorkspaceGraph } from "./workspace-graph";
import {
  getImageThumbnail,
  getImageFull,
  invalidateImageCache,
  resolveImagePath,
  saveDroppedImage,
  setThumbnailCacheDir,
} from "./image-service";
import {
  countTreeFiles,
  fsMkdir,
  fsMove,
  fsReadDir,
  fsReadFile,
  fsRename,
  shouldIncludeEntryWithContent,
  fsWriteFile,
} from "./files";
import * as canvasPersistence from "./canvas-persistence";
import * as watcher from "./watcher";
import * as wikilinkIndex from "./wikilink-index";
import * as agentActivity from "./agent-activity";
import * as gitReplay from "./git-replay";
import { importWebArticle } from "./import-service";
import { trackEvent } from "./analytics";
import { DISABLE_GIT_REPLAY } from "@collab/shared/replay-types";
import { registerMethod } from "./json-rpc-server";
import {
  type FolderTableData,
  type FolderTableFile,
  type TreeNode,
} from "@collab/shared/types";

const FS_CHANGE_DELETED = 3;

const recentlyRenamedRefCounts = new Map<string, number>();

let appConfig: AppConfig;
const wsConfigMap = new Map<string, WorkspaceConfig>();
let mainWindow: BrowserWindow | null = null;

function getWsConfig(workspacePath: string): WorkspaceConfig {
  let config = wsConfigMap.get(workspacePath);
  if (!config) {
    config = loadWorkspaceConfig(workspacePath);
    wsConfigMap.set(workspacePath, config);
  }
  return config;
}

function activeWsConfig(): WorkspaceConfig {
  const path = activeWorkspacePath();
  if (!path) {
    return {
      selected_file: null,
      expanded_dirs: [],
      agent_skip_permissions: false,
      auto_created_graph: false,
    };
  }
  return getWsConfig(path);
}

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win;
}

function activeWorkspacePath(): string {
  const { workspaces, active_workspace } = appConfig;
  return workspaces[active_workspace] ?? "";
}

function forwardToWebview(
  target: string,
  channel: string,
  ...args: unknown[]
): void {
  mainWindow?.webContents.send(
    "shell:forward",
    target,
    channel,
    ...args,
  );
}

const CLAUDE_MD_TEMPLATE = `# Collaborator Workspace

This is a Collaborator workspace. Files in the root are sources (notes, articles, transcripts).
Files in \`.collaborator/\` are managed by the Collaborator agent.

## File types
- Sources (root): note, article, transcript, pdf
- Inferences (.collaborator/inferences/): concept, insight, objective

## Front-matter
All .md files should have YAML front-matter with at least a \`type\` field.
Files without \`collab_reviewed: true\` are inbox items awaiting processing.

## Persona
- \`.collaborator/persona/identity.md\` — who this collaborator is
- \`.collaborator/persona/values.md\` — beliefs, priorities, decision style
`;

const AGENT_NOTIFY_SCRIPT = `#!/bin/bash
set -euo pipefail
LOG="$HOME/.collaborator/hook-debug.log"
INPUT=$(cat)
echo "[$(date -Iseconds)] hook fired" >> "$LOG"
echo "  raw input: $INPUT" >> "$LOG"
EVENT=$(echo "$INPUT" | jq -r '.hook_event_name')

# Discover the socket path from the breadcrumb file written by the
# JSON-RPC server. This works for both dev (~/.collaborator/dev/)
# and prod (~/.collaborator/) instances.
SOCKET_PATH_FILE="$HOME/.collaborator/socket-path"
if [ -f "$SOCKET_PATH_FILE" ]; then
  SOCKET=$(cat "$SOCKET_PATH_FILE")
else
  SOCKET="$HOME/.collaborator/ipc.sock"
fi

if [ ! -S "$SOCKET" ]; then
  echo "  socket not found at $SOCKET" >> "$LOG"
  exit 0
fi

case "$EVENT" in
  SessionStart)
    METHOD="agent.sessionStart"
    PAYLOAD=$(echo "$INPUT" | jq -c --arg pty "$COLLAB_PTY_SESSION_ID" '{session_id: .session_id, cwd: .cwd, pty_session_id: $pty}')
    ;;
  PostToolUse)
    METHOD="agent.fileTouched"
    PAYLOAD=$(echo "$INPUT" | jq -c '{session_id: .session_id, tool_name: .tool_name, file_path: (.tool_input.file_path // .tool_input.path // null)}')
    ;;
  SessionEnd)
    METHOD="agent.sessionEnd"
    PAYLOAD=$(echo "$INPUT" | jq -c '{session_id: .session_id}')
    ;;
  *)
    echo "  unknown event: $EVENT" >> "$LOG"
    exit 0
    ;;
esac

echo "  method=$METHOD payload=$PAYLOAD" >> "$LOG"
RESULT=$(printf '{"jsonrpc":"2.0","id":1,"method":"%s","params":%s}\\n' "$METHOD" "$PAYLOAD" \\
  | nc -U -w1 "$SOCKET" 2>&1) || true
echo "  rpc result: $RESULT" >> "$LOG"

exit 0
`;

/**
 * Windows PowerShell version of the agent notify script.
 * Note: Windows named pipes use a different protocol than Unix sockets.
 * On Windows, the JSON-RPC server uses TCP instead of Unix sockets.
 */
const AGENT_NOTIFY_SCRIPT_PS1 = `#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$COLLAB_DIR = Join-Path $env:USERPROFILE ".collaborator"
$LOG = Join-Path $COLLAB_DIR "hook-debug.log"
$SOCKET_PATH_FILE = Join-Path $COLLAB_DIR "socket-path"

# Read input from stdin
$InputText = [Console]::In.ReadToEnd()
$Timestamp = Get-Date -Format "o"
Add-Content -Path $LOG -Value "[$Timestamp] hook fired"
Add-Content -Path $LOG -Value "  raw input: $InputText"

try {
  $InputJson = $InputText | ConvertFrom-Json
  $Event = $InputJson.hook_event_name
} catch {
  Add-Content -Path $LOG -Value "  failed to parse input JSON: $_"
  exit 0
}

# Read TCP endpoint from socket-path file (Windows uses TCP instead of named pipes)
if (Test-Path $SOCKET_PATH_FILE) {
  $TCP_ENDPOINT = Get-Content -Path $SOCKET_PATH_FILE -Raw
} else {
  Add-Content -Path $LOG -Value "  socket-path file not found"
  exit 0
}

# Parse TCP endpoint (format: tcp://localhost:PORT)
if ($TCP_ENDPOINT -match "^tcp://([^:]+):(\d+)$") {
  $HostAddr = $matches[1]
  $Port = [int]$matches[2]
} else {
  Add-Content -Path $LOG -Value "  invalid TCP endpoint: $TCP_ENDPOINT"
  exit 0
}

$Method = $null
$PayloadJson = $null

switch ($Event) {
  "SessionStart" {
    $Method = "agent.sessionStart"
    $PtyId = if ($env:COLLAB_PTY_SESSION_ID) { $env:COLLAB_PTY_SESSION_ID } else { "" }
    $Payload = @{
      session_id = $InputJson.session_id
      cwd = $InputJson.cwd
      pty_session_id = $PtyId
    }
    $PayloadJson = $Payload | ConvertTo-Json -Compress
  }
  "PostToolUse" {
    $Method = "agent.fileTouched"
    $FilePath = $InputJson.tool_input.file_path
    if (-not $FilePath) {
      $FilePath = $InputJson.tool_input.path
    }
    $Payload = @{
      session_id = $InputJson.session_id
      tool_name = $InputJson.tool_name
      file_path = $FilePath
    }
    $PayloadJson = $Payload | ConvertTo-Json -Compress
  }
  "SessionEnd" {
    $Method = "agent.sessionEnd"
    $Payload = @{
      session_id = $InputJson.session_id
    }
    $PayloadJson = $Payload | ConvertTo-Json -Compress
  }
  default {
    Add-Content -Path $LOG -Value "  unknown event: $Event"
    exit 0
  }
}

Add-Content -Path $LOG -Value "  method=$Method payload=$PayloadJson"

try {
  # Send JSON-RPC request over TCP
  $RpcMessage = '{"jsonrpc":"2.0","id":1,"method":"' + $Method + '","params":' + $PayloadJson + '}'
  $Client = New-Object System.Net.Sockets.TcpClient($HostAddr, $Port)
  $Stream = $Client.GetStream()
  $Writer = New-Object System.IO.StreamWriter($Stream, [System.Text.Encoding]::UTF8)
  $Writer.WriteLine($RpcMessage)
  $Writer.Flush()

  # Read response with timeout
  $Client.ReceiveTimeout = 1000
  $Reader = New-Object System.IO.StreamReader($Stream)
  $Result = $Reader.ReadLine()
  Add-Content -Path $LOG -Value "  rpc result: $Result"

  $Reader.Close()
  $Writer.Close()
  $Client.Close()
} catch {
  Add-Content -Path $LOG -Value "  rpc call failed: $_"
}

exit 0
`;

function buildHooksConfig(): Record<string, unknown> {
  const plat = platform();
  const isWindows = plat === "win32";
  const sep = isWindows ? "\\" : "/";

  // Windows uses PowerShell script (.ps1), Unix uses bash script (.sh)
  const agentScript = isWindows
    ? `"${"$CLAUDE_PROJECT_DIR"}${sep}.claude${sep}hooks${sep}agent-notify.ps1"`
    : `"${"$CLAUDE_PROJECT_DIR"}${sep}.claude${sep}hooks${sep}agent-notify.sh"`;

  return {
    SessionStart: [
      {
        hooks: [
          {
            type: "command",
            command: agentScript,
            timeout: 5,
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: "Read|Write|Edit",
        hooks: [
          {
            type: "command",
            command: agentScript,
            timeout: 5,
          },
        ],
      },
    ],
    SessionEnd: [
      {
        hooks: [
          {
            type: "command",
            command: agentScript,
            timeout: 5,
          },
        ],
      },
    ],
  };
}

function ensureGitignoreEntry(workspacePath: string): void {
  const gitignorePath = join(workspacePath, ".gitignore");
  if (!existsSync(gitignorePath)) return;

  const content = readFileSync(gitignorePath, "utf-8");
  const lines = content.split("\n");
  const alreadyIgnored = lines.some(
    (l) => l.trim() === ".collaborator" || l.trim() === ".collaborator/",
  );
  if (alreadyIgnored) return;

  const suffix = content.endsWith("\n") ? "" : "\n";
  appendFileSync(
    gitignorePath,
    `${suffix}.collaborator\n`,
    "utf-8",
  );
}

const RPC_BLOCK_START = "<!-- collaborator:rpc-start -->";
const RPC_BLOCK_END = "<!-- collaborator:rpc-end -->";

function buildRpcBlock(): string {
  const socketPathFile = join(homedir(), ".collaborator", "socket-path");
  const plat = platform();
  const isWindows = plat === "win32";

  if (isWindows) {
    // Windows uses TCP instead of Unix domain sockets
    return [
      RPC_BLOCK_START,
      "",
      "## Collaborator RPC",
      "",
      "The Collaborator desktop app exposes a JSON-RPC 2.0 server over TCP on Windows.",
      `Read the TCP endpoint from \`${socketPathFile}\`, then send newline-delimited JSON.`,
      "",
      "Call `rpc.discover` to list available methods:",
      "```powershell",
      `$TCP_ENDPOINT = Get-Content -Path "${socketPathFile}" -Raw`,
      `# Parse endpoint (format: tcp://localhost:PORT)`,
      `if ($TCP_ENDPOINT -match "^tcp://([^:]+):(\d+)$") {`,
      `  $Host = $matches[1]`,
      `  $Port = $matches[2]`,
      `}`,
      `# Send JSON-RPC request`,
      `$Client = New-Object System.Net.Sockets.TcpClient($Host, $Port)`,
      `$Stream = $Client.GetStream()`,
      `$Writer = New-Object System.IO.StreamWriter($Stream)`,
      `$Writer.WriteLine('{"jsonrpc":"2.0","id":1,"method":"rpc.discover"}')`,
      `$Writer.Flush()`,
      `$Reader = New-Object System.IO.StreamReader($Stream)`,
      `$Reader.ReadLine()`,
      "```",
      "",
      RPC_BLOCK_END,
    ].join("\n");
  }

  // macOS/Linux: Unix domain sockets
  return [
    RPC_BLOCK_START,
    "",
    "## Collaborator RPC",
    "",
    "The Collaborator desktop app exposes a JSON-RPC 2.0 server over a Unix domain socket.",
    `Read the socket path from \`${socketPathFile}\`, then send newline-delimited JSON.`,
    "",
    "Call `rpc.discover` to list available methods:",
    "```bash",
    `SOCK=$(cat "${socketPathFile}")`,
    `echo '{"jsonrpc":"2.0","id":1,"method":"rpc.discover"}' | nc -U "$SOCK"`,
    "```",
    "",
    RPC_BLOCK_END,
  ].join("\n");
}

function ensureRpcBlock(claudeMdPath: string): void {
  let content = existsSync(claudeMdPath)
    ? readFileSync(claudeMdPath, "utf-8")
    : "";

  const startIdx = content.indexOf(RPC_BLOCK_START);
  const endIdx = content.indexOf(RPC_BLOCK_END);
  const block = buildRpcBlock();

  if (startIdx !== -1 && endIdx !== -1) {
    content =
      content.slice(0, startIdx) +
      block +
      content.slice(endIdx + RPC_BLOCK_END.length);
  } else {
    content = content.trimEnd() + "\n\n" + block + "\n";
  }

  writeFileSync(claudeMdPath, content, "utf-8");
}

function initWorkspaceFiles(workspacePath: string): void {
  const collabDir = join(workspacePath, ".collaborator");
  const claudeDir = join(workspacePath, ".claude");

  mkdirSync(collabDir, { recursive: true });
  mkdirSync(claudeDir, { recursive: true });

  const claudeMd = join(claudeDir, "CLAUDE.md");
  if (!existsSync(claudeMd)) {
    writeFileSync(claudeMd, CLAUDE_MD_TEMPLATE, "utf-8");
  }
  ensureRpcBlock(claudeMd);

  ensureGitignoreEntry(workspacePath);
}

function readJsonFileSync(
  filePath: string,
): Record<string, unknown> {
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function installPluginSync(workspacePath: string): void {
  const claudeDir = join(workspacePath, ".claude");
  const hooksDir = join(claudeDir, "hooks");
  mkdirSync(claudeDir, { recursive: true });
  mkdirSync(hooksDir, { recursive: true });

  const settingsPath = join(claudeDir, "settings.json");
  const settings = readJsonFileSync(settingsPath);
  const existingHooks =
    settings.hooks && typeof settings.hooks === "object"
      ? (settings.hooks as Record<string, unknown>)
      : {};
  settings.hooks = { ...existingHooks, ...buildHooksConfig() };
  writeFileSync(
    settingsPath,
    JSON.stringify(settings, null, 2),
    "utf-8",
  );

  // Install platform-specific agent notify script
  const plat = platform();
  const isWindows = plat === "win32";

  if (isWindows) {
    // Windows: PowerShell script (.ps1)
    writeFileSync(
      join(hooksDir, "agent-notify.ps1"),
      AGENT_NOTIFY_SCRIPT_PS1,
    );
  } else {
    // macOS/Linux: Bash script (.sh)
    writeFileSync(
      join(hooksDir, "agent-notify.sh"),
      AGENT_NOTIFY_SCRIPT,
      { mode: 0o755 },
    );
  }
}

/**
 * Start all workspace-dependent services for the given path.
 * Handles watcher, file filter, wikilink index, agent activity,
 * thumbnail cache, and workspace config loading.
 */
function startWorkspaceServices(
  path: string,
  fileFilterSetter: (f: FileFilter) => void,
): void {
  wsConfigMap.set(path, loadWorkspaceConfig(path));
  setThumbnailCacheDir(path);
  watcher.watchWorkspace(path);
  createFileFilter(path).then(
    (f) => { fileFilterSetter(f); },
    (err) => { console.error("[workspace] Failed to create file filter:", err); },
  );
  void wikilinkIndex.buildIndex(path);
  agentActivity.setWorkspacePath(path);

  try {
    installPluginSync(path);
  } catch (err) {
    console.error("[workspace] Failed to install plugin hooks:", err);
  }
}

/**
 * Stop workspace services and reset state.
 */
function stopWorkspaceServices(): void {
  watcher.watchWorkspace("");
  agentActivity.setWorkspacePath("");
}

/**
 * Notify all renderers that the active workspace changed.
 */
function notifyWorkspaceChanged(path: string): void {
  forwardToWebview("nav", "workspace-changed", path);
  forwardToWebview("viewer", "workspace-changed", path);
  forwardToWebview("terminal", "workspace-changed", path);
  mainWindow?.webContents.send("shell:workspace-changed", path);
}

export function registerIpcHandlers(config: AppConfig): void {
  appConfig = config;

  let fileFilter: FileFilter | null = null;

  const wsPath = activeWorkspacePath();
  if (wsPath) {
    startWorkspaceServices(wsPath, (f) => {
      fileFilter = f;
    });
  }

  watcher.setNotifyFn((events) => {
    const changedPaths = events.flatMap(
      (event) => event.changes.map((change) => change.path),
    );
    fileFilter?.invalidateBinaryCache(changedPaths);
    invalidateImageCache(changedPaths);

    forwardToWebview("nav", "fs-changed", events);
    forwardToWebview("viewer", "fs-changed", events);

    for (const event of events) {
      for (const change of event.changes) {
        if (!change.path.endsWith(".md")) continue;
        if (change.type === FS_CHANGE_DELETED) {
          wikilinkIndex.removeFile(change.path);
        } else {
          void wikilinkIndex.updateFile(change.path);
        }
      }
    }

    const deletedPaths = events.flatMap((e) =>
      e.changes
        .filter((c) => c.type === FS_CHANGE_DELETED && !recentlyRenamedRefCounts.has(c.path))
        .map((c) => c.path),
    );
    if (deletedPaths.length > 0) {
      forwardToWebview("nav", "files-deleted", deletedPaths);
      forwardToWebview("viewer", "files-deleted", deletedPaths);
      const active = activeWorkspacePath();
      if (active) {
        const config = getWsConfig(active);
        if (
          config.selected_file &&
          deletedPaths.includes(config.selected_file)
        ) {
          config.selected_file = null;
          saveWorkspaceConfig(active, config);
        }
      }
    }
  });

  // Config
  ipcMain.handle("config:get", () => appConfig);
  ipcMain.handle("app:version", () => app.getVersion());

  ipcMain.handle(
    "workspace-pref:get",
    (_event, key: string) => {
      const config = activeWsConfig();
      if (key === "selected_file") return config.selected_file;
      if (key === "expanded_dirs") return config.expanded_dirs;
      if (key === "agent_skip_permissions")
        return config.agent_skip_permissions;
      if (key === "auto_created_graph")
        return config.auto_created_graph;
      return null;
    },
  );

  ipcMain.handle(
    "workspace-pref:set",
    (_event, key: string, value: unknown) => {
      const active = activeWorkspacePath();
      if (!active) return;
      const config = getWsConfig(active);
      if (key === "selected_file") {
        config.selected_file =
          (value as string | null) ?? null;
      } else if (key === "expanded_dirs") {
        config.expanded_dirs = Array.isArray(value)
          ? value
          : [];
      } else if (key === "agent_skip_permissions") {
        config.agent_skip_permissions = value === true;
      } else if (key === "auto_created_graph") {
        config.auto_created_graph = value === true;
      }
      saveWorkspaceConfig(active, config);
    },
  );

  // Backward compat: returns the active workspace path
  ipcMain.handle(
    "shell:get-workspace-path",
    () => activeWorkspacePath() || null,
  );

  // Workspace config (direct get/set for full config)
  ipcMain.handle(
    "workspace-config:get",
    (_event, workspacePath: string) => {
      return getWsConfig(workspacePath);
    },
  );

  ipcMain.handle(
    "workspace-config:set",
    (_event, workspacePath: string, configUpdate: Partial<WorkspaceConfig>) => {
      const current = getWsConfig(workspacePath);
      const updated = { ...current, ...configUpdate };
      saveWorkspaceConfig(workspacePath, updated);
      wsConfigMap.set(workspacePath, updated);
    },
  );

  // --- Multi-workspace handlers ---

  ipcMain.handle("workspace:list", () => ({
    workspaces: appConfig.workspaces,
    active: appConfig.active_workspace,
  }));

  ipcMain.handle("workspace:add", async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    const chosen = realpathSync(result.filePaths[0]!);

    const existingIndex = appConfig.workspaces.indexOf(chosen);
    if (existingIndex !== -1) {
      if (existingIndex !== appConfig.active_workspace) {
        appConfig.active_workspace = existingIndex;
        saveConfig(appConfig);
        startWorkspaceServices(chosen, (f) => {
          fileFilter = f;
        });
        notifyWorkspaceChanged(chosen);
      }
      return {
        workspaces: appConfig.workspaces,
        active: existingIndex,
      };
    }

    const collabDir = join(chosen, ".collaborator");
    const isNew = !existsSync(collabDir);
    if (isNew) {
      initWorkspaceFiles(chosen);
    }

    appConfig.workspaces.push(chosen);
    appConfig.active_workspace = appConfig.workspaces.length - 1;
    saveConfig(appConfig);
    trackEvent("workspace_added", { is_new: isNew });

    startWorkspaceServices(chosen, (f) => {
      fileFilter = f;
    });
    notifyWorkspaceChanged(chosen);

    return {
      workspaces: appConfig.workspaces,
      active: appConfig.active_workspace,
    };
  });

  ipcMain.handle(
    "workspace:remove",
    (_event, index: number) => {
      if (index < 0 || index >= appConfig.workspaces.length) {
        return {
          workspaces: appConfig.workspaces,
          active: appConfig.active_workspace,
        };
      }

      const removedPath = appConfig.workspaces[index]!;
      wsConfigMap.delete(removedPath);

      const wasActive = index === appConfig.active_workspace;
      appConfig.workspaces.splice(index, 1);

      if (appConfig.workspaces.length === 0) {
        appConfig.active_workspace = -1;
      } else if (wasActive) {
        // Pick nearest neighbor: prefer right, then left
        appConfig.active_workspace = Math.min(
          index,
          appConfig.workspaces.length - 1,
        );
      } else if (appConfig.active_workspace > index) {
        // Active was after the removed entry, shift down
        appConfig.active_workspace -= 1;
      }

      saveConfig(appConfig);
      trackEvent("workspace_removed");

      if (wasActive) {
        const newPath = activeWorkspacePath();
        if (newPath) {
          startWorkspaceServices(newPath, (f) => {
            fileFilter = f;
          });
          notifyWorkspaceChanged(newPath);
        } else {
          stopWorkspaceServices();
          fileFilter = null;
          notifyWorkspaceChanged("");
        }
      }

      return {
        workspaces: appConfig.workspaces,
        active: appConfig.active_workspace,
      };
    },
  );

  ipcMain.handle(
    "workspace:switch",
    (_event, index: number) => {
      if (
        index < 0 ||
        index >= appConfig.workspaces.length ||
        index === appConfig.active_workspace
      ) {
        return;
      }

      appConfig.active_workspace = index;
      saveConfig(appConfig);
      trackEvent("workspace_switched");

      const newPath = appConfig.workspaces[index]!;
      startWorkspaceServices(newPath, (f) => {
        fileFilter = f;
      });
      notifyWorkspaceChanged(newPath);
    },
  );

  // Filesystem
  ipcMain.handle("fs:readdir", (_event, path) =>
    fsReadDir(
      path,
      fileFilter ?? undefined,
      activeWorkspacePath() || undefined,
    ),
  );
  ipcMain.handle("fs:count-files", (_event, path) =>
    countTreeFiles(
      path,
      fileFilter ?? undefined,
      activeWorkspacePath() || undefined,
    ),
  );
  ipcMain.handle("fs:readfile", (_event, path) =>
    fsReadFile(path),
  );
  ipcMain.handle(
    "image:thumbnail",
    (_event, path: string, size: number) =>
      getImageThumbnail(path, size),
  );
  ipcMain.handle("image:full", (_event, path: string) =>
    getImageFull(path),
  );
  ipcMain.handle(
    "image:resolve-path",
    (_event, reference: string, fromNotePath: string) =>
      resolveImagePath(
        reference,
        fromNotePath,
        activeWorkspacePath(),
      ),
  );
  ipcMain.handle(
    "image:save-dropped",
    async (
      _event,
      noteDir: string,
      fileName: string,
      buffer: ArrayBuffer,
    ) => {
      const ws = activeWorkspacePath();
      if (
        !ws ||
        (noteDir !== ws && !noteDir.startsWith(ws + "/"))
      ) {
        throw new Error("Target directory is outside workspace");
      }
      return saveDroppedImage(
        noteDir,
        fileName,
        Buffer.from(buffer),
      );
    },
  );
  ipcMain.handle(
    "import:web-article",
    async (_event, url: string, targetDir: string) => {
      const ws = activeWorkspacePath();
      if (!ws) {
        throw new Error("No active workspace");
      }
      const articleResult = await importWebArticle(url, targetDir, ws);
      trackEvent("web_article_imported");
      return articleResult;
    },
  );
  ipcMain.handle("dialog:open-image", async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: [
        {
          name: "Images",
          extensions: [
            "png",
            "jpg",
            "jpeg",
            "gif",
            "webp",
            "bmp",
            "tiff",
            "tif",
            "avif",
            "heic",
            "heif",
          ],
        },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0]!;
  });
  ipcMain.handle(
    "fs:writefile",
    async (_event, path, content, expectedMtime?: string) => {
      const result = await fsWriteFile(path, content, expectedMtime);
      if (result.ok) {
        trackEvent("file_saved", { ext: extname(path) });
        fileFilter?.invalidateBinaryCache([path]);
        const event = [{ dirPath: dirname(path), changes: [{ path, type: 1 }] }];
        forwardToWebview("nav", "fs-changed", event);
        forwardToWebview("viewer", "fs-changed", event);
      }
      return result;
    },
  );

  ipcMain.handle(
    "fs:rename",
    async (_event, oldPath: string, newTitle: string) => {
      const sanitized = newTitle
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
        .replace(/\.\s*$/, "")
        .trim();
      if (sanitized.length === 0) {
        throw new Error("Title cannot be empty");
      }
      const dotIndex = oldPath.lastIndexOf(".");
      const slashIndex = oldPath.lastIndexOf("/");
      const ext = dotIndex > slashIndex ? oldPath.slice(dotIndex) : "";
      recentlyRenamedRefCounts.set(oldPath, (recentlyRenamedRefCounts.get(oldPath) ?? 0) + 1);
      setTimeout(() => {
        const count = (recentlyRenamedRefCounts.get(oldPath) ?? 1) - 1;
        if (count <= 0) recentlyRenamedRefCounts.delete(oldPath);
        else recentlyRenamedRefCounts.set(oldPath, count);
      }, 2000);
      const newPath = await fsRename(oldPath, `${sanitized}${ext}`);
      trackEvent("file_renamed");
      fileFilter?.invalidateBinaryCache([oldPath, newPath]);

      const updatedFiles = await wikilinkIndex.handleRename(
        oldPath,
        newPath,
      );

      const active = activeWorkspacePath();
      if (active) {
        const config = getWsConfig(active);
        if (config.selected_file === oldPath) {
          config.selected_file = newPath;
          saveWorkspaceConfig(active, config);
        }
      }
      forwardToWebview("viewer", "file-renamed", oldPath, newPath);
      forwardToWebview("nav", "file-renamed", oldPath, newPath);

      if (updatedFiles.length > 0) {
        forwardToWebview(
          "viewer",
          "wikilinks-updated",
          updatedFiles,
        );
      }

      return newPath;
    },
  );

  ipcMain.handle("fs:stat", async (_event, path: string) => {
    const stats = await stat(path);
    return {
      ctime: stats.birthtime.toISOString(),
      mtime: stats.mtime.toISOString(),
    };
  });

  ipcMain.handle("fs:trash", async (_event, path: string) => {
    await shell.trashItem(path);
    trackEvent("file_trashed");
    fileFilter?.invalidateBinaryCache([path]);
  });

  ipcMain.handle("fs:mkdir", async (_event, path: string) => {
    await fsMkdir(path);
    trackEvent("folder_created");
    const event = [{ dirPath: dirname(path), changes: [{ path, type: 1 }] }];
    forwardToWebview("nav", "fs-changed", event);
    forwardToWebview("viewer", "fs-changed", event);
  });

  ipcMain.handle(
    "fs:move",
    async (_event, oldPath: string, newParentDir: string) => {
      recentlyRenamedRefCounts.set(oldPath, (recentlyRenamedRefCounts.get(oldPath) ?? 0) + 1);
      setTimeout(() => {
        const count = (recentlyRenamedRefCounts.get(oldPath) ?? 1) - 1;
        if (count <= 0) recentlyRenamedRefCounts.delete(oldPath);
        else recentlyRenamedRefCounts.set(oldPath, count);
      }, 2000);
      const newPath = await fsMove(oldPath, newParentDir);
      trackEvent("file_moved");
      fileFilter?.invalidateBinaryCache([oldPath, newPath]);

      const active = activeWorkspacePath();
      if (active) {
        const config = getWsConfig(active);
        if (config.selected_file === oldPath) {
          config.selected_file = newPath;
          saveWorkspaceConfig(active, config);
        }
      }

      forwardToWebview("viewer", "file-renamed", oldPath, newPath);
      forwardToWebview("nav", "file-renamed", oldPath, newPath);

      return newPath;
    },
  );

  // Wikilinks
  ipcMain.handle(
    "wikilink:resolve",
    (_event, target: string) => wikilinkIndex.resolve(target),
  );

  ipcMain.handle(
    "wikilink:suggest",
    (_event, partial: string) => wikilinkIndex.suggest(partial),
  );

  ipcMain.handle(
    "wikilink:backlinks",
    (_event, filePath: string) =>
      wikilinkIndex.backlinksWithContext(filePath),
  );

  // Dialog
  ipcMain.handle("dialog:open-folder", async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0]!;
  });

  // Navigation (nav -> main -> viewer via shell)
  ipcMain.handle(
    "nav:get-selected-file",
    () => activeWsConfig().selected_file,
  );

  ipcMain.on("nav:select-file", (_event, path) => {
    const active = activeWorkspacePath();
    if (active) {
      const config = getWsConfig(active);
      config.selected_file = path;
      saveWorkspaceConfig(active, config);
    }
    if (path) trackEvent("file_selected", { ext: extname(path) });
    forwardToWebview("viewer", "file-selected", path);
    forwardToWebview("nav", "file-selected", path);
  });

  ipcMain.on("nav:select-folder", (_event, path: string) => {
    trackEvent("folder_selected");
    forwardToWebview("viewer", "folder-selected", path);
  });

  ipcMain.handle(
    "fs:read-folder-table",
    async (
      _event,
      folderPath: string,
    ): Promise<FolderTableData> => {
      const workspace = activeWorkspacePath();
      if (
        !workspace ||
        (!folderPath.startsWith(workspace + "/") &&
          folderPath !== workspace)
      ) {
        throw new Error("Folder is outside workspace");
      }
      const entries = await readdir(folderPath, {
        withFileTypes: true,
      });
      const columnSet = new Set<string>();
      const mdEntries = entries.filter(
        (e) => e.isFile() && e.name.endsWith(".md"),
      );

      const files = (
        await Promise.all(
          mdEntries.map(
            async (
              entry,
            ): Promise<FolderTableFile | null> => {
              const fullPath = join(folderPath, entry.name);
              try {
                const [stats, content] = await Promise.all([
                  stat(fullPath),
                  readFile(fullPath, "utf-8"),
                ]);
                let attributes: Record<string, unknown> = {};
                try {
                  attributes =
                    fm<Record<string, unknown>>(
                      content,
                    ).attributes;
                } catch {
                  // Malformed frontmatter
                }
                for (const key of Object.keys(attributes)) {
                  columnSet.add(key);
                }
                return {
                  path: fullPath,
                  filename: entry.name,
                  frontmatter: attributes,
                  mtime: stats.mtime.toISOString(),
                  ctime: stats.birthtime.toISOString(),
                };
              } catch {
                return null;
              }
            },
          ),
        )
      ).filter((f): f is FolderTableFile => f !== null);

      const columns = [...columnSet].sort((a, b) =>
        a.localeCompare(b),
      );
      return { folderPath, files, columns };
    },
  );

  ipcMain.on(
    "nav:open-in-terminal",
    (_event, path: string) => {
      trackEvent("file_opened_in_terminal");
      forwardToWebview("canvas", "open-terminal", path);
    },
  );

  ipcMain.on(
    "nav:create-graph-tile",
    (_event, folderPath: string) => {
      forwardToWebview("canvas", "create-graph-tile", folderPath);
    },
  );

  ipcMain.on(
    "viewer:run-in-terminal",
    (_event, command: string) => {
      forwardToWebview("terminal", "run-in-terminal", command);
    },
  );

  // Workspace: read-tree
  ipcMain.handle(
    "workspace:read-tree",
    async (
      _event,
      params: { root: string },
    ): Promise<TreeNode[]> => {
      return readTreeRecursive(
        params.root,
        params.root,
        fileFilter,
      );
    },
  );

  // Workspace: get-workspace-graph
  ipcMain.handle(
    "workspace:get-graph",
    async (
      _event,
      params: { workspacePath: string },
    ) => buildWorkspaceGraph(params.workspacePath, fileFilter),
  );

  // Workspace: update-frontmatter
  const LEGACY_FM_FIELDS = new Set([
    "createdAt",
    "modifiedAt",
    "author",
  ]);

  ipcMain.handle(
    "workspace:update-frontmatter",
    async (
      _event,
      filePath: string,
      field: string,
      value: unknown,
    ): Promise<{ ok: boolean; retried?: boolean }> => {
      const MAX_ATTEMPTS = 3;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const fileStat = await stat(filePath);
        const expectedMtime = fileStat.mtime.toISOString();

        const content = await readFile(filePath, "utf-8");
        const parsed = fm<Record<string, unknown>>(content);
        const attrs = { ...parsed.attributes, [field]: value };

        for (const key of LEGACY_FM_FIELDS) {
          delete attrs[key];
        }

        const yaml = Object.entries(attrs)
          .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
          .join("\n");
        const output = `---\n${yaml}\n---\n${parsed.body}`;

        const result = await fsWriteFile(filePath, output, expectedMtime);
        if (result.ok) {
          return { ok: true, retried: attempt > 0 };
        }
      }
      return { ok: false };
    },
  );

  // Cross-webview drag-and-drop
  let pendingDragPaths: string[] = [];

  ipcMain.on("drag:set-paths", (_event, paths: string[]) => {
    pendingDragPaths = paths;
    forwardToWebview("viewer", "nav-drag-active", true);
  });

  ipcMain.on("drag:clear-paths", () => {
    pendingDragPaths = [];
    forwardToWebview("viewer", "nav-drag-active", false);
  });

  ipcMain.handle("drag:get-paths", () => {
    const paths = pendingDragPaths;
    pendingDragPaths = [];
    return paths;
  });

  // Agent activity
  agentActivity.setNotifyFn((event) => {
    forwardToWebview("viewer", `agent:${event.kind}`, event);
  });

  registerMethod(
    "agent.sessionStart",
    (params) => {
      const p = params as {
        session_id: string;
        cwd: string;
        pty_session_id?: string;
      };
      agentActivity.sessionStart(p);
      if (p.pty_session_id) {
        agentActivity.linkPtySession(
          p.session_id,
          p.pty_session_id,
        );
      }
      return { ok: true };
    },
    {
      description: "Register a new agent session",
      params: {
        session_id: "Unique session identifier",
        cwd: "Working directory of the agent",
        pty_session_id: "(optional) PTY session to link",
      },
    },
  );

  registerMethod(
    "agent.fileTouched",
    (params) => {
      const p = params as {
        session_id: string;
        tool_name: string;
        file_path: string | null;
      };
      agentActivity.fileTouched(p);
      return { ok: true };
    },
    {
      description: "Log a file read/write by an agent",
      params: {
        session_id: "Agent session identifier",
        tool_name: "Tool that accessed the file",
        file_path: "Absolute path to the file",
      },
    },
  );

  registerMethod(
    "agent.sessionEnd",
    (params) => {
      const p = params as { session_id: string };
      agentActivity.sessionEnd(p);
      return { ok: true };
    },
    {
      description: "End an agent session",
      params: { session_id: "Agent session identifier" },
    },
  );

  registerMethod(
    "app.notify",
    (params) => {
      const p = params as { title?: string; body: string };
      const note = new Notification({
        title: p.title ?? "Collaborator",
        body: p.body,
      });
      note.show();
      return { ok: true };
    },
    {
      description:
        "Show a native macOS notification",
      params: {
        title: "(optional) Notification title, defaults to 'Collaborator'",
        body: "Notification body text",
      },
    },
  );

  ipcMain.handle(
    "agent:focus-session",
    (_event, sessionId: string) => {
      const ptyId = agentActivity.getPtySessionId(sessionId);
      if (ptyId) {
        forwardToWebview("terminal", "focus-tab", ptyId);
      }
    },
  );

  // Git replay
  if (!DISABLE_GIT_REPLAY) {
    gitReplay.setNotifyFn((msg) => {
      forwardToWebview(
        `viewer:${msg.workspacePath}`,
        "replay:data",
        msg,
      );
    });
  }

  ipcMain.handle(
    "replay:start",
    (_event, params: { workspacePath: string }): boolean => {
      if (DISABLE_GIT_REPLAY) return false;
      return gitReplay.startReplay(params.workspacePath);
    },
  );

  ipcMain.handle("replay:stop", () => {
    if (DISABLE_GIT_REPLAY) return;
    gitReplay.stopReplay();
  });

  // Context menu
  ipcMain.handle(
    "context-menu:show",
    async (
      _event,
      items: Array<{
        id: string;
        label: string;
        enabled?: boolean;
      }>,
    ) => {
      if (!mainWindow) return null;

      return new Promise<string | null>((resolve) => {
        const menu = Menu.buildFromTemplate(
          items.map((item) => {
            if (item.id === "separator") {
              return { type: "separator" as const };
            }
            return {
              label: item.label,
              enabled: item.enabled ?? true,
              click: () => resolve(item.id),
            };
          }),
        );
        menu.popup({
          window: mainWindow!,
          callback: () => resolve(null),
        });
      });
    },
  );

  // Confirm dialog
  ipcMain.handle(
    "dialog:confirm",
    async (
      _event,
      opts: { message: string; detail?: string; buttons?: string[] },
    ) => {
      if (!mainWindow) return 0;
      const result = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        message: opts.message,
        detail: opts.detail,
        buttons: opts.buttons ?? ["OK", "Cancel"],
      });
      return result.response;
    },
  );

  // Open external URL in system browser
  ipcMain.on("shell:open-external", (_event, url: string) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  // Canvas pinch forwarding
  ipcMain.on("canvas:forward-pinch", (_event, deltaY: number) => {
    mainWindow?.webContents.send("canvas:pinch", deltaY);
  });

  // Canvas persistence
  ipcMain.handle("canvas:load-state", async () => {
    return canvasPersistence.loadState();
  });

  ipcMain.handle("canvas:save-state", async (_event, state) => {
    return canvasPersistence.saveState(state);
  });
}

async function readTreeRecursive(
  dirPath: string,
  rootPath: string,
  filter: FileFilter | null,
): Promise<TreeNode[]> {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const folders: TreeNode[] = [];
  const files: TreeNode[] = [];

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (
      !(await shouldIncludeEntryWithContent(
        dirPath,
        entry,
        filter ?? undefined,
        rootPath,
      ))
    ) {
      continue;
    }

    let stats;
    try {
      stats = await stat(fullPath);
    } catch {
      continue;
    }

    const ctime = stats.birthtime.toISOString();
    const mtime = stats.mtime.toISOString();

    if (entry.isDirectory()) {
      const children = await readTreeRecursive(
        fullPath,
        rootPath,
        filter,
      );
      folders.push({
        path: fullPath,
        name: entry.name,
        kind: "folder",
        ctime,
        mtime,
        children,
      });
    } else {
      const stem = basename(entry.name, extname(entry.name));
      const node: TreeNode = {
        path: fullPath,
        name: stem,
        kind: "file",
        ctime,
        mtime,
      };

      if (entry.name.endsWith(".md")) {
        try {
          const fileContent = await readFile(
            fullPath,
            "utf-8",
          );
          const parsed = fm<Record<string, unknown>>(
            fileContent,
          );
          node.frontmatter = parsed.attributes;
          node.preview = parsed.body.slice(0, 200);
        } catch {
          // Skip frontmatter parsing on failure
        }
      }

      files.push(node);
    }
  }

  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return [...folders, ...files];
}
