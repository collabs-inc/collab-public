#!/usr/bin/env node
/**
 * Launch electron-vite dev with ELECTRON_RUN_AS_NODE fully removed.
 * cross-env sets it to "" which Electron 28 still treats as "set".
 * We need to completely delete it from the environment.
 */
const { spawn } = require("child_process");

// Remove the variable entirely
delete process.env.ELECTRON_RUN_AS_NODE;

const child = spawn(
  "npx",
  ["electron-vite", "dev"],
  {
    stdio: "inherit",
    shell: true,
    env: process.env,
    cwd: __dirname + "/..",
  },
);

child.on("exit", (code) => process.exit(code || 0));
