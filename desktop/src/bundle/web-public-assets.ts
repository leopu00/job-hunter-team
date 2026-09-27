import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/**
 * Files of web/public that the web code running in the desktop asks for by
 * absolute path. Next serves web/public at the site root; the desktop's
 * public folder is desktop/public, so without this a request for
 * /agents/capitano.png fell through to the page (index HTML, 200
 * text/html) and the chat showed a broken image.
 *
 * The chat portraits of web/lib/message-display.ts (AGENT_META.avatar):
 * web-public-assets.test.ts fails when that list and this one part ways.
 */
export const WEB_PUBLIC_FILES = ["agents/capitano.png", "agents/mentor.png", "agents/assistente.png"];

const webPublic = (file: string) => fileURLToPath(new URL(`../../../web/public/${file}`, import.meta.url));

const TYPES: Record<string, string> = { png: "image/png", svg: "image/svg+xml", jpg: "image/jpeg", webp: "image/webp" };

/**
 * Serves those files at the same path in dev and emits them into the build,
 * read from web/public every time: nothing copied into desktop/ to drift. A
 * missing file fails the build instead of shipping a broken image.
 */
export function webPublicAssets(files: string[] = WEB_PUBLIC_FILES): Plugin {
  return {
    name: "jht-web-public-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = files.find((f) => req.url?.split("?")[0] === `/${f}`);
        if (!file) return next();
        res.setHeader("Content-Type", TYPES[file.split(".").pop() ?? ""] ?? "application/octet-stream");
        res.end(readFileSync(webPublic(file)));
      });
    },
    generateBundle() {
      for (const file of files) this.emitFile({ type: "asset", fileName: file, source: readFileSync(webPublic(file)) });
    },
  };
}
