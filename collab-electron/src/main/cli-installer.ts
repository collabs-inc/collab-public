/**
 * CLI installer — cross-platform.
 *
 * - Windows: copies collab-cli.cmd to %LOCALAPPDATA%\Collaborator\bin\
 * - macOS/Linux: copies collab-cli.sh to ~/.local/bin/ with 0o755 perms
 */

import { app } from "electron";
import {
  copyFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const IS_WIN = process.platform === "win32";

const INSTALL_DIR = IS_WIN
  ? join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Collaborator", "bin")
  : join(homedir(), ".local", "bin");

const CLI_NAME = IS_WIN ? "collab.cmd" : "collab";
const INSTALL_PATH = join(INSTALL_DIR, CLI_NAME);

const COLLAB_DIR = join(homedir(), ".collaborator");
const HINT_MARKER = join(COLLAB_DIR, "cli-path-hinted");

function getCliSource(): string {
  const ext = IS_WIN ? "collab-cli.cmd" : "collab-cli.sh";
  if (app.isPackaged) {
    return join(process.resourcesPath, ext);
  }
  return join(app.getAppPath(), "scripts", ext);
}

export function installCli(): void {
  const source = getCliSource();
  if (!existsSync(source)) {
    console.warn(
      "[cli-installer] CLI source not found:", source,
    );
    return;
  }

  mkdirSync(INSTALL_DIR, { recursive: true });
  copyFileSync(source, INSTALL_PATH);

  if (!IS_WIN) {
    chmodSync(INSTALL_PATH, 0o755);
  }

  if (!existsSync(HINT_MARKER)) {
    const pathEnv = process.env["PATH"] ?? "";
    const separator = IS_WIN ? ";" : ":";
    if (!pathEnv.split(separator).includes(INSTALL_DIR)) {
      if (IS_WIN) {
        console.log(
          `[cli-installer] collab installed to ${INSTALL_PATH}. ` +
          `Add the following to your PATH to use it from any terminal:\n` +
          `  ${INSTALL_DIR}`,
        );
      } else {
        console.log(
          `[cli-installer] collab installed to ${INSTALL_PATH}. ` +
          `Add ~/.local/bin to your PATH to use it from any terminal:\n` +
          `  export PATH="$HOME/.local/bin:$PATH"`,
        );
      }
      mkdirSync(COLLAB_DIR, { recursive: true });
      writeFileSync(HINT_MARKER, "", "utf-8");
    }
  }
}
