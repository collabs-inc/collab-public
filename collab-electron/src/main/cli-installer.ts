import { app } from "electron";
import {
  copyFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { platform } from "node:os";
import {
  COLLAB_DIR,
  getCliInstallDir,
  getCliInstallPath,
  getCliExecutableName,
  getCliPathHintMarker,
} from "./paths";

function getCliSource(): string {
  const plat = platform();
  const cliScript = plat === "win32" ? "collab-cli.bat" : "collab-cli.sh";

  if (app.isPackaged) {
    return join(process.resourcesPath, cliScript);
  }
  return join(app.getAppPath(), "scripts", cliScript);
}

/**
 * Get the PATH environment variable value for the current platform.
 * Windows uses "Path" (case-insensitive), Unix uses "PATH".
 */
function getPathEnv(): string {
  const plat = platform();
  if (plat === "win32") {
    // Windows uses "Path" as the environment variable name
    return process.env["Path"] ?? process.env["PATH"] ?? "";
  }
  return process.env["PATH"] ?? "";
}

/**
 * Check if a directory is in the PATH environment variable.
 * Windows: case-insensitive comparison (Windows paths are case-insensitive)
 * Unix/Linux/macOS: case-sensitive comparison
 */
function isPathInDir(pathEnv: string, dir: string): boolean {
  const plat = platform();
  const paths = pathEnv.split(plat === "win32" ? ";" : ":");

  if (plat === "win32") {
    // Windows: case-insensitive comparison
    const normalizedDir = dir.toLowerCase();
    return paths.some((p) => p.toLowerCase() === normalizedDir);
  }

  // Unix/Linux/macOS: case-sensitive comparison
  return paths.some((p) => p === dir);
}

/**
 * Write a PATH hint message for the user.
 */
function writePathHint(installDir: string): void {
  const plat = platform();
  const hintMarker = getCliPathHintMarker();

  if (!existsSync(hintMarker)) {
    const pathEnv = getPathEnv();
    if (!isPathInDir(pathEnv, installDir)) {
      let hintMessage: string;

      if (plat === "win32") {
        hintMessage =
          `[cli-installer] collab installed to ${getCliInstallPath()}. ` +
          `Add ${installDir} to your PATH to use it from any terminal.\n\n` +
          `To add to PATH, run in PowerShell:\n` +
          `  [Environment]::SetEnvironmentVariable("PATH", "${installDir};" + [Environment]::GetEnvironmentVariable("PATH", "User"), "User")\n\n` +
          `Or add via System Properties > Environment Variables.`;
      } else {
        hintMessage =
          `[cli-installer] collab installed to ${getCliInstallPath()}. ` +
          `Add ~/.local/bin to your PATH to use it from any terminal:\n` +
          `  export PATH="$HOME/.local/bin:$PATH"`;
      }

      console.log(hintMessage);
      mkdirSync(COLLAB_DIR, { recursive: true });
      writeFileSync(hintMarker, "", "utf-8");
    }
  }
}

/**
 * Install the CLI script to the appropriate location for the current platform.
 */
export function installCli(): void {
  const source = getCliSource();

  if (!existsSync(source)) {
    console.warn("[cli-installer] CLI source not found:", source);
    return;
  }

  const installDir = getCliInstallDir();
  const installPath = getCliInstallPath();

  mkdirSync(installDir, { recursive: true });

  try {
    copyFileSync(source, installPath);
  } catch (error) {
    console.error("[cli-installer] Failed to copy CLI script:", error);
    throw new Error(`Failed to install CLI: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Set executable permissions on Unix-like systems
  const plat = platform();
  if (plat !== "win32") {
    chmodSync(installPath, 0o755);
  }

  writePathHint(installDir);
}

/**
 * Uninstall the CLI script.
 */
export function uninstallCli(): void {
  const installPath = getCliInstallPath();

  if (existsSync(installPath)) {
    const plat = platform();
    if (plat !== "win32") {
      try {
        chmodSync(installPath, 0o644);
      } catch {
        // Ignore errors when removing read-only permission
      }
    }

    try {
      rmSync(installPath, { force: true });
      console.log("[cli-installer] CLI uninstalled from:", installPath);
    } catch (error) {
      console.error("[cli-installer] Failed to uninstall CLI:", error);
    }
  }
}
