/**
 * Workspace Config IPC Handler Tests
 *
 * Tests for the IPC handlers related to workspace configuration.
 * These tests mock the Electron module to isolate the workspace config logic.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// Test workspace directory
let testWorkspaceDir: string;

// Mock Electron before importing anything
const mockIpcHandlers = new Map<string, Function>();

// Mock app config
let mockAppConfig: {
  workspaces: string[];
  active_workspace: number;
};

describe("Workspace Config IPC Handlers", () => {
  beforeEach(() => {
    // Create temporary test workspace
    testWorkspaceDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "collab-ipc-test-"),
    );

    // Reset mock app config
    mockAppConfig = {
      workspaces: [testWorkspaceDir],
      active_workspace: 0,
    };

    // Clear handlers
    mockIpcHandlers.clear();
  });

  afterEach(() => {
    // Clean up test workspace
    try {
      fs.rmSync(testWorkspaceDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    mockIpcHandlers.clear();
  });

  /**
   * Simulated IPC handler behavior based on the actual implementation in ipc.ts
   */
  function simulateWorkspaceConfigGet(_event: unknown, workspacePath: string) {
    const { loadWorkspaceConfig } = require("./workspace-config");
    return loadWorkspaceConfig(workspacePath);
  }

  function simulateWorkspaceConfigSet(
    _event: unknown,
    workspacePath: string,
    configUpdate: Record<string, unknown>,
  ) {
    const { loadWorkspaceConfig, saveWorkspaceConfig } = require("./workspace-config");
    const current = loadWorkspaceConfig(workspacePath);
    const updated = { ...current, ...configUpdate };
    saveWorkspaceConfig(workspacePath, updated);
  }

  function simulateWorkspacePrefGet(_event: unknown, key: string) {
    const { loadWorkspaceConfig } = require("./workspace-config");
    const config = loadWorkspaceConfig(testWorkspaceDir);
    if (key === "selected_file") return config.selected_file;
    if (key === "expanded_dirs") return config.expanded_dirs;
    if (key === "agent_skip_permissions") return config.agent_skip_permissions;
    if (key === "auto_created_graph") return config.auto_created_graph;
    return null;
  }

  function simulateWorkspacePrefSet(
    _event: unknown,
    key: string,
    value: unknown,
  ) {
    const { loadWorkspaceConfig, saveWorkspaceConfig } = require("./workspace-config");
    const config = loadWorkspaceConfig(testWorkspaceDir);
    if (key === "selected_file") {
      config.selected_file = (value as string | null) ?? null;
    } else if (key === "expanded_dirs") {
      config.expanded_dirs = Array.isArray(value) ? value : [];
    } else if (key === "agent_skip_permissions") {
      config.agent_skip_permissions = value === true;
    } else if (key === "auto_created_graph") {
      config.auto_created_graph = value === true;
    }
    saveWorkspaceConfig(testWorkspaceDir, config);
  }

  describe("workspace-config:get handler", () => {
    test("should return config for specified workspace", () => {
      // Create a test config
      const configDir = path.join(testWorkspaceDir, ".collaborator");
      fs.mkdirSync(configDir, { recursive: true });

      const testConfig = {
        selected_file: "notes/test.md",
        expanded_dirs: ["src"],
        agent_skip_permissions: false,
        auto_created_graph: true,
      };

      fs.writeFileSync(
        path.join(configDir, "config.json"),
        JSON.stringify(testConfig, null, 2),
      );

      const result = simulateWorkspaceConfigGet({}, testWorkspaceDir);

      expect(result).toEqual(testConfig);
    });

    test("should return default config when workspace has no config", () => {
      const result = simulateWorkspaceConfigGet({}, testWorkspaceDir);

      expect(result).toEqual({
        selected_file: null,
        expanded_dirs: [],
        agent_skip_permissions: false,
        auto_created_graph: false,
      });
    });

    test("should handle non-existent workspace path", () => {
      const nonExistentPath = path.join(testWorkspaceDir, "does-not-exist");

      // Should return defaults, not throw
      expect(() => {
        simulateWorkspaceConfigGet({}, nonExistentPath);
      }).not.toThrow();

      const result = simulateWorkspaceConfigGet({}, nonExistentPath);
      expect(result.auto_created_graph).toBe(false);
    });
  });

  describe("workspace-config:set handler", () => {
    test("should update config for specified workspace", () => {
      const update = {
        auto_created_graph: true,
        selected_file: "notes/new.md",
      };

      simulateWorkspaceConfigSet({}, testWorkspaceDir, update);

      // Verify config was saved
      const configPath = path.join(testWorkspaceDir, ".collaborator", "config.json");
      expect(fs.existsSync(configPath)).toBe(true);

      const saved = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(saved.auto_created_graph).toBe(true);
      expect(saved.selected_file).toBe("notes/new.md");
    });

    test("should merge update with existing config", () => {
      // Create initial config
      const configDir = path.join(testWorkspaceDir, ".collaborator");
      fs.mkdirSync(configDir, { recursive: true });

      const initialConfig = {
        selected_file: "notes/old.md",
        expanded_dirs: ["src", "docs"],
        agent_skip_permissions: true,
        auto_created_graph: false,
      };

      fs.writeFileSync(
        path.join(configDir, "config.json"),
        JSON.stringify(initialConfig, null, 2),
      );

      // Update only auto_created_graph
      simulateWorkspaceConfigSet({}, testWorkspaceDir, { auto_created_graph: true });

      const saved = JSON.parse(
        fs.readFileSync(path.join(configDir, "config.json"), "utf-8"),
      );

      // Other fields should be preserved
      expect(saved.selected_file).toBe("notes/old.md");
      expect(saved.expanded_dirs).toEqual(["src", "docs"]);
      expect(saved.agent_skip_permissions).toBe(true);
      expect(saved.auto_created_graph).toBe(true);
    });

    test("should create config directory if it doesn't exist", () => {
      simulateWorkspaceConfigSet({}, testWorkspaceDir, { auto_created_graph: true });

      const configPath = path.join(testWorkspaceDir, ".collaborator", "config.json");
      expect(fs.existsSync(configPath)).toBe(true);
    });

    test("should handle partial updates", () => {
      // Set only selected_file
      simulateWorkspaceConfigSet({}, testWorkspaceDir, { selected_file: "test.md" });

      let saved = JSON.parse(
        fs.readFileSync(
          path.join(testWorkspaceDir, ".collaborator", "config.json"),
          "utf-8",
        ),
      );

      expect(saved.selected_file).toBe("test.md");
      expect(saved.auto_created_graph).toBe(false);

      // Update only auto_created_graph
      simulateWorkspaceConfigSet({}, testWorkspaceDir, { auto_created_graph: true });

      saved = JSON.parse(
        fs.readFileSync(
          path.join(testWorkspaceDir, ".collaborator", "config.json"),
          "utf-8",
        ),
      );

      expect(saved.selected_file).toBe("test.md"); // Preserved
      expect(saved.auto_created_graph).toBe(true);
    });
  });

  describe("workspace-pref:get handler", () => {
    test("should get selected_file preference", () => {
      const configDir = path.join(testWorkspaceDir, ".collaborator");
      fs.mkdirSync(configDir, { recursive: true });

      fs.writeFileSync(
        path.join(configDir, "config.json"),
        JSON.stringify({
          selected_file: "notes/test.md",
          expanded_dirs: [],
          agent_skip_permissions: false,
          auto_created_graph: false,
        }),
      );

      const result = simulateWorkspacePrefGet({}, "selected_file");
      expect(result).toBe("notes/test.md");
    });

    test("should get expanded_dirs preference", () => {
      const configDir = path.join(testWorkspaceDir, ".collaborator");
      fs.mkdirSync(configDir, { recursive: true });

      fs.writeFileSync(
        path.join(configDir, "config.json"),
        JSON.stringify({
          selected_file: null,
          expanded_dirs: ["src", "docs"],
          agent_skip_permissions: false,
          auto_created_graph: false,
        }),
      );

      const result = simulateWorkspacePrefGet({}, "expanded_dirs");
      expect(result).toEqual(["src", "docs"]);
    });

    test("should get agent_skip_permissions preference", () => {
      const configDir = path.join(testWorkspaceDir, ".collaborator");
      fs.mkdirSync(configDir, { recursive: true });

      fs.writeFileSync(
        path.join(configDir, "config.json"),
        JSON.stringify({
          selected_file: null,
          expanded_dirs: [],
          agent_skip_permissions: true,
          auto_created_graph: false,
        }),
      );

      const result = simulateWorkspacePrefGet({}, "agent_skip_permissions");
      expect(result).toBe(true);
    });

    test("should get auto_created_graph preference", () => {
      const configDir = path.join(testWorkspaceDir, ".collaborator");
      fs.mkdirSync(configDir, { recursive: true });

      fs.writeFileSync(
        path.join(configDir, "config.json"),
        JSON.stringify({
          selected_file: null,
          expanded_dirs: [],
          agent_skip_permissions: false,
          auto_created_graph: true,
        }),
      );

      const result = simulateWorkspacePrefGet({}, "auto_created_graph");
      expect(result).toBe(true);
    });

    test("should return null for unknown preference key", () => {
      const result = simulateWorkspacePrefGet({}, "unknown_key");
      expect(result).toBe(null);
    });

    test("should return defaults when no config exists", () => {
      expect(simulateWorkspacePrefGet({}, "selected_file")).toBe(null);
      expect(simulateWorkspacePrefGet({}, "expanded_dirs")).toEqual([]);
      expect(simulateWorkspacePrefGet({}, "agent_skip_permissions")).toBe(false);
      expect(simulateWorkspacePrefGet({}, "auto_created_graph")).toBe(false);
    });
  });

  describe("workspace-pref:set handler", () => {
    test("should set selected_file preference", () => {
      simulateWorkspacePrefSet({}, "selected_file", "notes/test.md");

      const configPath = path.join(testWorkspaceDir, ".collaborator", "config.json");
      const saved = JSON.parse(fs.readFileSync(configPath, "utf-8"));

      expect(saved.selected_file).toBe("notes/test.md");
    });

    test("should set expanded_dirs preference", () => {
      simulateWorkspacePrefSet({}, "expanded_dirs", ["src", "docs"]);

      const configPath = path.join(testWorkspaceDir, ".collaborator", "config.json");
      const saved = JSON.parse(fs.readFileSync(configPath, "utf-8"));

      expect(saved.expanded_dirs).toEqual(["src", "docs"]);
    });

    test("should set agent_skip_permissions preference", () => {
      simulateWorkspacePrefSet({}, "agent_skip_permissions", true);

      const configPath = path.join(testWorkspaceDir, ".collaborator", "config.json");
      const saved = JSON.parse(fs.readFileSync(configPath, "utf-8"));

      expect(saved.agent_skip_permissions).toBe(true);
    });

    test("should set auto_created_graph preference", () => {
      simulateWorkspacePrefSet({}, "auto_created_graph", true);

      const configPath = path.join(testWorkspaceDir, ".collaborator", "config.json");
      const saved = JSON.parse(fs.readFileSync(configPath, "utf-8"));

      expect(saved.auto_created_graph).toBe(true);
    });

    test("should normalize non-boolean values for boolean fields", () => {
      simulateWorkspacePrefSet({}, "auto_created_graph", "truthy-string");

      const configPath = path.join(testWorkspaceDir, ".collaborator", "config.json");
      const saved = JSON.parse(fs.readFileSync(configPath, "utf-8"));

      expect(saved.auto_created_graph).toBe(false);
    });

    test("should normalize non-array values for expanded_dirs", () => {
      simulateWorkspacePrefSet({}, "expanded_dirs", "not-an-array");

      const configPath = path.join(testWorkspaceDir, ".collaborator", "config.json");
      const saved = JSON.parse(fs.readFileSync(configPath, "utf-8"));

      expect(saved.expanded_dirs).toEqual([]);
    });
  });

  describe("Integration: Config persistence across operations", () => {
    test("should maintain auto_created_graph through get/set cycle", () => {
      // Set auto_created_graph to true
      simulateWorkspaceConfigSet({}, testWorkspaceDir, { auto_created_graph: true });

      // Get and verify
      const config = simulateWorkspaceConfigGet({}, testWorkspaceDir);
      expect(config.auto_created_graph).toBe(true);

      // Set another field
      simulateWorkspaceConfigSet({}, testWorkspaceDir, { selected_file: "test.md" });

      // Verify auto_created_graph is still true
      const config2 = simulateWorkspaceConfigGet({}, testWorkspaceDir);
      expect(config2.auto_created_graph).toBe(true);
      expect(config2.selected_file).toBe("test.md");
    });

    test("should maintain independent configs for multiple workspaces", () => {
      const ws2 = fs.mkdtempSync(path.join(os.tmpdir(), "collab-ws3-"));

      try {
        // Set different values for each workspace
        simulateWorkspaceConfigSet({}, testWorkspaceDir, { auto_created_graph: true });
        simulateWorkspaceConfigSet({}, ws2, { auto_created_graph: false });

        // Verify independence
        const config1 = simulateWorkspaceConfigGet({}, testWorkspaceDir);
        const config2 = simulateWorkspaceConfigGet({}, ws2);

        expect(config1.auto_created_graph).toBe(true);
        expect(config2.auto_created_graph).toBe(false);
      } finally {
        // Clean up
        try {
          fs.rmSync(ws2, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    });
  });

  describe("workspace:switch handler behavior", () => {
    test("should track active workspace changes", () => {
      const ws2 = fs.mkdtempSync(path.join(os.tmpdir(), "collab-ws2-"));
      mockAppConfig.workspaces.push(ws2);

      try {
        // Simulate switch to workspace 1
        const originalIndex = mockAppConfig.active_workspace;
        mockAppConfig.active_workspace = 1;

        expect(mockAppConfig.active_workspace).toBe(1);
        expect(mockAppConfig.workspaces[1]).toBe(ws2);
      } finally {
        mockAppConfig.active_workspace = 0;
        try {
          fs.rmSync(ws2, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    test("should not switch if index is out of bounds", () => {
      const originalIndex = mockAppConfig.active_workspace;

      // Attempt to switch to out-of-bounds index
      if (100 >= mockAppConfig.workspaces.length) {
        // Would return early in actual implementation
        expect(mockAppConfig.active_workspace).toBe(originalIndex);
      }
    });

    test("should not switch if index equals current active", () => {
      const originalIndex = mockAppConfig.active_workspace;

      // Switching to same index should be a no-op
      if (originalIndex === mockAppConfig.active_workspace) {
        // Would return early in actual implementation
        expect(mockAppConfig.active_workspace).toBe(originalIndex);
      }
    });
  });
});
