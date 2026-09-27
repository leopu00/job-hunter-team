// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const css = readFileSync(fileURLToPath(new URL("./dashboard.css", import.meta.url)), "utf-8");
const PLANE = 'className="flex-1 overflow-x-auto"';

function webSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return webSources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/**
 * dashboard.css hides the WebKit scrollbar of one element, picked by its
 * shape: the team timeline's plane (a flex-1 overflow-x-auto holding a
 * div > svg). The rule means nothing if the web changes that plane, and hides
 * too much if another element takes the same shape.
 */
describe("the team timeline's scrollbar", () => {
  it("is hidden in the desktop, and only for that plane", () => {
    expect(css).toContain(".flex-1.overflow-x-auto:has(> div > svg)::-webkit-scrollbar {\n  display: none;\n}");
    expect(css).toContain(".flex-1.overflow-x-auto:has(> div > svg) {\n  scrollbar-width: none;\n}");
  });

  it("still finds its plane in the web: one flex-1 overflow-x-auto, the timeline's", () => {
    const hits = webSources(join(repo, "web/app")).flatMap((file) =>
      readFileSync(file, "utf-8").split(PLANE).length > 1 ? [file.slice(repo.length)] : [],
    );
    expect(hits).toEqual(["web/app/(protected)/team/ActivityCharts.tsx"]);
    const source = readFileSync(join(repo, hits[0]!), "utf-8");
    expect(source.split(PLANE)).toHaveLength(2);
    // the plane wraps the chart as the selector expects: div > svg
    expect(source.split(PLANE)[1]!.slice(0, 200)).toMatch(/^>\s*<div style=\{\{ width: scatterW \}\}>\s*<svg /);
  });
});
