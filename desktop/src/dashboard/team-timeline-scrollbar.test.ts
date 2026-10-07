// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const PLANE = 'className="flex-1 overflow-x-auto"';
const WEBKIT_RULE = ".flex-1.overflow-x-auto:has(> div > svg)::-webkit-scrollbar {\n  display: none;\n}";
const FIREFOX_RULE = ".flex-1.overflow-x-auto:has(> div > svg) {\n  scrollbar-width: none;\n}";

function normalizedText(source: string): string {
  return source.replace(/\r\n?/g, "\n");
}

function portableRepoPath(path: string): string {
  return path.replace(/\\/g, "/");
}

const cssSource = readFileSync(fileURLToPath(new URL("./dashboard.css", import.meta.url)), "utf-8");

/** The two rules, as found in a stylesheet read from any checkout. */
function rulesIn(source: string): string[] {
  const css = normalizedText(source);
  return [WEBKIT_RULE, FIREFOX_RULE].filter((rule) => css.includes(rule));
}

/** A file under the repo, named the same way on every system. */
function repoRelative(file: string): string {
  return portableRepoPath(file.slice(repo.length));
}

function webSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return webSources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The web files that hold the plane's class. */
function planeFiles(): string[] {
  return webSources(join(repo, "web/app")).filter((file) => readFileSync(file, "utf-8").split(PLANE).length > 1);
}

/**
 * dashboard.css hides the WebKit scrollbar of one element, picked by its
 * shape: the team timeline's plane (a flex-1 overflow-x-auto holding a
 * div > svg). The rule means nothing if the web changes that plane, and hides
 * too much if another element takes the same shape.
 */
describe("the team timeline's scrollbar", () => {
  it("is hidden in the desktop, and only for that plane", () => {
    expect(rulesIn(cssSource)).toEqual([WEBKIT_RULE, FIREFOX_RULE]);
  });

  // The suite runs on Windows only in game.yml. This keeps a Windows checkout
  // honest on Linux too: the REAL stylesheet with CRLF line ends, and the REAL
  // plane file named with backslashes, through the same readers the two other
  // tests use. (Until 08/10 it checked the helpers on constants of its own.)
  it("holds on a Windows checkout: the real stylesheet with CRLF, the real plane file with backslashes", () => {
    expect(rulesIn(cssSource.replace(/\r?\n/g, "\r\n"))).toEqual([WEBKIT_RULE, FIREFOX_RULE]);
    const [plane] = planeFiles();
    expect(repoRelative(plane!.replace(/\//g, "\\"))).toBe("web/app/(protected)/team/ActivityCharts.tsx");
  });

  it("still finds its plane in the web: one flex-1 overflow-x-auto, the timeline's", () => {
    const hitFiles = planeFiles();
    const hits = hitFiles.map(repoRelative);
    expect(hits).toEqual(["web/app/(protected)/team/ActivityCharts.tsx"]);
    const source = readFileSync(hitFiles[0]!, "utf-8");
    expect(source.split(PLANE)).toHaveLength(2);
    // the plane wraps the chart as the selector expects: div > svg
    expect(source.split(PLANE)[1]!.slice(0, 200)).toMatch(/^>\s*<div style=\{\{ width: scatterW \}\}>\s*<svg /);
  });
});
