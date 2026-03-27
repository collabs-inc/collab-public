import { join } from "node:path";
import { homedir, platform } from "node:os";

/**
 * Get the base directory for application data based on platform.
 * Windows: Uses APPDATA for roaming app data
 * macOS: Uses ~/Library/Application Support
 * Linux/Unix: Uses ~/.collaborator
 */
function getBaseDir(): string {
  const plat = platform();

  if (plat === "win32") {
    // Windows: Use APPDATA for roaming application data
    const appData = process.env.APPDATA;
    if (!appData) {
      // Fallback to homedir if APPDATA is not set
      return join(homedir(), ".collaborator");
    }
    return join(appData, "Collaborator");
  }

  if (plat === "darwin") {
    // macOS: Use standard Application Support directory
    return join(homedir(), "Library", "Application Support", "Collaborator");
  }

  // Linux and other Unix-like systems
  return join(homedir(), ".collaborator");
}

const BASE = getBaseDir();

export const COLLAB_DIR = import.meta.env.DEV ? join(BASE, "dev") : BASE;

/**
 * Get the platform-specific directory name for CLI installation.
 * Windows: LOCALAPPDATA/Programs/Collaborator/bin
 * macOS/Linux: ~/.local/bin
 */
export function getCliInstallDir(): string {
  const plat = platform();

  if (plat === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      return join(localAppData, "Programs", "Collaborator", "bin");
    }
    // Fallback
    return join(homedir(), ".local", "bin");
  }

  // macOS and Linux
  return join(homedir(), ".local", "bin");
}

/**
 * Get the platform-specific CLI executable name.
 * Windows: collab.bat (wrapper script)
 * macOS/Linux: collab (shell script)
 */
export function getCliExecutableName(): string {
  const plat = platform();
  return plat === "win32" ? "collab.bat" : "collab";
}

/**
 * Get the full path to the CLI installation file.
 */
export function getCliInstallPath(): string {
  return join(getCliInstallDir(), getCliExecutableName());
}

/**
 * Get the CLI path hint marker file path.
 */
export function getCliPathHintMarker(): string {
  return join(COLLAB_DIR, "cli-path-hinted");
}
