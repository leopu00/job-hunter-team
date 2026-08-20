import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "..");

describe("unresolved canonical Scorer contract", () => {
  it("keeps the API Scorer disabled while accepted maxima contradict the total", () => {
    const authority = readFileSync(
      resolve(repoRoot, "shared", "skills", "score_ranges.py"),
      "utf8",
    );
    const componentBlock = authority.match(
      /COMPONENT_LIMITS: dict\[str, int\] = \{([\s\S]*?)\}/,
    );
    const totalMatch = authority.match(/TOTAL_LIMIT\s*=\s*(\d+)/);
    expect(componentBlock).not.toBeNull();
    expect(totalMatch).not.toBeNull();
    const maxima = [...componentBlock![1]!.matchAll(/"\w+":\s*(\d+)/g)].map(
      (match) => Number(match[1]),
    );
    const totalLimit = Number(totalMatch![1]);

    expect(maxima).toEqual([40, 25, 20, 10, 15]);
    expect(maxima.reduce((sum, maximum) => sum + maximum, 0)).toBe(110);
    expect(totalLimit).toBe(100);
    expect(authority).toContain("Contraddizione nota e NON risolta");

    const manifest = JSON.parse(
      readFileSync(resolve(packageRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(manifest.scripts).not.toHaveProperty("scorer");
    expect(manifest.scripts).not.toHaveProperty("scorer:demo");
    expect(existsSync(resolve(packageRoot, "src", "scorer-worker.ts"))).toBe(
      false,
    );
    expect(existsSync(resolve(packageRoot, "src", "scorer-contract.ts"))).toBe(
      false,
    );
  });
});
