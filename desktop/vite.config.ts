import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { searchForWorkspaceRoot } from "vite";
import { defineConfig } from "vitest/config";

const fromHere = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The dashboard renders the web's own components (web/app/components) so
  // the two look the same. `@/` is the web's alias; `@/lib/queries` is the
  // one web module that needs Next, and the components only take types from
  // it, so it points at the desktop data layer that re-declares them.
  // next/link, next/navigation, next/dynamic and next/image get stand-ins
  // (src/web-shims) wired to the shell's router. Keep the same map in
  // tsconfig.json "paths".
  resolve: {
    alias: [
      { find: /^@\/lib\/queries$/, replacement: fromHere("./src/lib/dashboard-data.ts") },
      { find: /^next\/link$/, replacement: fromHere("./src/web-shims/next-link.tsx") },
      { find: /^next\/navigation$/, replacement: fromHere("./src/web-shims/next-navigation.ts") },
      { find: /^next\/dynamic$/, replacement: fromHere("./src/web-shims/next-dynamic.tsx") },
      { find: /^next\/image$/, replacement: fromHere("./src/web-shims/next-image.tsx") },
      { find: /^@\//, replacement: fromHere("../web/") },
    ],
    // A web/node_modules (present wherever the web is installed) must not
    // hand the web components a second React.
    dedupe: ["react", "react-dom"],
  },
  clearScreen: false,
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./vitest.setup.ts",
  },
  server: {
    strictPort: true,
    host: "127.0.0.1",
    port: 1420,
    // Vite serves nothing outside desktop/ by default: the reused web files
    // would answer 403 in `tauri dev`.
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), fromHere("../web")] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    // safari15, not safari13: the noVNC client of the CLOSER live screen uses
    // top-level await, which Safari (and so WKWebView on macOS) supports
    // from 15. Chrome 105 on Windows already had it.
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari15",
    // Three pages: the dashboard (where the main window opens), the local
    // team setup, and the detached live-screen window.
    rollupOptions: {
      input: {
        dashboard: fromHere("./dashboard.html"),
        main: fromHere("./index.html"),
        "live-screen": fromHere("./live-screen.html"),
      },
    },
    minify: process.env.TAURI_ENV_DEBUG ? false : "oxc",
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
});
