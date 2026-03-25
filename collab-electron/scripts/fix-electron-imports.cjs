#!/usr/bin/env node
/**
 * Post-build: rewrite `import { x, y } from "electron"` to
 * `import _electron from "electron"; const { x, y } = _electron;`
 *
 * Needed on Windows because Electron 28's Node 18 ESM loader cannot
 * extract named exports from the built-in electron CJS module.
 */
const fs = require("fs");
const path = require("path");

const outDir = path.join(__dirname, "..", "out", "main");

for (const file of fs.readdirSync(outDir)) {
  if (!file.endsWith(".js")) continue;
  const filePath = path.join(outDir, file);
  let code = fs.readFileSync(filePath, "utf-8");
  let changed = false;

  // import { app, BrowserWindow, ... } from "electron";
  code = code.replace(
    /^(import\s*)\{([^}]+)\}(\s*from\s*"electron"\s*;?)/gm,
    (match, pre, names, post) => {
      changed = true;
      return `import _electron from "electron";\nconst { ${names.trim()} } = _electron;`;
    }
  );

  // import electron, { app } from "electron";
  code = code.replace(
    /^import\s+(\w+)\s*,\s*\{([^}]+)\}\s*from\s*"electron"\s*;?/gm,
    (match, def, names) => {
      changed = true;
      return `import ${def} from "electron";\nconst { ${names.trim()} } = ${def};`;
    }
  );

  if (changed) {
    fs.writeFileSync(filePath, code);
    console.log("[fix-electron-imports] Patched", file);
  }
}
