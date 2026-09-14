import { describe, expect, it } from "vitest";
import { AutoApplySchema } from "../../../shared/config/schema.js";

// Operator's order 2026-09-14: no daily maximum by default. The schema must not
// write one back (a default would reinstate a cap nobody asked for), and a
// positive integer the user sets stays a cap, however large.
describe("applications.auto_apply.max_per_day", () => {
  it("is absent by default: no cap is written", () => {
    const parsed = AutoApplySchema.parse({ enabled: true });
    expect(parsed.max_per_day).toBeUndefined();
  });

  it("accepts null as no cap and a positive integer as a cap", () => {
    expect(AutoApplySchema.parse({ enabled: true, max_per_day: null }).max_per_day).toBeNull();
    expect(AutoApplySchema.parse({ enabled: true, max_per_day: 5 }).max_per_day).toBe(5);
    expect(AutoApplySchema.parse({ enabled: true, max_per_day: 1000 }).max_per_day).toBe(1000);
  });

  it.each([0, -1, 1.5, "abc", "3", true])("refuses %p", (value) => {
    expect(AutoApplySchema.safeParse({ enabled: true, max_per_day: value }).success).toBe(false);
  });
});
