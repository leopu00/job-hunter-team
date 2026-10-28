// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeError } from "../lib/error-catalog";

describe("the codes the native link of a local profile to an account can answer with", () => {
  it("have a sentence of their own in the catalog, which the page says", () => {
    const source = readFileSync(new URL("../../src-tauri/src/profile_migration.rs", import.meta.url), "utf8");
    const codes = new Set(source.match(/"local_migration_[a-z_]+"/g)?.map((quoted) => quoted.slice(1, -1)));
    expect(codes.size).toBeGreaterThan(10);
    const unknown = describeError("not_a_code", { locale: "it" }).text;
    for (const code of codes) {
      const said = describeError(code, { locale: "it" });
      expect(said.known, code).toBe(true);
      expect(said.text, code).not.toBe(unknown);
    }
  });
});
