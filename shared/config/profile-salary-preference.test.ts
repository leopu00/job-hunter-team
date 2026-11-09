import { describe, expect, it } from "vitest";
import { validateCandidateProfile } from "./profile-schema.ts";

const profile = {
  name: "Synthetic Candidate",
  target_role: "Data Analyst",
  location: "Exampletown",
  experience_years: 3,
  seniority_target: "mid",
  skills: { primary: ["SQL", "Python"] },
  languages: [{ language: "English", level: "C1" }],
};

describe("the saved salary preference", () => {
  it.each(["40–50k EUR/year", "USD 6,000/month", "  60 000 CHF / anno  "])(
    "preserves the person's exact words: %s",
    (value) => {
      const result = validateCandidateProfile({
        ...profile,
        preferences: { salary_annual_eur: value, work_mode: "remote" },
      });
      expect(result.ok).toBe(true);
      expect(result.value?.preferences).toEqual({
        salary_annual_eur: value,
        work_mode: "remote",
      });
    },
  );

  it.each([undefined, null, {}, { salary_annual_eur: null }])(
    "keeps an optional preference optional: %j",
    (preferences) => {
      const result = validateCandidateProfile({ ...profile, preferences });
      expect(result.ok).toBe(true);
      expect(result.value?.preferences).toEqual(preferences);
    },
  );

  it.each([true, 48000, [], {}])("rejects a nontext amount: %j", (value) => {
    const result = validateCandidateProfile({
      ...profile,
      preferences: { salary_annual_eur: value },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("preferences.salary_annual_eur");
  });

  it("keeps the preference structure closed", () => {
    expect(validateCandidateProfile({
      ...profile,
      preferences: { salary_annual_eur: "40-50k EUR/year", private_unknown: "forbidden" },
    }).ok).toBe(false);
    expect(validateCandidateProfile({ ...profile, preferences: { relocation: 2 } }).ok).toBe(false);
    expect(validateCandidateProfile({ ...profile, preferences: { relocation: true } }).ok).toBe(true);
  });

  it.each(["é".repeat(4096), "🙂".repeat(2048)])(
    "allows exactly 8192 UTF-8 bytes",
    (value) => {
      expect(validateCandidateProfile({ ...profile, preferences: { salary_annual_eur: value } }).ok).toBe(true);
      expect(validateCandidateProfile({ ...profile, preferences: { salary_annual_eur: value + "x" } }).ok).toBe(false);
    },
  );
});
