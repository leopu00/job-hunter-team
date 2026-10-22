// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, isFileLoadingAllowed, normalizePath, type ViteDevServer } from "vite";

const desktop = fileURLToPath(new URL("../..", import.meta.url));
const rule = normalizePath(fileURLToPath(new URL("../../../shared/cloud/apply-request-rule.json", import.meta.url)));
const importer = normalizePath(fileURLToPath(new URL("../../../web/lib/apply-request-rule.ts", import.meta.url)));
let server: ViteDevServer;

beforeAll(async () => {
  // Middleware only: no app/GUI/listening port, dependency discovery or build.
  server = await createServer({ root: desktop, configFile: `${desktop}/vite.config.ts`,
    logLevel: "silent", appType: "custom", optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null } });
});
afterAll(async () => { await server?.close(); });

describe("baseline shared application rule in the desktop dev server", () => {
  it("allows the exact baseline JSON before any import grants access", () => {
    expect(server.config.server.fs.strict).toBe(true);
    expect(server.config.server.fs.allow).toContain(rule);
    expect(isFileLoadingAllowed(server.config, rule)).toBe(true);
    const baseline = { ...server.config, safeModulePaths: new Set<string>(),
      server: { ...server.config.server, fs: { ...server.config.server.fs,
        allow: server.config.server.fs.allow.filter((path) => path !== rule) } } };
    expect(isFileLoadingAllowed(baseline, rule)).toBe(false);
  });
  it("keeps sibling shared files, repository root and private files inaccessible", () => {
    for (const denied of [rule.replace("apply-request-rule.json", "other-rule.json"),
      rule.replace("shared/cloud/apply-request-rule.json", ".env"),
      rule.replace("shared/cloud/apply-request-rule.json", "private/credentials.json")]) {
      expect(isFileLoadingAllowed(server.config, denied)).toBe(false);
    }
    const root = normalizePath(fileURLToPath(new URL("../../..", import.meta.url))).replace(/\/$/, "");
    expect(server.config.server.fs.allow).not.toContain(root);
    expect(server.config.server.fs.allow).not.toContain(`${root}/shared`);
  });
  it("transforms the real web importer and JSON into modules with the baseline rule", async () => {
    const baseline = JSON.parse(readFileSync(rule, "utf8"));
    // ../web is not allowed as a folder: its files are reached the way the
    // browser reaches them, from the desktop page that imports the web page.
    expect((await server.transformRequest("/src/pages/position/index.tsx"))?.code).toContain("/positions/[id]/page.tsx");
    expect((await server.transformRequest(`/@fs/${importer.replace("lib/apply-request-rule.ts", "app/(protected)/positions/[id]/page.tsx")}`))?.code)
      .toContain("/lib/apply-request-rule.ts");
    const imported = await server.transformRequest(`/@fs/${importer}`);
    expect(imported?.code).toContain("shared/cloud/apply-request-rule.json");
    const loaded = await server.transformRequest(`/@fs/${rule}`);
    expect(loaded?.code).toContain("export default");
    expect(loaded?.code).toContain(baseline.authorisable_status);
    expect(loaded?.code).toContain("user_local");
  });
});
