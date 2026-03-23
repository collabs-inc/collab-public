import { app, ipcMain } from "electron";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

export type AgentId = "claude" | "codex" | "gemini";

interface AgentStatus {
  id: AgentId;
  name: string;
  detected: boolean;
  installed: boolean;
}


export function agentDetected(id: AgentId): boolean {
  const home = homedir();
  switch (id) {
    case "claude":
      return (
        existsSync(join(home, ".claude")) || isOnPath("claude")
      );
    case "codex":
      return (
        existsSync(join(home, ".codex")) || isOnPath("codex")
      );
    case "gemini":
      return (
        existsSync(join(home, ".gemini")) || isOnPath("gemini")
      );
  }
}

function isOnPath(command: string): boolean {
  try {
    execSync(`which ${command}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// -- skill source --

export const VALID_AGENT_IDS = new Set<string>(["claude", "codex", "gemini"]);

export function skillSourceDir(): string {
  const candidates = [
    // Packaged app: extraResources destination takes priority
    ...(app.isPackaged && process.resourcesPath
      ? [join(process.resourcesPath, "collab-canvas-skill")]
      : []),
    // Development: resolve from app root
    join(app.getAppPath(), "packages", "collab-canvas-skill"),
    join(__dirname, "..", "..", "packages", "collab-canvas-skill"),
    join(__dirname, "..", "packages", "collab-canvas-skill"),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "skills", "collab-canvas", "SKILL.md"))) {
      return dir;
    }
  }
  throw new Error(
    `Canvas skill source files not found. Searched: ${candidates.join(", ")}`,
  );
}

// -- install paths --

function skillInstallPath(id: AgentId): string {
  const home = homedir();
  switch (id) {
    case "claude":
      return join(home, ".claude", "skills", "collab-canvas");
    case "codex":
      return join(home, ".codex", "instructions", "collab-canvas.md");
    case "gemini":
      return join(home, ".gemini", "instructions", "collab-canvas.md");
  }
}

function skillInstalled(id: AgentId): boolean {
  const target = skillInstallPath(id);
  if (id === "claude") {
    return existsSync(join(target, "SKILL.md"));
  }
  return existsSync(target);
}

// -- install / uninstall --

export function installSkill(id: AgentId): void {
  const srcDir = skillSourceDir();
  const target = skillInstallPath(id);

  if (id === "claude") {
    mkdirSync(target, { recursive: true });
    const src = join(srcDir, "skills", "collab-canvas", "SKILL.md");
    writeFileSync(
      join(target, "SKILL.md"),
      readFileSync(src, "utf-8"),
      "utf-8",
    );
    return;
  }

  mkdirSync(join(target, ".."), { recursive: true });
  const sourceFile =
    id === "codex"
      ? "collab-canvas-codex.md"
      : "collab-canvas-gemini.md";
  writeFileSync(
    target,
    readFileSync(join(srcDir, sourceFile), "utf-8"),
    "utf-8",
  );
}

export function uninstallSkill(id: AgentId): void {
  const target = skillInstallPath(id);
  if (id === "claude") {
    rmSync(target, { recursive: true, force: true });
    return;
  }
  if (existsSync(target)) rmSync(target);
}

// -- plugin offered marker --

function markerPath(): string {
  return join(homedir(), ".collaborator", "canvas-plugin-offered");
}

export function hasOfferedPlugin(): boolean {
  return existsSync(markerPath());
}

export function markPluginOffered(): void {
  const dir = join(homedir(), ".collaborator");
  mkdirSync(dir, { recursive: true });
  writeFileSync(markerPath(), new Date().toISOString(), "utf-8");
}

// -- IPC --

export function getAgentStatuses(): AgentStatus[] {
  const agents: AgentId[] = ["claude", "codex", "gemini"];
  return agents.map((id) => ({
    id,
    name:
      id === "claude"
        ? "Claude Code"
        : id === "codex"
          ? "Codex CLI"
          : "Gemini CLI",
    detected: agentDetected(id),
    installed: skillInstalled(id),
  }));
}

export function registerIntegrationsIpc(): void {
  ipcMain.handle("integrations:get-agents", () =>
    getAgentStatuses(),
  );

  ipcMain.handle(
    "integrations:install-skill",
    (_event, agentId: string) => {
      if (!VALID_AGENT_IDS.has(agentId)) {
        return { ok: false, error: `Unknown agent: ${agentId}` };
      }
      try {
        installSkill(agentId as AgentId);
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[integrations] Failed to install skill:", msg);
        return { ok: false, error: msg };
      }
    },
  );

  ipcMain.handle(
    "integrations:uninstall-skill",
    (_event, agentId: string) => {
      if (!VALID_AGENT_IDS.has(agentId)) {
        return { ok: false, error: `Unknown agent: ${agentId}` };
      }
      try {
        uninstallSkill(agentId as AgentId);
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[integrations] Failed to uninstall skill:", msg);
        return { ok: false, error: msg };
      }
    },
  );

  ipcMain.handle("integrations:has-offered-plugin", () =>
    hasOfferedPlugin(),
  );

  ipcMain.handle("integrations:mark-plugin-offered", () => {
    markPluginOffered();
    return { ok: true };
  });
}
