/**
 * Test unitari — shared/config/profile-schema
 * Esegui: node --experimental-strip-types --test shared/config/profile-schema.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateCandidateProfile, BLOCK_KINDS } from "./profile-schema.ts";

const VALID = {
  name: "Mario Rossi",
  target_role: "Backend Developer",
  location: "Roma",
  experience_years: 3,
  has_degree: true,
  seniority_target: "mid",
  skills: { primary: ["Python"] },
  languages: [{ language: "Italian", level: "native" }],
};

describe("validateCandidateProfile", () => {
  it("accetta un profilo minimo valido", () => {
    const r = validateCandidateProfile(VALID);
    assert.equal(r.ok, true);
    assert.equal(r.errors.length, 0);
  });

  it("rifiuta un profilo senza campi mandatori", () => {
    const r = validateCandidateProfile({ name: "X" });
    assert.equal(r.ok, false);
    assert.ok(r.errors.length > 0);
  });

  it("rifiuta skills.primary vuoto", () => {
    const r = validateCandidateProfile({ ...VALID, skills: { primary: [] } });
    assert.equal(r.ok, false);
  });

  it("rifiuta un kind di blocco non valido", () => {
    const r = validateCandidateProfile({
      ...VALID,
      blocks: [{ key: "x", kind: "donut", title: "X", content: [] }],
    });
    assert.equal(r.ok, false);
  });

  it("accetta i 6 kind validi con content corretto", () => {
    const r = validateCandidateProfile({
      ...VALID,
      blocks: [
        { key: "a", kind: "narrative", title: "A", content: "testo" },
        { key: "b", kind: "tag_list", title: "B", content: ["x", "y"] },
        {
          key: "c",
          kind: "key_value",
          title: "C",
          content: [{ label: "L", value: "V" }],
        },
        {
          key: "d",
          kind: "key_points",
          title: "D",
          content: [{ heading: "H", text: "T" }],
        },
        {
          key: "e",
          kind: "timeline",
          title: "E",
          content: [{ title: "ruolo" }],
        },
        {
          key: "f",
          kind: "distribution",
          title: "F",
          content: [{ label: "x", value: 3 }],
        },
      ],
    });
    assert.equal(r.ok, true);
  });

  it("il vocabolario kind ha esattamente 6 renderer", () => {
    assert.equal(BLOCK_KINDS.length, 6);
  });
});
