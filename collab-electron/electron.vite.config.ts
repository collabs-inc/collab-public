import { defineConfig } from "electron-vite";
import { resolve } from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const outDir = "out";

export default defineConfig({
  main: {
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
          // Platform-specific terminal backends (dynamically loaded at runtime)
          "terminal-backend.windows": resolve(
            __dirname,
            "src/main/terminal-backend.windows.ts",
          ),
          "terminal-backend.tmux": resolve(
            __dirname,
            "src/main/terminal-backend.tmux.ts",
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
          "terminal-list": resolve(
            __dirname,
            "src/windows/terminal-list/index.html",
          ),
        },
      },
    },
  },
});
