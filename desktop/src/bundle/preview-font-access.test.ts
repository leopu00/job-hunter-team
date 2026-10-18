// @vitest-environment node
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createServer as httpServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, isFileLoadingAllowed, normalizePath, type ViteDevServer } from "vite";

const desktop = fileURLToPath(new URL("../..", import.meta.url));
const packageDir = realpathSync(join(desktop, "node_modules/@fontsource/jetbrains-mono"));
// Follow the real five imported stylesheets, rather than a directory/glob allow.
const fonts = [...new Set([300, 400, 500, 600, 700].flatMap((weight) => {
  const css = readFileSync(join(packageDir, `${weight}.css`), "utf8");
  return [...css.matchAll(/url\(([^)]+)\)/g)].map(([, url]) => normalizePath(realpathSync(join(packageDir, url))));
}))];
let vite: ViteDevServer;
const root = mkdtempSync(join(tmpdir(), "jht-font-policy-"));
const socket = process.platform === "win32" ? `\\\\.\\pipe\\jht-font-policy-${randomUUID()}` : join(root, "http.sock");
const http = httpServer((req, res) => vite.middlewares(req, res, () => { res.statusCode = 404; res.end(); }));
async function get(file: string) {
  return new Promise<{ status: number; body: Buffer }>((resolve, reject) => {
    request({ socketPath: socket, path: `/@fs/${normalizePath(file)}`, headers: { host: "localhost" } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (b: Buffer) => chunks.push(b));
      res.on("end", () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    }).on("error", reject).end();
  });
}
beforeAll(async () => {
  vite = await createServer({ root: desktop, configFile: join(desktop, "vite.config.ts"), logLevel: "silent",
    appType: "custom", optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null } });
  await new Promise<void>((resolve, reject) => { http.once("error", reject); http.listen(socket, resolve); });
});
afterAll(async () => {
  await new Promise<void>((resolve) => http.close(() => resolve()));
  await vite?.close(); rmSync(root, { recursive: true, force: true });
});

describe("preview font resource leaves", () => {
  it("allows only the real WOFF/WOFF2 leaves referenced by the five dashboard weights", () => {
    expect(vite.config.server.fs.strict).toBe(true);
    expect(fonts).toHaveLength(60);
    for (const font of fonts) {
      expect(vite.config.server.fs.allow, font).toContain(font);
      expect(isFileLoadingAllowed(vite.config, font), font).toBe(true);
      expect(["wOFF", "wOF2"]).toContain(readFileSync(font).subarray(0, 4).toString());
    }
  });
  it("serves the actual font bytes through Vite, while removing just these leaves restores 403", async () => {
    const font = fonts.find((f) => f.endsWith("latin-400-normal.woff2"))!;
    const reply = await get(font);
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual(readFileSync(font));
    const allow = vite.config.server.fs.allow;
    try {
      vite.config.server.fs.allow = allow.filter((p) => !fonts.includes(p));
      expect((await get(font)).status).toBe(403);
    } finally { vite.config.server.fs.allow = allow; }
  });
  it("denies unimported font siblings and package/private siblings without opening the cache root", async () => {
    const sibling = join(packageDir, "files/jetbrains-mono-latin-200-normal.woff2");
    for (const denied of [sibling, join(packageDir, "package.json"), join(packageDir, "private-fixture.json"), join(dirname(dirname(packageDir)), ".env")]) {
      expect(isFileLoadingAllowed(vite.config, normalizePath(denied)), denied).toBe(false);
    }
    expect((await get(sibling)).status).toBe(403);
    expect((await get(join(packageDir, "package.json"))).status).toBe(403);
    expect(vite.config.server.fs.allow).not.toContain(normalizePath(packageDir));
    expect(vite.config.server.fs.allow).not.toContain(normalizePath(join(packageDir, "files")));
    expect(vite.config.server.fs.allow).not.toContain(normalizePath(dirname(dirname(packageDir))));
  });
});
