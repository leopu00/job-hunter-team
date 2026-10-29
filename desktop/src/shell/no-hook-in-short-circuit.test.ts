// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A hook called only when another expression says so is a different number of hooks at the next render: the
// pages that decide whether to show the «this data comes from the cloud» notice call their hooks first.
describe("the pages that decide the cloud notice", () => {
  it("call no hook inside an `&&`, an `||` or a `?:`", () => {
    for (const file of ["./server-page.tsx", "../pages/dashboard/index.tsx"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source.match(/(?:&&|\|\||\?)\s*!?use[A-Z]\w*\(/g), file).toBeNull();
    }
  });
});
