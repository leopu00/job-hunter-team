/**
 * Test unitari — web/lib/profile-completion (tassonomia a 3 livelli)
 * Esegui: cd tests/js && npx vitest run
 *
 * Raccolto dal runner vitest di tests/js (vedi `include` in
 * tests/js/vitest.config.ts): finché usava `node:test` nessun runner lo
 * eseguiva e la copertura era solo apparente.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { CandidateProfile } from "./types.ts";
import {
  isTeamUnlocked,
  completionByLevel,
  weightedCompletion,
} from "./profile-completion.ts";

// profilo con TUTTI i required soddisfatti (niente recommended/optional)
const BASE = {
  id: "x",
  user_id: "x",
  name: "Mario Rossi",
  email: "m@x.it",
  target_role: "Backend Developer",
  location: "Roma",
  experience_years: 3,
  experience_months: null,
  has_degree: true,
  skills: { primary: ["Python", "SQL"] },
  languages: [{ language: "Italian", level: "native" }],
  location_preferences: null,
  job_titles: null,
  salary_target: null,
  positioning: { seniority_target: "mid" },
  created_at: "",
  updated_at: "",
} as unknown as CandidateProfile;

describe("isTeamUnlocked", () => {
  it("true quando tutti i required sono presenti", () => {
    assert.equal(isTeamUnlocked(BASE), true);
  });
  it("false se manca seniority_target", () => {
    assert.equal(
      isTeamUnlocked({ ...BASE, positioning: {} } as CandidateProfile),
      false,
    );
  });
  it("false se skill < 2", () => {
    assert.equal(
      isTeamUnlocked({
        ...BASE,
        skills: { primary: ["Python"] },
      } as CandidateProfile),
      false,
    );
  });
  it("false su null", () => {
    assert.equal(isTeamUnlocked(null), false);
  });
});

describe("completionByLevel", () => {
  it("8 required, tutti pieni in BASE", () => {
    const c = completionByLevel(BASE);
    assert.equal(c.required.total, 8);
    assert.equal(c.required.filled, 8);
    assert.equal(c.required.missing.length, 0);
  });
  it("recommended e optional mancanti in BASE", () => {
    const c = completionByLevel(BASE);
    assert.ok(c.recommended.filled < c.recommended.total);
    assert.ok(c.optional.missing.length > 0);
  });
  it("job_titles è un requisito recommended tracciato", () => {
    const missingInBase = completionByLevel(BASE).recommended.missing.map(
      (r) => r.key,
    );
    assert.ok(missingInBase.includes("job_titles"));
    const withRoles = completionByLevel({
      ...BASE,
      job_titles: ["Investment Analyst"],
    } as unknown as CandidateProfile);
    assert.ok(
      !withRoles.recommended.missing.map((r) => r.key).includes("job_titles"),
    );
  });
});

describe("weightedCompletion", () => {
  it("BASE (solo required) → tra 0 e 100", () => {
    const w = weightedCompletion(BASE);
    assert.ok(w > 0 && w < 100);
  });
  it("0 su profilo null", () => {
    assert.equal(weightedCompletion(null), 0);
  });
});
