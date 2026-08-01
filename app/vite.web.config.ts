/// <reference types="vitest" />
/**
 * Vite config for the BROWSER build of Cafezin.
 *
 * The desktop/mobile builds run inside Tauri and use `vite.config.ts`
 * (unchanged). This config swaps every `@tauri-apps/*` module for a web shim
 * in `src/web/`, producing a static site that runs the same App:
 *
 * - `plugin-fs`       → OPFS-backed virtual filesystem (src/web/fs.ts)
 * - `api/core`        → invoke() rejects; convertFileSrc keeps asset://
 * - `plugin-http`     → native fetch
 * - `api/path`        → "/" virtual root
 * - `plugin-dialog`   → File System Access API folder import into OPFS
 * - `plugin-opener`   → window.open
 * - `plugin-updater`  → no-op
 * - `api/window` etc. → no-op window management
 *
 * Feature gating: all desktop-only features (git, shell, MCP, updater,
 * multi-window) already guard on isTauri, so they silently stay off in the
 * browser build. AI/auth/billing run over plain HTTP and work as-is.
 *
 * Build: `npm run build:web` → dist-web/ (host anywhere static).
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],

  base: "./",

  define: {
    __PROJECT_ROOT__: JSON.stringify("."),
  },

  resolve: {
    alias: {
      "@tauri-apps/api/core": path.resolve(__dirname, "src/web/core.ts"),
      "@tauri-apps/api/event": path.resolve(__dirname, "src/web/event.ts"),
      "@tauri-apps/api/path": path.resolve(__dirname, "src/web/path.ts"),
      "@tauri-apps/api/window": path.resolve(__dirname, "src/web/window.ts"),
      "@tauri-apps/api/webviewWindow": path.resolve(__dirname, "src/web/window.ts"),
      "@tauri-apps/api/app": path.resolve(__dirname, "src/web/app.ts"),
      "@tauri-apps/plugin-fs": path.resolve(__dirname, "src/web/fs.ts"),
      "@tauri-apps/plugin-http": path.resolve(__dirname, "src/web/http.ts"),
      "@tauri-apps/plugin-dialog": path.resolve(__dirname, "src/web/dialog.ts"),
      "@tauri-apps/plugin-opener": path.resolve(__dirname, "src/web/opener.ts"),
      "@tauri-apps/plugin-updater": path.resolve(__dirname, "src/web/updater.ts"),
      "@tauri-apps/plugin-process": path.resolve(__dirname, "src/web/process.ts"),
    },
  },

  build: {
    outDir: "dist-web",
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("node_modules/tldraw") ||
            id.includes("node_modules/@tldraw")
          ) {
            return "vendor-tldraw";
          }
          if (
            (id.includes("node_modules/@codemirror") ||
              id.includes("node_modules/@lezer")) &&
            !id.includes("node_modules/@uiw")
          ) {
            return "vendor-codemirror";
          }
          if (id.includes("node_modules/@uiw")) {
            return "vendor-codemirror-react";
          }
          if (id.includes("node_modules/katex")) {
            return "vendor-katex";
          }
          if (
            id.includes("node_modules/jspdf") ||
            id.includes("node_modules/jszip") ||
            id.includes("node_modules/html-to-image") ||
            id.includes("node_modules/html2canvas")
          ) {
            return "vendor-export";
          }
          if (id.includes("node_modules/@phosphor-icons")) {
            return "vendor-icons";
          }
        },
      },
    },
  },
});
