/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// Project root (parent of this app/ dir) — embedded at build time so the
// in-app Update button knows where to find the source.
// @ts-expect-error process is a nodejs global
const projectRoot = path.resolve(process.cwd(), "..");

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/__tests__/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/vite-env.d.ts'],
    },
  },

  define: {
    // Makes __PROJECT_ROOT__ available in all frontend files
    __PROJECT_ROOT__: JSON.stringify(projectRoot),
  },

  build: {
    modulePreload: {
      resolveDependencies(_filename, deps, context) {
        if (context.hostType !== 'html') return deps;
        return deps.filter((dep) =>
          !dep.includes('vendor-export') &&
          !dep.includes('vendor-katex')
        );
      },
    },
    // Tauri desktop app — chunks load from disk, not network.
    // CodeMirror and PDF export are split from the writing workspace.
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // CodeMirror editor stack — @uiw/react-codemirror must NOT be here
          // because it depends on React; mixing it into vendor-codemirror causes
          // the chunk to execute before vendor-react, leaving React undefined.
          if ((id.includes('node_modules/@codemirror') ||
               id.includes('node_modules/@lezer')) &&
              !id.includes('node_modules/@uiw')) {
            return 'vendor-codemirror';
          }
          // React-CodeMirror wrapper (depends on both vendor-react + vendor-codemirror)
          if (id.includes('node_modules/@uiw')) {
            return 'vendor-codemirror-react';
          }
          // React core — NOT split into its own chunk.
          // Keeping React in the main entry bundle guarantees it executes
          // before any vendor chunk that calls React.createContext / forwardRef.
          // (Splitting it into vendor-react caused load-order crashes in WebKit.)
          // Tauri plugins
          if (id.includes('node_modules/@tauri-apps')) {
            return 'vendor-tauri';
          }
          // Markdown / front-matter helpers
          if (id.includes('node_modules/marked') ||
              id.includes('node_modules/gray-matter') ||
              id.includes('node_modules/js-yaml')) {
            return 'vendor-content';
          }
          // KaTeX — math rendering
          if (id.includes('node_modules/katex')) {
            return 'vendor-katex';
          }
          // PDF / ZIP / canvas-capture utilities
          if (id.includes('node_modules/jspdf') ||
              id.includes('node_modules/jszip') ||
              id.includes('node_modules/html2canvas')) {
            return 'vendor-export';
          }
          // Icon library
          if (id.includes('node_modules/@phosphor-icons')) {
            return 'vendor-icons';
          }
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1430,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1431,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
