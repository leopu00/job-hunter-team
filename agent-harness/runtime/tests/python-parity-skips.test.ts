/**
 * A test that needs something the image has not must SKIP there, not fail.
 *
 * Two such things, and the same rule for both:
 * - **python3**: the image carries none, and about ninety comparisons skip
 *   there. A run that goes red instead says "the port is broken" when what is
 *   missing is the thing it compares against. T25's writer sequence forgot the
 *   line, and only a run without python3 showed it;
 * - **the git repository**: the image holds the source without `.git`, so a
 *   test that asks git anything errs. It happened on 21/09 — the census of
 *   `write_requested` used `git grep` and was the one red of a run inside the
 *   image (429 tests, 428 passed, 1 failed). SICUREZZA's reason for insisting
 *   on a test nobody depends on: a red everyone knows is false teaches people
 *   to ignore reds, and that is how the next real one goes unnoticed.
 *
 * So the rule is checked here instead of remembered, for both. Each scan
 * refuses an empty search: no test files, or no test of that kind found, is a
 * broken check, not a pass. (A test may also drop the dependency instead of
 * skipping — the census now reads the source tree — and then it simply
 * stops being counted here.)
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Each `it(...)` block of a test file, with its opening line: from the `it`
 * to the line that closes it at the same indentation.
 *
 * The end matters as much as the start. Cutting at the NEXT `it` instead
 * swallows whatever sits between two tests — a `describe`'s own setup, a
 * helper — and the scans then blame the test above for a call that is not
 * inside it (two false positives, 21/09). Any indentation, so a test written
 * inside a `for` of cases is seen too.
 */
function tests(source: string): Array<{ head: string; body: string }> {
  const out: Array<{ head: string; body: string }> = [];
  for (const match of source.matchAll(/^([ \t]*)(it[.(])/gm)) {
    const start = match.index!;
    const closer = new RegExp(String.raw`^${match[1]}\}\)[;,]?$`, "m");
    const rest = source.slice(start);
    const end = closer.exec(rest.slice(1));
    const body = end === null ? rest : rest.slice(0, end.index + 1 + end[0].length);
    out.push({ head: body.slice(0, body.indexOf("\n")), body });
  }
  return out;
}

/** Every test file but this one. */
async function testFiles(): Promise<string[]> {
  const self = "python-parity-skips.test.ts";
  const files = (await readdir(HERE)).filter((f) => f.endsWith(".test.ts") && f !== self);
  expect(files.length).toBeGreaterThan(10);
  return files;
}

/**
 * The tests that reach for `needs`, and which of them forgot the skip. The
 * caller says how many it expects to find, so a pattern that stops matching
 * fails here instead of passing an empty scan.
 */
async function withoutSkip(needs: RegExp, atLeast: number): Promise<string[]> {
  const missing: string[] = [];
  let checked = 0;
  for (const file of await testFiles()) {
    const source = await readFile(join(HERE, file), "utf8");
    for (const { head, body } of tests(source)) {
      if (!needs.test(body)) continue;
      checked++;
      if (!head.includes("skipIf")) missing.push(`${file}: ${head.trim().slice(0, 90)}`);
    }
  }
  expect(checked, `nothing matched ${needs}: the scan is broken, not clean`).toBeGreaterThanOrEqual(atLeast);
  return missing;
}

describe("the parity tests", () => {
  it("skip where there is no python3, every one of them", async () => {
    // `py(...)` is the twin helper; `runPython` the direct call.
    expect(await withoutSkip(/\bpy\(|\brunPython\(/, 20)).toEqual([]);
  });

  it("skip where there is no git repository, every one of them", async () => {
    // A test that runs `git` anything: the image has the binary and not the
    // repository, so the command errs rather than answering.
    expect(await withoutSkip(/["'`]git["'`]\s*,/, 2)).toEqual([]);
  });
});
