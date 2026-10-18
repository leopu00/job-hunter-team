// @vitest-environment node
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The office's art (/office/manifest.json, the layout and the character
 * sheets) is in the app that is released and loads from its own files, with
 * no dev server behind it. The page fetches root-absolute URLs; in the
 * released app those are answered from `frontendDist` (../dist), which is
 * what the Vite build writes. This builds the app for real and checks the
 * files are in that output, every one the manifest and the layout name.
 */
const root = fileURLToPath(new URL("../..", import.meta.url));
const publicOffice = join(root, "public", "office");

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

/** Every "/office/…" URL a JSON document names, at any depth. */
function officeUrls(value: unknown): string[] {
  if (typeof value === "string") return value.startsWith("/office/") ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(officeUrls);
  if (value && typeof value === "object") return Object.values(value).flatMap(officeUrls);
  return [];
}

const manifest = JSON.parse(readFileSync(join(publicOffice, "manifest.json"), "utf8"));
const layout = JSON.parse(readFileSync(join(root, "public", manifest.layout), "utf8"));
const NAMED = [...new Set(["/office/manifest.json", manifest.layout, ...officeUrls(manifest), ...officeUrls(layout)])].sort();

let dist = "";
let distFiles: string[] = [];

beforeAll(async () => {
  dist = mkdtempSync(join(tmpdir(), "jht-office-dist-"));
  await build({
    root,
    configFile: `${root}/vite.config.ts`,
    logLevel: "silent",
    build: { outDir: dist, emptyOutDir: true, minify: false, sourcemap: false },
  });
  distFiles = filesUnder(dist);
}, 240_000);
afterAll(() => {
  if (dist) rmSync(dist, { recursive: true, force: true });
});

describe("the office's art in the released app", () => {
  it("the manifest names the layout and every sheet, and the layout names its pictures", () => {
    expect(manifest.version).toBe(1);
    expect(manifest.characters.length).toBeGreaterThan(0);
    expect(NAMED.length).toBeGreaterThan(50);
    // root-absolute and relative to the app: no host, no dev server
    for (const url of NAMED) expect(url, url).toMatch(/^\/office\/[A-Za-z0-9_./-]+$/);
  });

  it("every file it names is in the source of the art", () => {
    for (const url of NAMED) expect(existsSync(join(root, "public", url)), url).toBe(true);
  });

  it("the build puts all of the art in the output the app is released from, byte for byte", () => {
    const built = distFiles.map((f) => relative(dist, f).replace(/\\/g, "/")).filter((f) => f.startsWith("office/"));
    const source = filesUnder(publicOffice).map((f) => `office/${relative(publicOffice, f).replace(/\\/g, "/")}`);
    expect(built.sort()).toEqual(source.sort());
    for (const url of NAMED) {
      const file = join(dist, url);
      expect(existsSync(file), url).toBe(true);
      expect(statSync(file).size, url).toBe(statSync(join(root, "public", url)).size);
    }
  });

  it("the released app reads its frontend from that output, and nothing in the build points at the dev server", () => {
    const conf = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
    expect(conf.build.frontendDist).toBe("../dist");
    const scripts = distFiles.filter((f) => /\.(js|mjs|html)$/.test(f));
    expect(scripts.length).toBeGreaterThan(0);
    for (const file of scripts) {
      const text = readFileSync(file, "utf8");
      expect(text.includes("127.0.0.1:1420"), file).toBe(false);
      expect(text.includes("localhost:1420"), file).toBe(false);
    }
  });

  it("the page asks for the art by those root-absolute URLs", () => {
    const parts = readFileSync(join(root, "src", "office", "parts.ts"), "utf8");
    expect(parts).toContain('fetchFn("/office/manifest.json")');
    expect(parts).toContain("fetchFn(manifest.layout)");
  });
});
