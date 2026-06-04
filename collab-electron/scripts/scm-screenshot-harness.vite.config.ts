import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const collabElectron = resolve(import.meta.dirname, "..");

export default defineConfig({
  root: resolve(collabElectron, "scripts/scm-screenshot-harness"),
  plugins: [react()],
  resolve: {
    alias: {
      "@collab/shared": resolve(collabElectron, "packages/shared/src"),
      "@collab/components": resolve(collabElectron, "packages/components/src"),
      "@collab/theme": resolve(collabElectron, "packages/theme/src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5199,
    strictPort: true,
  },
  build: {
    outDir: resolve(collabElectron, "scripts/scm-screenshot-harness/dist"),
    emptyOutDir: true,
  },
});
