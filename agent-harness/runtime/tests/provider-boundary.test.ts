/**
 * ADR 0004 decision 4 says no call site outside the provider adapter may import
 * an AI SDK symbol. That is what keeps the loop replaceable, so it is a test
 * rather than a comment: the day someone reaches past the port, this fails.
 */

import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = new URL("..", import.meta.url).pathname;
const ADAPTER = "src/core/provider/ai-sdk.ts";

/**
 * The only files allowed to reach the AI SDK: the adapter, and the test that
 * exercises it. Every addition here is a decision to widen the boundary, which
 * is why it is a list and not a pattern.
 */
const ALLOWED = new Set([ADAPTER, "tests/ai-sdk-adapter.test.ts"]);

/** Matches `ai`, `ai/test`, `@ai-sdk/anthropic` and any other subpath. */
const AI_SDK_IMPORT = /\bfrom\s+["'](ai(\/[^"']*)?|@ai-sdk\/[^"']+)["']/;

async function tsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(join(ROOT, dir), { withFileTypes: true });
  const found = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return tsFiles(path);
      return extname(entry.name) === ".ts" ? [path] : [];
    }),
  );
  return found.flat();
}

describe("provider port boundary", () => {
  it("keeps every AI SDK import inside the adapter", async () => {
    const files = [...(await tsFiles("src")), ...(await tsFiles("tests"))];
    const offenders: string[] = [];

    for (const file of files) {
      if (ALLOWED.has(file)) continue;
      const source = await readFile(join(ROOT, file), "utf8");
      if (AI_SDK_IMPORT.test(source)) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });

  it("catches an import the allowlist does not cover", () => {
    // Built from parts on purpose: a literal AI SDK import in this file would
    // make the scanner above flag its own fixtures.
    const importing = (spec: string) => `import { x } from "${spec}";`;
    const typeImporting = (spec: string) => `import type { X } from '${spec}';`;

    // The regex missed the `ai/test` subpath once. These are what it must catch.
    for (const spec of ["ai", "ai/test", "ai/internal", "@ai-sdk/anthropic", "@ai-sdk/openai"]) {
      expect(AI_SDK_IMPORT.test(importing(spec))).toBe(true);
      expect(AI_SDK_IMPORT.test(typeImporting(spec))).toBe(true);
    }
    // And what it must leave alone, including packages merely starting with "ai".
    for (const spec of ["zod", "node:path", "airtable", "vitest"]) {
      expect(AI_SDK_IMPORT.test(importing(spec))).toBe(false);
    }
  });

  it("is looking at a real file set, and at the adapter itself", async () => {
    const files = await tsFiles("src");
    expect(files.length).toBeGreaterThan(5);
    expect(files).toContain(ADAPTER);
    const adapter = await readFile(join(ROOT, ADAPTER), "utf8");
    expect(AI_SDK_IMPORT.test(adapter)).toBe(true);
  });
});
