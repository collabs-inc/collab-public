import { defineConfig } from "electron-vite";
import { resolve } from "path";
import { readFileSync, writeFileSync, readdirSync } from "fs";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const outDir = "out";

// Vite plugin: after writing main process bundles, rewrite
// `import { app, BrowserWindow } from "electron"` to
// `import _electron from "electron"; const { app, BrowserWindow } = _electron;`
// Electron 28's Node 18 ESM loader cannot extract named exports from CJS.
function fixElectronImportsPlugin() {
  return {
    name: "fix-electron-imports",
    writeBundle(options, bundle) {
      const dir = options.dir;
      if (!dir) return;
      for (const fileName of Object.keys(bundle)) {
        if (!fileName.endsWith(".js")) continue;
        const filePath = resolve(dir, fileName);
        let code;
        try {
          code = readFileSync(filePath, "utf-8");
        } catch {
          continue;
        }
        let changed = false;
        code = code.replace(
          /^import\s*\{([^}]+)\}\s*from\s*"electron"\s*;?/gm,
          (_match, names) => {
            changed = true;
            return `import _electron from "electron";\nconst { ${names.trim()} } = _electron;`;
          },
        );
        if (changed) {
          writeFileSync(filePath, code);
          console.log(`[fix-electron-imports] Patched ${fileName}`);
        }
      }
    },
  };
}

export default defineConfig({
  main: {
    plugins: [fixElectronImportsPlugin()],
    resolve: {
      alias: {
        "@collab/shared": resolve(__dirname, "packages/shared/src"),
      },
    },
    build: {
      outDir: resolve(__dirname, outDir, "main"),
      rollupOptions: {
        external: ["node-pty", "@parcel/watcher", "typescript", "sharp"],
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
          "watcher-worker": resolve(
            __dirname,
            "src/main/watcher-worker.ts",
          ),
          "git-replay-worker": resolve(
            __dirname,
            "src/main/git-replay-worker.ts",
          ),
          "image-worker": resolve(
            __dirname,
            "src/main/image-worker.ts",
          ),
        },
      },
    },
  },
  preload: {
    build: {
      outDir: resolve(__dirname, outDir, "preload"),
      rollupOptions: {
        input: {
          universal: resolve(__dirname, "src/preload/universal.ts"),
          shell: resolve(__dirname, "src/preload/shell.ts"),
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/windows"),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@collab/shared": resolve(__dirname, "packages/shared/src"),
        "@collab/theme": resolve(__dirname, "packages/theme/src"),
        "@collab/components": resolve(
          __dirname,
          "packages/components/src",
        ),
      },
    },
    build: {
      outDir: resolve(__dirname, outDir, "renderer"),
      rollupOptions: {
        input: {
          nav: resolve(__dirname, "src/windows/nav/index.html"),
          viewer: resolve(__dirname, "src/windows/viewer/index.html"),
          terminal: resolve(__dirname, "src/windows/terminal/index.html"),
          settings: resolve(__dirname, "src/windows/settings/index.html"),
          shell: resolve(__dirname, "src/windows/shell/index.html"),
          "terminal-tile": resolve(
            __dirname,
            "src/windows/terminal-tile/index.html",
          ),
          "graph-tile": resolve(
            __dirname,
            "src/windows/graph-tile/index.html",
          ),
        },
      },
    },
  },
});
