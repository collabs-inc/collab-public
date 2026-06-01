import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const collabElectron = resolve(__dirname, "../../..");

export default defineConfig({
  root: resolve(__dirname),
  plugins: [react()],
  resolve: {
    alias: {
      "@collab/shared": resolve(collabElectron, "packages/shared/src"),
      "@collab/theme": resolve(collabElectron, "packages/theme/src"),
      "@collab/components": resolve(collabElectron, "packages/components/src"),
    },
  },
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    port: 5199,
    strictPort: true,
  },
});
