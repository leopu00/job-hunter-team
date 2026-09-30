// @vitest-environment node
import { fileURLToPath } from "node:url";
import { build, type Rollup } from "vite";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { WEB_PUBLIC_FILES } from "./web-public-assets";

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
// the local SQLite workspace, the home directory, the host's shell.
const SERVER_ONLY = [
  "web/lib/cloud-sync/tokens.ts",
  "web/lib/cloud-sync/auth.ts",
  "web/lib/supabase/admin.ts",
  "web/lib/supabase/server.ts",
  "web/lib/db.ts",
  "web/lib/local-queries.ts",
  "web/lib/jht-paths.ts",
  "web/lib/pending-message-reply-local.ts",
  "web/lib/shell.ts",
];

// Il vecchio entrypoint locale chiedeva una chiave OpenAI e avviava un team
// API separato. I file restano per ora nel sorgente, ma non devono essere
// raggiungibili da nessuno dei tre entrypoint Vite distribuiti.
const RETIRED_DESKTOP_MODULES = [
  "desktop/src/components/team-dashboard.tsx",
  "desktop/src/lib/podman.ts",
  "desktop/src/lib/team.ts",
];

const RETIRED_UI_TEXT = [
  "Chiave API OpenAI",
  "Consumo sulla tua chiave OpenAI",
  "Team locale",
  "openai-api-key",
];

let moduleIds: string[] = [];
let assets = new Map<string, Uint8Array | string>();
let chunks = new Map<string, string>();

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
  assets = new Map(
    outputs.flatMap((o) => o.output.flatMap((item) => (item.type === "asset" ? [[item.fileName, item.source] as const] : []))),
  );
  chunks = new Map(
    outputs.flatMap((o) => o.output.flatMap((item) => (item.type === "chunk" ? [[item.fileName, item.code] as const] : []))),
  );
}, 180_000);

describe("the desktop bundle", () => {
  it("was really built from the web's code", () => {
    // Guards the test itself: an empty or wrong build would pass the checks below.
    expect(moduleIds.some((id) => id.includes("/web/lib/queries.ts"))).toBe(true);
    expect(moduleIds.some((id) => id.includes("/web/app/components/MapCharts.tsx"))).toBe(true);
    expect(moduleIds.some((id) => id.includes("/web/app/api/team/send/route.ts"))).toBe(true);
  });

  it.each(SERVER_ONLY)("never contains %s", (file) => {
    expect(moduleIds.filter((id) => id.replace(/\\/g, "/").endsWith(`/${file}`))).toEqual([]);
  });

  it.each(RETIRED_DESKTOP_MODULES)("does not reach the retired entrypoint module %s", (file) => {
    expect(moduleIds.filter((id) => id.replace(/\\/g, "/").endsWith(`/${file}`))).toEqual([]);
  });

  it.each(RETIRED_UI_TEXT)("does not ship the retired UI text %s", (text) => {
    expect([...chunks.values()].some((code) => code.includes(text))).toBe(false);
  });

  it("does not reach or package the legacy Godot application", () => {
    expect(moduleIds.filter((id) => id.replace(/\\/g, "/").includes("/game/"))).toEqual([]);
    expect([...assets.keys()].filter((name) => /(^|\/)(project\.godot|[^/]+\.pck)$/i.test(name))).toEqual([]);

    const config = JSON.parse(
      readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
    ) as { bundle?: { resources?: Record<string, string> } };
    const resources = Object.entries(config.bundle?.resources ?? {}).flat();
    expect(resources.filter((resource) => /(^|[/\\])(game|api-worker)([/\\]|$)|godot/i.test(resource))).toEqual([]);

    const nativeEntrypoint = readFileSync(
      new URL("../../src-tauri/src/lib.rs", import.meta.url),
      "utf8",
    );
    expect(nativeEntrypoint).not.toMatch(/\bmod team\b|team::start_api_team|godot/i);
  });

  it("keeps the native voice bridge registered in the Tauri entrypoint", () => {
    const nativeEntrypoint = readFileSync(
      new URL("../../src-tauri/src/lib.rs", import.meta.url),
      "utf8",
    );
    expect(nativeEntrypoint).toMatch(/\bmod voice_input;/);
    for (const command of [
      "voice_input_status",
      "voice_input_start",
      "voice_input_stop",
      "voice_input_cancel",
    ]) {
      expect(nativeEntrypoint).toContain(`voice_input::${command}`);
    }
  });

  // The web asks for them by absolute path (/agents/capitano.png): without
  // them in the build the chat showed broken images (web-public-assets.ts).
  it.each(WEB_PUBLIC_FILES)("ships the web's public file %s, byte for byte", (file) => {
    const source = assets.get(file);
    expect(source).toBeDefined();
    expect(Buffer.from(source!)).toEqual(readFileSync(new URL(`../../../web/public/${file}`, import.meta.url)));
  });

  // Tailwind in the desktop generates only the classes it finds in the
  // folders dashboard.css names with @source (plus desktop/ itself). A web
  // file in the bundle outside them renders with its layout classes
  // missing: the position page did (lg:grid-cols-3, md:items-center…).
  it("every web file in the bundle is scanned by Tailwind", () => {
    const css = readFileSync(new URL("../dashboard/dashboard.css", import.meta.url), "utf8");
    const sources = [...css.matchAll(/@source\s+"([^"]+)"/g)].map((m) =>
      fileURLToPath(new URL(m[1], new URL("../dashboard/", import.meta.url))).replace(/\\/g, "/"),
    );
    const webFiles = moduleIds
      .map((id) => id.replace(/\\/g, "/").split("?")[0])
      .filter((id) => id.includes("/web/") && !id.includes("/node_modules/") && /\.(tsx?|jsx?)$/.test(id));
    expect(webFiles.length).toBeGreaterThan(0);
    const unscanned = [...new Set(webFiles.filter((f) => !sources.some((s) => f === s || f.startsWith(s.replace(/\/?$/, "/")))))];
    expect(unscanned).toEqual([]);
  });

  it("the dashboard stylesheet has the layout classes only the ported pages use", () => {
    const css = [...assets].find(([name]) => /^assets\/dashboard-.*\.css$/.test(name))?.[1];
    expect(css).toBeDefined();
    // used only in web/app/(protected)/positions/[id]/page.tsx
    for (const cls of ["lg\\:grid-cols-3", "lg\\:col-span-2", "md\\:items-center"]) expect(String(css)).toContain(cls);
  });

  it("never pulls node:crypto or child_process in", () => {
    expect(moduleIds.filter((id) => /(^|[:/])(node:)?(crypto|child_process)$/.test(id))).toEqual([]);
  });
});
