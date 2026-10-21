import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { EXCLUSION_CODES } from "../src/db/profile-exclusions.ts";
import { FEEDBACK_REASONS, FEEDBACK_REASON_LABELS, safeReason } from "../src/parity/skills/feedback-reasons.ts";

const FILE = resolve(import.meta.dirname, "../../../shared/feedback-reasons.json");

describe("the closed vocabulary of a judgement's reason (JHT-T05)", () => {
  it("is the one in shared/feedback-reasons.json", () => {
    const json = JSON.parse(readFileSync(FILE, "utf8")) as { reasons: string[]; labels: Record<string, string>; legacy: Record<string, string> };
    expect([...FEEDBACK_REASONS]).toEqual(json.reasons);
    expect(FEEDBACK_REASON_LABELS).toEqual(json.labels);
    for (const [legacy, code] of Object.entries(json.legacy)) expect(safeReason(legacy), legacy).toBe(code);
  });

  it("names the reasons whose accepted exclusion acts on the score (JHT-T24), the same in the runtime", () => {
    const json = JSON.parse(readFileSync(FILE, "utf8")) as { acting: string[]; proposable: string[] };
    expect([...EXCLUSION_CODES]).toEqual(json.acting);
    for (const code of json.acting) expect(json.proposable).toContain(code);
  });

  it("turns a free text into other and an empty one into nothing", () => {
    expect(safeReason("troppo senior per me")).toBe("other");
    expect(safeReason("too_senior")).toBe("too_senior");
    expect(safeReason("  ")).toBeNull();
    expect(safeReason(null)).toBeNull();
    expect(safeReason("__proto__")).toBe("other");
  });
});
