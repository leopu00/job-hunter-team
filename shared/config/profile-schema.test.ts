/**
 * Test unitari — shared/config/profile-schema
 *
 * Girano dentro la suite vitest di `tests/js` (include `../../shared/**\/*.test.ts`).
 * Prima usavano `node:test` e nessun runner li raccoglieva: passavano solo se
 * qualcuno li lanciava a mano, cioè mai in CI.
 */
import { describe, it, expect } from "vitest";
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
    expect(r.ok).toBe(true);
    expect(r.errors.length).toBe(0);
  });

  it("rifiuta un profilo senza campi mandatori", () => {
    const r = validateCandidateProfile({ name: "X" });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("rifiuta skills.primary vuoto", () => {
    const r = validateCandidateProfile({ ...VALID, skills: { primary: [] } });
    expect(r.ok).toBe(false);
  });

  it("rifiuta un kind di blocco non valido", () => {
    const r = validateCandidateProfile({
      ...VALID,
      blocks: [{ key: "x", kind: "donut", title: "X", content: [] }],
    });
    expect(r.ok).toBe(false);
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
    expect(r.ok).toBe(true);
  });

  it("il vocabolario kind ha esattamente 6 renderer", () => {
    expect(BLOCK_KINDS.length).toBe(6);
  });

  it("conserva categoria e specialty canoniche", () => {
    const r = validateCandidateProfile({
      ...VALID,
      target_role_category_id: "software",
      target_specialty: "fullstack",
    });
    expect(r.ok).toBe(true);
    expect(r.value?.target_role).toBe("Backend Developer");
    expect(r.value?.target_role_category_id).toBe("software");
    expect(r.value?.target_specialty).toBe("fullstack");
  });

  it("rifiuta categoria, specialty e coppie non canoniche", () => {
    expect(
      validateCandidateProfile({
        ...VALID,
        target_role_category_id: "finance",
      }).ok,
    ).toBe(false);
    expect(
      validateCandidateProfile({ ...VALID, target_specialty: "backend" }).ok,
    ).toBe(false);
    expect(
      validateCandidateProfile({
        ...VALID,
        target_role_category_id: "software",
        target_specialty: "research",
      }).ok,
    ).toBe(false);
  });
});
