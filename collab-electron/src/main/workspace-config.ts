import { readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { atomicWriteFileSync } from "./files";

export interface WorkspaceConfig {
  selected_file: string | null;
  expanded_dirs: string[];
  agent_skip_permissions: boolean;
  auto_created_graph: boolean;
}

const DEFAULT_CONFIG: WorkspaceConfig = {
  selected_file: null,
  expanded_dirs: [],
  agent_skip_permissions: false,
  auto_created_graph: false,
};

export function workspaceConfigPath(workspacePath: string): string {
  return join(workspacePath, ".collaborator", "config.json");
}

export function loadWorkspaceConfig(
  workspacePath: string,
): WorkspaceConfig {
  try {
    const raw = readFileSync(
      workspaceConfigPath(workspacePath),
      "utf-8",
    );
    const parsed = JSON.parse(raw) as Partial<WorkspaceConfig>;
    return {
      selected_file: parsed.selected_file ?? null,
      expanded_dirs: Array.isArray(parsed.expanded_dirs)
        ? parsed.expanded_dirs
        : [],
      agent_skip_permissions:
        parsed.agent_skip_permissions === true,
      auto_created_graph:
        parsed.auto_created_graph === true,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveWorkspaceConfig(
  workspacePath: string,
  config: WorkspaceConfig,
): void {
  const filePath = workspaceConfigPath(workspacePath);
  mkdirSync(dirname(filePath), { recursive: true });
  atomicWriteFileSync(filePath, JSON.stringify(config, null, 2));
}
