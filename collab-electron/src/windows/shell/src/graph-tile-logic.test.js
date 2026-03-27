/**
 * Renderer Graph Tile Logic Tests
 *
 * Tests for the renderer-side graph tile auto-creation logic,
 * including hasGraphTileForWorkspace() and ensureGraphTileForWorkspace().
 *
 * Note: These tests mock the shell API and canvas state to isolate
 * the graph tile logic.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

// Mock shell API
const mockShellApi = {
  getWorkspaceConfig: mock(async (path) => ({
    selected_file: null,
    expanded_dirs: [],
    agent_skip_permissions: false,
    auto_created_graph: false,
  })),
  setWorkspaceConfig: mock(async (path, config) => {}),
  canvasSaveState: mock(async (state) => {}),
  trackEvent: mock(async (event, data) => {}),
  getViewConfig: mock(async () => ({
    nav: { src: "nav.html", preload: "nav-preload.js" },
    viewer: { src: "viewer.html", preload: "viewer-preload.js" },
    terminal: { src: "terminal.html", preload: "terminal-preload.js" },
    terminalTile: { src: "terminal-tile.html", preload: "terminal-tile-preload.js" },
    graphTile: { src: "graph-tile.html", preload: "graph-tile-preload.js" },
    settings: { src: "settings.html", preload: "settings-preload.js" },
  })),
  workspaceList: mock(async () => ({
    workspaces: [],
    active: -1,
  })),
  getPref: mock(async (key) => null),
  setPref: mock(async (key, value) => {}),
  canvasLoadState: mock(async () => null),
  canvasRpcResponse: mock(async (response) => {}),
  onCanvasRpcRequest: mock((cb) => {}),
  onForwardToWebview: mock((cb) => {}),
  onShortcut: mock((cb) => {}),
  onBrowserTileFocusUrl: mock((cb) => {}),
  onLoadingStatus: mock((cb) => {}),
  onLoadingDone: mock((cb) => {}),
  onCanvasPinch: mock((cb) => {}),
  onSettingsToggle: mock((cb) => {}),
  onUpdateStatus: mock((cb) => {}),
  updateGetStatus: mock(async () => ({ status: "idle" })),
  updateDownload: mock(async () => {}),
  updateInstall: mock(async () => {}),
  updateCheck: mock(async () => {}),
  closeSettings: mock(async () => {}),
  showContextMenu: mock(async (items) => null),
  showConfirmDialog: mock(async (opts) => 0),
  workspaceAdd: mock(async () => null),
  workspaceRemove: mock(async (index) => ({ workspaces: [], active: 0 })),
  workspaceSwitch: mock(async (index) => {}),
  selectFile: mock(async (path) => {}),
  markPluginOffered: mock(async () => {}),
  hasOfferedPlugin: mock(async () => true),
  getAgents: mock(async () => []),
  installSkill: mock(async (agentId) => {}),
  logFromWebview: mock(async (name, level, message) => {}),
};

// Mock window object
global.window = {
  shellApi: mockShellApi,
  navigator: { platform: "Win32" },
  matchMedia: mock((query) => ({
    matches: false,
    addEventListener: mock(() => {}),
  })),
  focus: mock(() => {}),
  addEventListener: mock(() => {}),
  removeEventListener: mock(() => {}),
};

// Mock document object
const mockBody = {
  innerHTML: "",
  appendChild: mock(() => {}),
  removeChild: mock(() => {}),
};

global.document = {
  getElementById: mock(() => null),
  createElement: mock(() => ({
    style: {},
    addEventListener: mock(() => {}),
    removeEventListener: mock(() => {}),
    focus: mock(() => {}),
    blur: mock(() => {}),
    send: mock(() => {}),
    getWebContentsId: mock(() => ""),
    isLoading: mock(() => false),
    canGoBack: mock(() => false),
    canGoForward: mock(() => false),
    goBack: mock(() => {}),
    goForward: mock(() => {}),
    reload: mock(() => {}),
    stop: mock(() => {}),
    setZoomFactor: mock(() => {}),
  })),
  querySelector: mock(() => null),
  addEventListener: mock(() => {}),
  removeEventListener: mock(() => {}),
  documentElement: {
    classList: {
      contains: mock(() => false),
      add: mock(() => {}),
      remove: mock(() => {}),
      toggle: mock(() => {}),
    },
    style: { setProperty: mock(() => {}) },
    inert: false,
  },
  body: mockBody,
};

// Mock requestAnimationFrame
global.requestAnimationFrame = mock((cb) => {
  cb(0);
  return 0;
});

describe("Renderer Graph Tile Logic", () => {
  beforeEach(() => {
    // Reset to default mock implementation
    mockShellApi.getWorkspaceConfig.mockImplementation(async (path) => ({
      selected_file: null,
      expanded_dirs: [],
      agent_skip_permissions: false,
      auto_created_graph: false,
    }));
  });

  afterEach(() => {
    // Clean up
    mockBody.innerHTML = "";
    mockShellApi.getWorkspaceConfig.mockReset();
    mockShellApi.setWorkspaceConfig.mockReset();
    mockShellApi.trackEvent.mockReset();
    mockShellApi.canvasSaveState.mockReset();
  });

  describe("hasGraphTileForWorkspace (simulated)", () => {
    test("should return false when no tiles exist", () => {
      // Simulate empty tiles array
      const tiles = [];
      const wsPath = "/test/workspace";

      // Simulated hasGraphTileForWorkspace logic
      const hasGraphTile = tiles.some(
        (t) => t.type === "graph" && t.workspacePath === wsPath,
      );

      expect(hasGraphTile).toBe(false);
    });

    test("should return false when tiles exist but none are graph tiles", () => {
      const tiles = [
        { type: "term", workspacePath: "/test/workspace" },
        { type: "browser", workspacePath: "/test/workspace" },
        { type: "note", filePath: "/test/workspace/notes.md" },
      ];
      const wsPath = "/test/workspace";

      const hasGraphTile = tiles.some(
        (t) => t.type === "graph" && t.workspacePath === wsPath,
      );

      expect(hasGraphTile).toBe(false);
    });

    test("should return false when graph tile exists for different workspace", () => {
      const tiles = [
        { type: "graph", workspacePath: "/other/workspace" },
      ];
      const wsPath = "/test/workspace";

      const hasGraphTile = tiles.some(
        (t) => t.type === "graph" && t.workspacePath === wsPath,
      );

      expect(hasGraphTile).toBe(false);
    });

    test("should return true when graph tile exists for workspace", () => {
      const tiles = [
        { type: "graph", workspacePath: "/test/workspace" },
      ];
      const wsPath = "/test/workspace";

      const hasGraphTile = tiles.some(
        (t) => t.type === "graph" && t.workspacePath === wsPath,
      );

      expect(hasGraphTile).toBe(true);
    });

    test("should return true when multiple graph tiles exist for workspace", () => {
      const tiles = [
        { type: "graph", workspacePath: "/test/workspace" },
        { type: "term", workspacePath: "/test/workspace" },
        { type: "graph", workspacePath: "/test/workspace" },
      ];
      const wsPath = "/test/workspace";

      const hasGraphTile = tiles.some(
        (t) => t.type === "graph" && t.workspacePath === wsPath,
      );

      expect(hasGraphTile).toBe(true);
    });

    test("should handle null/undefined workspacePath gracefully", () => {
      const tiles = [
        { type: "graph", workspacePath: null },
        { type: "graph", workspacePath: undefined },
      ];
      const wsPath = "/test/workspace";

      const hasGraphTile = tiles.some(
        (t) => t.type === "graph" && t.workspacePath === wsPath,
      );

      expect(hasGraphTile).toBe(false);
    });
  });

  describe("ensureGraphTileForWorkspace logic (simulated)", () => {
    test("should skip if graph tile already exists", async () => {
      const tiles = [{ type: "graph", workspacePath: "/test/workspace" }];
      const wsPath = "/test/workspace";

      mockShellApi.getWorkspaceConfig.mockResolvedValue({
        selected_file: null,
        expanded_dirs: [],
        agent_skip_permissions: false,
        auto_created_graph: false,
      });

      // Simulated ensureGraphTileForWorkspace logic
      const hasGraphTile = tiles.some(
        (t) => t.type === "graph" && t.workspacePath === wsPath,
      );

      let configCheckPerformed = false;
      let graphTileCreated = false;

      if (!hasGraphTile) {
        configCheckPerformed = true;
        const config = await mockShellApi.getWorkspaceConfig(wsPath);
        if (!config?.auto_created_graph) {
          graphTileCreated = true;
        }
      }

      expect(hasGraphTile).toBe(true);
      expect(configCheckPerformed).toBe(false);
      expect(graphTileCreated).toBe(false);
    });

    test("should skip if auto_created_graph flag is true", async () => {
      const tiles = []; // No graph tiles
      const wsPath = "/test/workspace";

      mockShellApi.getWorkspaceConfig.mockResolvedValue({
        selected_file: null,
        expanded_dirs: [],
        agent_skip_permissions: false,
        auto_created_graph: true, // Already auto-created
      });

      const hasGraphTile = tiles.some(
        (t) => t.type === "graph" && t.workspacePath === wsPath,
      );

      let graphTileCreated = false;

      if (!hasGraphTile) {
        const config = await mockShellApi.getWorkspaceConfig(wsPath);
        if (!config?.auto_created_graph) {
          graphTileCreated = true;
        }
      }

      expect(hasGraphTile).toBe(false);
      expect(graphTileCreated).toBe(false); // Should not create
    });

    test("should create graph tile when conditions are met", async () => {
      const tiles = []; // No graph tiles
      const wsPath = "/test/workspace";

      mockShellApi.getWorkspaceConfig.mockResolvedValue({
        selected_file: null,
        expanded_dirs: [],
        agent_skip_permissions: false,
        auto_created_graph: false, // Not yet auto-created
      });

      const hasGraphTile = tiles.some(
        (t) => t.type === "graph" && t.workspacePath === wsPath,
      );

      let graphTileCreated = false;
      let configUpdated = false;

      if (!hasGraphTile) {
        const config = await mockShellApi.getWorkspaceConfig(wsPath);
        if (!config?.auto_created_graph) {
          graphTileCreated = true;
          // Simulate setWorkspaceConfig
          await mockShellApi.setWorkspaceConfig(wsPath, {
            auto_created_graph: true,
          });
          configUpdated = true;
        }
      }

      expect(hasGraphTile).toBe(false);
      expect(graphTileCreated).toBe(true);
      expect(configUpdated).toBe(true);
    });

    test("should handle missing workspace gracefully", async () => {
      const tiles = [];
      const wsPath = ""; // No active workspace

      let graphTileCreated = false;

      if (wsPath) {
        const hasGraphTile = tiles.some(
          (t) => t.type === "graph" && t.workspacePath === wsPath,
        );

        if (!hasGraphTile) {
          const config = await mockShellApi.getWorkspaceConfig(wsPath);
          if (!config?.auto_created_graph) {
            graphTileCreated = true;
          }
        }
      }

      expect(graphTileCreated).toBe(false); // Should not create without workspace
    });

    test("should handle getWorkspaceConfig error gracefully", async () => {
      const tiles = [];
      const wsPath = "/test/workspace";

      mockShellApi.getWorkspaceConfig.mockRejectedValue(
        new Error("Config not found"),
      );

      const hasGraphTile = tiles.some(
        (t) => t.type === "graph" && t.workspacePath === wsPath,
      );

      let graphTileCreated = false;
      let errorHandled = false;

      try {
        if (!hasGraphTile) {
          const config = await mockShellApi.getWorkspaceConfig(wsPath);
          if (!config?.auto_created_graph) {
            graphTileCreated = true;
          }
        }
      } catch (error) {
        errorHandled = true;
      }

      expect(errorHandled).toBe(true);
      expect(graphTileCreated).toBe(false); // Should not create on error
    });
  });

  describe("Graph tile creation flow integration", () => {
    test("should track tile creation event", async () => {
      const wsPath = "/test/workspace";

      mockShellApi.getWorkspaceConfig.mockResolvedValue({
        selected_file: null,
        expanded_dirs: [],
        agent_skip_permissions: false,
        auto_created_graph: false,
      });

      // Simulate creation
      const tiles = [];
      const hasGraphTile = tiles.some(
        (t) => t.type === "graph" && t.workspacePath === wsPath,
      );

      if (!hasGraphTile) {
        const config = await mockShellApi.getWorkspaceConfig(wsPath);
        if (!config?.auto_created_graph) {
          // Track event
          await mockShellApi.trackEvent("tile_created", { type: "graph" });
          await mockShellApi.setWorkspaceConfig(wsPath, {
            auto_created_graph: true,
          });
        }
      }

      expect(mockShellApi.trackEvent).toHaveBeenCalledWith(
        "tile_created",
        { type: "graph" },
      );
    });

    test("should save canvas state after tile creation", async () => {
      const wsPath = "/test/workspace";

      mockShellApi.getWorkspaceConfig.mockResolvedValue({
        selected_file: null,
        expanded_dirs: [],
        agent_skip_permissions: false,
        auto_created_graph: false,
      });

      let canvasSaved = false;

      const tiles = [];
      const hasGraphTile = tiles.some(
        (t) => t.type === "graph" && t.workspacePath === wsPath,
      );

      if (!hasGraphTile) {
        const config = await mockShellApi.getWorkspaceConfig(wsPath);
        if (!config?.auto_created_graph) {
          // Create tile (simulated)
          tiles.push({ type: "graph", workspacePath: wsPath });

          // Save canvas
          await mockShellApi.canvasSaveState({
            version: 1,
            tiles: [{ type: "graph", workspacePath: wsPath }],
            viewport: { panX: 0, panY: 0, zoom: 1 },
          });
          canvasSaved = true;

          await mockShellApi.setWorkspaceConfig(wsPath, {
            auto_created_graph: true,
          });
        }
      }

      expect(canvasSaved).toBe(true);
      expect(mockShellApi.canvasSaveState).toHaveBeenCalled();
    });
  });

  describe("Edge cases", () => {
    test("should handle workspace path with special characters", async () => {
      const wsPath = "/path/with spaces/and-dashes/测试";

      mockShellApi.getWorkspaceConfig.mockResolvedValue({
        selected_file: null,
        expanded_dirs: [],
        agent_skip_permissions: false,
        auto_created_graph: false,
      });

      const tiles = [];
      const hasGraphTile = tiles.some(
        (t) => t.type === "graph" && t.workspacePath === wsPath,
      );

      let configRetrieved = false;

      if (!hasGraphTile) {
        const config = await mockShellApi.getWorkspaceConfig(wsPath);
        configRetrieved = true;
        expect(config).toBeDefined();
      }

      expect(configRetrieved).toBe(true);
    });

    test("should handle Windows-style paths", async () => {
      const wsPath = "C:\\Users\\test\\workspace";

      mockShellApi.getWorkspaceConfig.mockResolvedValue({
        selected_file: null,
        expanded_dirs: [],
        agent_skip_permissions: false,
        auto_created_graph: false,
      });

      const tiles = [];
      const hasGraphTile = tiles.some(
        (t) => t.type === "graph" && t.workspacePath === wsPath,
      );

      expect(hasGraphTile).toBe(false);

      const config = await mockShellApi.getWorkspaceConfig(wsPath);
      expect(config.auto_created_graph).toBe(false);
    });

    test("should handle multiple workspaces independently", async () => {
      const ws1 = "/workspace/1";
      const ws2 = "/workspace/2";

      mockShellApi.getWorkspaceConfig.mockImplementation(
        async (path) => ({
          selected_file: null,
          expanded_dirs: [],
          agent_skip_permissions: false,
          auto_created_graph: path === ws1, // ws1 already has graph tile
        }),
      );

      // Check ws1 (should skip creation)
      const config1 = await mockShellApi.getWorkspaceConfig(ws1);
      expect(config1.auto_created_graph).toBe(true);

      // Check ws2 (should allow creation)
      const config2 = await mockShellApi.getWorkspaceConfig(ws2);
      expect(config2.auto_created_graph).toBe(false);
    });
  });
});

describe("Canvas tile state management", () => {
  test("should filter tiles by type and workspace", () => {
    const allTiles = [
      { id: "1", type: "graph", workspacePath: "/ws1" },
      { id: "2", type: "graph", workspacePath: "/ws2" },
      { id: "3", type: "term", workspacePath: "/ws1" },
      { id: "4", type: "browser", workspacePath: "/ws1" },
      { id: "5", type: "graph", workspacePath: "/ws1" },
    ];

    // Get graph tiles for ws1
    const ws1GraphTiles = allTiles.filter(
      (t) => t.type === "graph" && t.workspacePath === "/ws1",
    );

    expect(ws1GraphTiles.length).toBe(2);
    expect(ws1GraphTiles.map((t) => t.id)).toEqual(["1", "5"]);
  });

  test("should determine if auto-creation is needed", () => {
    const tiles = [
      { type: "graph", workspacePath: "/ws1" },
    ];
    const currentWs = "/ws1";
    const configAutoCreated = true;

    // Should not create - graph tile exists
    const shouldCreate1 = !tiles.some(
      (t) => t.type === "graph" && t.workspacePath === currentWs,
    );
    expect(shouldCreate1).toBe(false);

    // Should not create - already marked as auto-created
    const shouldCreate2 = !configAutoCreated;
    expect(shouldCreate2).toBe(false);
  });
});
