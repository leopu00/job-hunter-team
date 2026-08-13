import { describe, expect, it } from "vitest";
import { generateUserCode } from "../../../web/lib/cloud-sync/pairing";

describe("F-10 user-code entropy", () => {
  it("emits only canonical symbols and samples all positions", () => {
    const values = Array.from({ length: 400 }, () => generateUserCode());
    expect(
      values.every((value) => /^[A-HJ-KM-NP-Z]{4}-[2-9]{4}$/.test(value)),
    ).toBe(true);
    expect(new Set(values.map((value) => value[0])).size).toBeGreaterThan(1);
    expect(new Set(values.map((value) => value[5])).size).toBeGreaterThan(1);
  });
});

describe("F-07 raw database error boundary", () => {
  it("does not expose Postgres messages in the protected seams", async () => {
    const fs = await import("node:fs");
    const root = process.cwd();
    const sources = [
      "web/lib/cloud-sync/auth.ts",
      "web/app/api/cloud-sync/device-confirm/route.ts",
      "web/app/api/canary/route.ts",
    ]
      .map((file) => fs.readFileSync(`${root}/../../${file}`, "utf8"))
      .join("\n");
    expect(sources).not.toMatch(/error:\s*error\.message/);
    expect(sources).not.toMatch(/error:\s*lookupErr\.message/);
    expect(sources).not.toMatch(/error:\s*tokenErr\.message/);
  });
});
