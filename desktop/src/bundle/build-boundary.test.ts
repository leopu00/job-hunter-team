// @vitest-environment node
import { fileURLToPath } from "node:url";
import { build, type Rollup } from "vite";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * The desktop bundles web code, and the web mixes browser code with server
 * code. A server module that slips into the bundle breaks a page at random
 * the first time it runs (it happened: web/lib/cloud-sync/tokens.ts brought
 * node:crypto in, and the app failed at start with "Cannot access
 * node:crypto.randomBytes"). The stand-ins in src/web-shims/server keep them
 * out; this builds the app for real and fails if one is in the output.
 */
const root = fileURLToPath(new URL("../..", import.meta.url));

// Web modules that must never reach the webview: service_role, sync tokens,
// the local SQLite workspace, the home directory.
const SERVER_ONLY = [
  "web/lib/cloud-sync/tokens.ts",
  "web/lib/cloud-sync/auth.ts",
  "web/lib/supabase/admin.ts",
  "web/lib/supabase/server.ts",
  "web/lib/db.ts",
  "web/lib/local-queries.ts",
  "web/lib/jht-paths.ts",
  "web/lib/pending-message-reply-local.ts",
];

let moduleIds: string[] = [];

beforeAll(async () => {
  const out = await build({
    root,
    configFile: `${root}/vite.config.ts`,
    logLevel: "silent",
    build: { write: false, minify: false, sourcemap: false },
  });
  const outputs = (Array.isArray(out) ? out : [out]) as Rollup.RollupOutput[];
  moduleIds = outputs.flatMap((o) =>
    o.output.flatMap((item) => (item.type === "chunk" ? item.moduleIds : [])),
  );
}, 180_000);

describe("the desktop bundle", () => {
  it("was really built from the web's code", () => {
    // Guards the test itself: an empty or wrong build would pass the checks below.
    expect(moduleIds.some((id) => id.includes("/web/lib/queries.ts"))).toBe(true);
    expect(moduleIds.some((id) => id.includes("/web/app/components/MapCharts.tsx"))).toBe(true);
  });

  it.each(SERVER_ONLY)("never contains %s", (file) => {
    expect(moduleIds.filter((id) => id.replace(/\\/g, "/").endsWith(`/${file}`))).toEqual([]);
  });

  it("never pulls node:crypto in", () => {
    expect(moduleIds.filter((id) => /(^|[:/])(node:)?crypto$/.test(id))).toEqual([]);
  });
});
