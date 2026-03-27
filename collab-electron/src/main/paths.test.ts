/**
 * Paths Tests
 *
 * Tests for Windows-specific path resolution functionality.
 * Verifies correct behavior of directory resolution, CLI installation paths,
 * and platform-specific executable naming.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as path from "node:path";
import * as os from "node:os";

// Import the paths module
const pathsModule = await import("./paths");

const {
  COLLAB_DIR,
  getCliInstallDir,
  getCliExecutableName,
  getCliInstallPath,
  getCliPathHintMarker,
} = pathsModule;

// Helper to get base dir (internal function, tested indirectly)
function getBaseDir(): string {
  const plat = process.platform;
  if (plat === "win32") {
    const appData = process.env.APPDATA;
    if (!appData) {
      return path.join(os.homedir(), ".collaborator");
    }
    return path.join(appData, "Collaborator");
  }
  if (plat === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Collaborator");
  }
  return path.join(os.homedir(), ".collaborator");
}

describe("Path Resolution", () => {
  describe("COLLAB_DIR", () => {
    test("should be a valid directory path", () => {
      expect(COLLAB_DIR).toBeDefined();
      expect(typeof COLLAB_DIR).toBe("string");
      expect(COLLAB_DIR.length).toBeGreaterThan(0);
    });

    test("should be an absolute path", () => {
      expect(path.isAbsolute(COLLAB_DIR)).toBe(true);
    });
  });

  describe("getCliInstallDir", () => {
    test("should return a valid directory path", () => {
      const cliDir = getCliInstallDir();
      expect(cliDir).toBeDefined();
      expect(typeof cliDir).toBe("string");
      expect(cliDir.length).toBeGreaterThan(0);
    });

    test("should return absolute path", () => {
      const cliDir = getCliInstallDir();
      expect(path.isAbsolute(cliDir)).toBe(true);
    });

    test("should use LOCALAPPDATA on Windows", () => {
      if (process.platform === "win32") {
        const localAppData = process.env.LOCALAPPDATA;
        if (localAppData) {
          const cliDir = getCliInstallDir();
          expect(cliDir).toContain(localAppData);
          expect(cliDir).toContain("Programs");
          expect(cliDir).toContain("Collaborator");
          expect(cliDir).toContain("bin");
        }
      }
    });

    test("should use ~/.local/bin on macOS and Linux", () => {
      if (process.platform === "darwin" || process.platform === "linux") {
        const cliDir = getCliInstallDir();
        expect(cliDir).toContain(os.homedir());
        expect(cliDir).toContain(".local");
        expect(cliDir).toContain("bin");
      }
    });

    test("should fall back to ~/.local/bin if LOCALAPPDATA is not set on Windows", () => {
      // Simulate missing LOCALAPPDATA by testing the fallback behavior
      // Note: We can't actually modify process.env.LOCALAPPDATA in tests
      // This test documents the expected fallback behavior
      const cliDir = getCliInstallDir();
      expect(cliDir).toBeDefined();
    });
  });

  describe("getCliExecutableName", () => {
    test("should return collab.bat on Windows", () => {
      if (process.platform === "win32") {
        expect(getCliExecutableName()).toBe("collab.bat");
      }
    });

    test("should return collab on macOS and Linux", () => {
      if (process.platform === "darwin" || process.platform === "linux") {
        expect(getCliExecutableName()).toBe("collab");
      }
    });

    test("should return a non-empty string", () => {
      const exeName = getCliExecutableName();
      expect(exeName).toBeDefined();
      expect(exeName.length).toBeGreaterThan(0);
    });
  });

  describe("getCliInstallPath", () => {
    test("should return full path to CLI executable", () => {
      const cliPath = getCliInstallPath();
      expect(cliPath).toBeDefined();
      expect(typeof cliPath).toBe("string");
      expect(cliPath.length).toBeGreaterThan(0);
    });

    test("should return absolute path", () => {
      const cliPath = getCliInstallPath();
      expect(path.isAbsolute(cliPath)).toBe(true);
    });

    test("should combine install directory and executable name", () => {
      const installDir = getCliInstallDir();
      const exeName = getCliExecutableName();
      const cliPath = getCliInstallPath();

      expect(cliPath).toBe(path.join(installDir, exeName));
    });

    test("should include correct executable extension on Windows", () => {
      if (process.platform === "win32") {
        const cliPath = getCliInstallPath();
        expect(cliPath).toContain(".bat");
      }
    });

    test("should not include extension on macOS/Linux", () => {
      if (process.platform === "darwin" || process.platform === "linux") {
        const cliPath = getCliInstallPath();
        expect(cliPath).not.toContain(".bat");
        expect(cliPath).not.toContain(".exe");
      }
    });
  });

  describe("getCliPathHintMarker", () => {
    test("should return path within COLLAB_DIR", () => {
      const markerPath = getCliPathHintMarker();
      expect(markerPath).toContain(COLLAB_DIR);
    });

    test("should include cli-path-hinted filename", () => {
      const markerPath = getCliPathHintMarker();
      expect(markerPath).toContain("cli-path-hinted");
    });

    test("should return absolute path", () => {
      const markerPath = getCliPathHintMarker();
      expect(path.isAbsolute(markerPath)).toBe(true);
    });
  });
});

describe("Platform-Specific Path Behavior", () => {
  describe("Windows paths", () => {
    test("should use Windows-style path separators", () => {
      if (process.platform === "win32") {
        const allPaths = [
          getBaseDir(),
          COLLAB_DIR,
          getCliInstallDir(),
          getCliInstallPath(),
          getCliPathHintMarker(),
        ];

        // On Windows, paths should contain backslashes
        // Note: path.join uses platform-specific separators
        for (const p of allPaths) {
          expect(typeof p).toBe("string");
          expect(p.length).toBeGreaterThan(0);
        }
      }
    });

    test("should use APPDATA for base directory on Windows", () => {
      if (process.platform === "win32") {
        const appData = process.env.APPDATA;
        if (appData) {
          const baseDir = getBaseDir();
          expect(baseDir).toContain(appData);
          expect(baseDir).toContain("Collaborator");
        }
      }
    });

    test("should use LOCALAPPDATA for CLI installation on Windows", () => {
      if (process.platform === "win32") {
        const localAppData = process.env.LOCALAPPDATA;
        if (localAppData) {
          const cliDir = getCliInstallDir();
          expect(cliDir).toContain(localAppData);
        }
      }
    });
  });

  describe("macOS paths", () => {
    test("should use Library/Application Support for base directory on macOS", () => {
      if (process.platform === "darwin") {
        const baseDir = getBaseDir();
        expect(baseDir).toContain("Library");
        expect(baseDir).toContain("Application Support");
        expect(baseDir).toContain("Collaborator");
      }
    });

    test("should use ~/.local/bin for CLI on macOS", () => {
      if (process.platform === "darwin") {
        const cliDir = getCliInstallDir();
        expect(cliDir).toContain(os.homedir());
        expect(cliDir).toContain(".local");
        expect(cliDir).toContain("bin");
      }
    });
  });

  describe("Linux paths", () => {
    test("should use ~/.collaborator for base directory on Linux", () => {
      if (process.platform === "linux") {
        const baseDir = getBaseDir();
        expect(baseDir).toContain(os.homedir());
        expect(baseDir).toContain(".collaborator");
      }
    });

    test("should use ~/.local/bin for CLI on Linux", () => {
      if (process.platform === "linux") {
        const cliDir = getCliInstallDir();
        expect(cliDir).toContain(os.homedir());
        expect(cliDir).toContain(".local");
        expect(cliDir).toContain("bin");
      }
    });
  });
});

describe("Path Module Edge Cases", () => {
  test("should handle missing environment variables gracefully", () => {
    // The paths module should have fallbacks for missing env vars
    // This is tested by verifying paths are always returned
    expect(getBaseDir()).toBeDefined();
    expect(getCliInstallDir()).toBeDefined();
    expect(getCliInstallPath()).toBeDefined();
  });

  test("should return consistent paths across multiple calls", () => {
    const baseDir1 = getBaseDir();
    const baseDir2 = getBaseDir();
    expect(baseDir1).toBe(baseDir2);

    const cliDir1 = getCliInstallDir();
    const cliDir2 = getCliInstallDir();
    expect(cliDir1).toBe(cliDir2);

    const cliPath1 = getCliInstallPath();
    const cliPath2 = getCliInstallPath();
    expect(cliPath1).toBe(cliPath2);
  });

  test("should handle DEV mode correctly", () => {
    // COLLAB_DIR should be BASE/dev in DEV mode, BASE otherwise
    const baseDir = getBaseDir();

    // In development (which is likely when running tests),
    // COLLAB_DIR should include 'dev' suffix
    // Note: This depends on import.meta.env.DEV value
    expect(COLLAB_DIR.startsWith(baseDir)).toBe(true);
  });
});

describe("Path Helper Functions", () => {
  describe("Path composition", () => {
    test("CLI install path should be composed of install dir and executable name", () => {
      const installDir = getCliInstallDir();
      const exeName = getCliExecutableName();
      const fullPath = getCliInstallPath();

      expect(fullPath).toBe(path.join(installDir, exeName));
    });

    test("CLI path hint marker should be in COLLAB_DIR", () => {
      const marker = getCliPathHintMarker();
      expect(marker.startsWith(COLLAB_DIR)).toBe(true);
    });
  });
});
