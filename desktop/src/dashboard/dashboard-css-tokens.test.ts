// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// An undefined CSS variable draws nothing: a page that asks for `var(--color-bg)` when no palette defines it is left
// with a transparent box and looks like another theme (the Team page against the rest). This reads every source the
// desktop shows and fails when a variable is used with NO fallback and is defined nowhere (a stylesheet, or a name
// set from code).
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DIRS = ["desktop/src", "web/app", "web/components", "web/lib"];

function sources(dir: string, out: string[] = []): string[] {
  let entries: import("node:fs").Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sources(path, out);
    else if (/\.(css|ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(path);
  }
  return out;
}

describe("the CSS variables the desktop uses", () => {
  const defined = new Set<string>();
  const unguarded = new Map<string, Set<string>>();
  for (const dir of DIRS) {
    for (const file of sources(join(ROOT, dir))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/(?<![A-Za-z0-9_-])(--[A-Za-z0-9_-]+)\s*:/g)) defined.add(m[1]);
      for (const m of text.matchAll(/["'`](--[A-Za-z0-9_-]+)["'`]/g)) defined.add(m[1]);
      for (const m of text.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*([,)])/g)) {
        if (m[2] === ")") {
          const files = unguarded.get(m[1]) ?? new Set<string>();
          files.add(file.slice(ROOT.length));
          unguarded.set(m[1], files);
        }
      }
    }
  }

  it("every one used with no fallback is defined somewhere", () => {
    const missing = [...unguarded].filter(([name]) => !defined.has(name)).map(([name, files]) => `${name} (${[...files].slice(0, 2).join(", ")})`);
    expect(missing).toEqual([]);
  });

  it("the scan sees what it must (the palettes' own tokens and the aliases of the reused views)", () => {
    for (const name of ["--color-card", "--color-border", "--color-void", "--color-bg", "--color-text"]) expect(defined.has(name), name).toBe(true);
    expect(unguarded.size).toBeGreaterThan(10);
  });
});
