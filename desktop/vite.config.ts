import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { searchForWorkspaceRoot } from "vite";
import { defineConfig } from "vitest/config";

const fromHere = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The pages render the web's own components and server pages
  // (web/app) so the two look and behave the same. `@/` is the web's alias.
  // The web modules that only make sense on a server (Supabase from cookies,
  // the local SQLite workspace, the filesystem, the demo cookie) get
  // stand-ins in src/web-shims/server: every query takes the web's cloud
  // branch with the user's own session, and `@/lib/queries` is the web's real
  // one. next/link, next/navigation, next/dynamic, next/image and
  // next/headers get stand-ins (src/web-shims) wired to the shell's router
  // and document.cookie. Keep the same map in tsconfig.json "paths".
  resolve: {
    alias: [
      { find: /^@\/lib\/supabase\/server$/, replacement: fromHere("./src/web-shims/server/supabase-server.ts") },
      { find: /^@\/lib\/supabase\/client$/, replacement: fromHere("./src/web-shims/server/supabase-client.ts") },
      { find: /^@\/lib\/auth$/, replacement: fromHere("./src/web-shims/server/auth.ts") },
      { find: /^@\/lib\/workspace$/, replacement: fromHere("./src/web-shims/server/workspace.ts") },
      { find: /^@\/lib\/local-queries$/, replacement: fromHere("./src/web-shims/server/local-queries.ts") },
      { find: /^@\/lib\/demo\/mode$/, replacement: fromHere("./src/web-shims/server/demo-mode.ts") },
      { find: /^@\/lib\/server-locale$/, replacement: fromHere("./src/web-shims/server/server-locale.ts") },
      { find: /^@\/lib\/position-document-file\.server$/, replacement: fromHere("./src/web-shims/server/position-document-file.ts") },
      { find: /^next\/link$/, replacement: fromHere("./src/web-shims/next-link.tsx") },
      { find: /^next\/navigation$/, replacement: fromHere("./src/web-shims/next-navigation.ts") },
      { find: /^next\/dynamic$/, replacement: fromHere("./src/web-shims/next-dynamic.tsx") },
      { find: /^next\/image$/, replacement: fromHere("./src/web-shims/next-image.tsx") },
      { find: /^next\/headers$/, replacement: fromHere("./src/web-shims/next-headers.ts") },
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
