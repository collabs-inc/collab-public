/**
 * Workspace Config Tests
 *
 * Tests for workspace configuration management, focusing on the
 * auto_created_graph flag and related functionality.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// Import the workspace-config module
const {
  loadWorkspaceConfig,
  saveWorkspaceConfig,
  workspaceConfigPath,
} = await import("./workspace-config");

// Test workspace directory
let testWorkspaceDir: string;
let testConfigPath: string;

describe("Workspace Config", () => {
  beforeEach(() => {
    // Create temporary test workspace
    testWorkspaceDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "collab-ws-test-"),
    );
    testConfigPath = path.join(
      testWorkspaceDir,
      ".collaborator",
      "config.json",
    );
  });

  afterEach(() => {
    // Clean up test workspace
    try {
      fs.rmSync(testWorkspaceDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("loadWorkspaceConfig", () => {
    test("should return default config when no config file exists", () => {
      const config = loadWorkspaceConfig(testWorkspaceDir);

      expect(config).toEqual({
        selected_file: null,
        expanded_dirs: [],
        agent_skip_permissions: false,
        auto_created_graph: false,
      });
    });

    test("should load existing config with all fields", () => {
      // Create config file
      const configDir = path.dirname(testConfigPath);
      fs.mkdirSync(configDir, { recursive: true });

      const testConfig = {
        selected_file: "notes/test.md",
        expanded_dirs: ["src", "docs"],
        agent_skip_permissions: true,
        auto_created_graph: true,
      };

      fs.writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

      const loaded = loadWorkspaceConfig(testWorkspaceDir);

      expect(loaded).toEqual(testConfig);
    });

    test("should handle missing auto_created_graph field (backward compat)", () => {
      const configDir = path.dirname(testConfigPath);
      fs.mkdirSync(configDir, { recursive: true });

      // Config without auto_created_graph field
      const testConfig = {
        selected_file: null,
        expanded_dirs: [],
        agent_skip_permissions: false,
      };

      fs.writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

      const loaded = loadWorkspaceConfig(testWorkspaceDir);

      // Should default to false when missing
      expect(loaded.auto_created_graph).toBe(false);
      expect(loaded.selected_file).toBe(null);
      expect(loaded.expanded_dirs).toEqual([]);
    });

    test("should handle partial config (missing fields)", () => {
      const configDir = path.dirname(testConfigPath);
      fs.mkdirSync(configDir, { recursive: true });

      // Partial config with only selected_file
      const testConfig = {
        selected_file: "notes/test.md",
      };

      fs.writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

      const loaded = loadWorkspaceConfig(testWorkspaceDir);

      expect(loaded).toEqual({
        selected_file: "notes/test.md",
        expanded_dirs: [],
        agent_skip_permissions: false,
        auto_created_graph: false,
      });
    });

    test("should handle invalid JSON gracefully", () => {
      const configDir = path.dirname(testConfigPath);
      fs.mkdirSync(configDir, { recursive: true });

      fs.writeFileSync(testConfigPath, "invalid json {{{");

      const loaded = loadWorkspaceConfig(testWorkspaceDir);

      // Should return defaults on parse error
      expect(loaded).toEqual({
        selected_file: null,
        expanded_dirs: [],
        agent_skip_permissions: false,
        auto_created_graph: false,
      });
    });

    test("should handle non-object JSON values", () => {
      const configDir = path.dirname(testConfigPath);
      fs.mkdirSync(configDir, { recursive: true });

      fs.writeFileSync(testConfigPath, '"just a string"');

      const loaded = loadWorkspaceConfig(testWorkspaceDir);

      // Should return defaults
      expect(loaded).toEqual({
        selected_file: null,
        expanded_dirs: [],
        agent_skip_permissions: false,
        auto_created_graph: false,
      });
    });

    test("should normalize expanded_dirs to empty array if not an array", () => {
      const configDir = path.dirname(testConfigPath);
      fs.mkdirSync(configDir, { recursive: true });

      const testConfig = {
        expanded_dirs: "not-an-array",
      };

      fs.writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

      const loaded = loadWorkspaceConfig(testWorkspaceDir);

      expect(loaded.expanded_dirs).toEqual([]);
    });

    test("should normalize agent_skip_permissions to boolean", () => {
      const configDir = path.dirname(testConfigPath);
      fs.mkdirSync(configDir, { recursive: true });

      const testConfig = {
        agent_skip_permissions: "truthy-string",
      };

      fs.writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

      const loaded = loadWorkspaceConfig(testWorkspaceDir);

      expect(loaded.agent_skip_permissions).toBe(false);
    });

    test("should normalize auto_created_graph to boolean", () => {
      const configDir = path.dirname(testConfigPath);
      fs.mkdirSync(configDir, { recursive: true });

      const testConfig = {
        auto_created_graph: "truthy-string",
      };

      fs.writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

      const loaded = loadWorkspaceConfig(testWorkspaceDir);

      expect(loaded.auto_created_graph).toBe(false);
    });
  });

  describe("saveWorkspaceConfig", () => {
    test("should save config to correct path", () => {
      const config: {
        selected_file: string | null;
        expanded_dirs: string[];
        agent_skip_permissions: boolean;
        auto_created_graph: boolean;
      } = {
        selected_file: "notes/test.md",
        expanded_dirs: ["src"],
        agent_skip_permissions: false,
        auto_created_graph: true,
      };

      saveWorkspaceConfig(testWorkspaceDir, config);

      expect(fs.existsSync(testConfigPath)).toBe(true);

      const content = fs.readFileSync(testConfigPath, "utf-8");
      const saved = JSON.parse(content);

      expect(saved).toEqual(config);
    });

    test("should create .collaborator directory if it doesn't exist", () => {
      const config = {
        selected_file: null,
        expanded_dirs: [],
        agent_skip_permissions: false,
        auto_created_graph: false,
      };

      const newWorkspaceDir = path.join(
        testWorkspaceDir,
        "new-workspace",
      );

      saveWorkspaceConfig(newWorkspaceDir, config);

      const expectedConfigPath = path.join(
        newWorkspaceDir,
        ".collaborator",
        "config.json",
      );

      expect(fs.existsSync(expectedConfigPath)).toBe(true);
    });

    test("should save auto_created_graph flag correctly", () => {
      const configTrue = {
        selected_file: null,
        expanded_dirs: [],
        agent_skip_permissions: false,
        auto_created_graph: true,
      };

      saveWorkspaceConfig(testWorkspaceDir, configTrue);

      let content = fs.readFileSync(testConfigPath, "utf-8");
      let saved = JSON.parse(content);

      expect(saved.auto_created_graph).toBe(true);

      // Update to false
      const configFalse = {
        ...configTrue,
        auto_created_graph: false,
      };

      saveWorkspaceConfig(testWorkspaceDir, configFalse);

      content = fs.readFileSync(testConfigPath, "utf-8");
      saved = JSON.parse(content);

      expect(saved.auto_created_graph).toBe(false);
    });

    test("should write valid JSON format", () => {
      const config = {
        selected_file: "notes/test.md",
        expanded_dirs: ["src", "docs"],
        agent_skip_permissions: true,
        auto_created_graph: true,
      };

      saveWorkspaceConfig(testWorkspaceDir, config);

      const content = fs.readFileSync(testConfigPath, "utf-8");

      // Should be valid JSON
      expect(() => JSON.parse(content)).not.toThrow();

      // Should be pretty-printed (contains newlines)
      expect(content).toContain("\n");
    });

    test("should persist all config fields together", () => {
      const config = {
        selected_file: "path/to/file.md",
        expanded_dirs: ["dir1", "dir2", "dir3"],
        agent_skip_permissions: true,
        auto_created_graph: true,
      };

      saveWorkspaceConfig(testWorkspaceDir, config);

      const loaded = loadWorkspaceConfig(testWorkspaceDir);

      expect(loaded).toEqual(config);
    });
  });

  describe("workspaceConfigPath", () => {
    test("should return correct path for workspace", () => {
      const wsPath = "/path/to/workspace";
      const expected = path.join(wsPath, ".collaborator", "config.json");

      expect(workspaceConfigPath(wsPath)).toBe(expected);
    });

    test("should handle Windows-style paths", () => {
      const wsPath = "C:\\Users\\test\\workspace";
      const expected = path.join(wsPath, ".collaborator", "config.json");

      expect(workspaceConfigPath(wsPath)).toBe(expected);
    });
  });

  describe("auto_created_graph flag integration", () => {
    test("should track graph tile auto-creation state", () => {
      // Initial state - no auto-creation
      let config = loadWorkspaceConfig(testWorkspaceDir);
      expect(config.auto_created_graph).toBe(false);

      // Simulate auto-creation
      config.auto_created_graph = true;
      saveWorkspaceConfig(testWorkspaceDir, config);

      // Verify persistence
      config = loadWorkspaceConfig(testWorkspaceDir);
      expect(config.auto_created_graph).toBe(true);
    });

    test("should be independent per workspace", () => {
      const ws1 = path.join(testWorkspaceDir, "workspace1");
      const ws2 = path.join(testWorkspaceDir, "workspace2");

      // Set different values for each workspace
      const config1 = {
        selected_file: null,
        expanded_dirs: [],
        agent_skip_permissions: false,
        auto_created_graph: true,
      };

      const config2 = {
        selected_file: null,
        expanded_dirs: [],
        agent_skip_permissions: false,
        auto_created_graph: false,
      };

      saveWorkspaceConfig(ws1, config1);
      saveWorkspaceConfig(ws2, config2);

      // Verify independence
      expect(loadWorkspaceConfig(ws1).auto_created_graph).toBe(true);
      expect(loadWorkspaceConfig(ws2).auto_created_graph).toBe(false);
    });
  });
});
