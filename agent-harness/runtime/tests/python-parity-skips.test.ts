/**
 * A parity test that needs Python must SKIP where there is none, not fail.
 *
 * The image carries no python3: about ninety comparisons skip there, and a
 * run that goes red instead says "the port is broken" when what is missing
 * is the thing it compares against. The rule is one line per test
 * (`it.skipIf(skills === null)`), which is exactly the kind of line a new
 * test forgets — T25's writer sequence did, and only a run without python3
 * showed it.
 *
 * So the rule is checked here instead of remembered: every `it` that reaches
 * for the scripts must carry the skip. The scan refuses an empty search: no
 * test files, or no python-using test found, is a broken check, not a pass.
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Each `it(...)` block of a test file, with its opening line. */
function tests(source: string): Array<{ head: string; body: string }> {
  const out: Array<{ head: string; body: string }> = [];
  const opener = /^ {2}(it[.(])/gm;
  const starts = [...source.matchAll(opener)].map((m) => m.index!);
  for (const [i, start] of starts.entries()) {
    const body = source.slice(start, starts[i + 1] ?? source.length);
    out.push({ head: body.slice(0, body.indexOf("\n")), body });
  }
  return out;
}

describe("the parity tests", () => {
  it("skip where there is no python3, every one of them", async () => {
    const self = "python-parity-skips.test.ts";
    const files = (await readdir(HERE)).filter((f) => f.endsWith(".test.ts") && f !== self);
    expect(files.length).toBeGreaterThan(10);
    const missing: string[] = [];
    let checked = 0;
    for (const file of files) {
      const source = await readFile(join(HERE, file), "utf8");
      for (const { head, body } of tests(source)) {
        // `py(...)` is the twin helper; `runPython` the direct call.
        if (!/\bpy\(|\brunPython\(/.test(body)) continue;
        checked++;
        if (!head.includes("skipIf")) missing.push(`${file}: ${head.trim().slice(0, 90)}`);
      }
    }
    // An empty search is a broken check: these tests exist, and plenty of them.
    expect(checked).toBeGreaterThan(20);
    expect(missing).toEqual([]);
  });
});
