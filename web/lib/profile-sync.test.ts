/**
 * Test unitari — web/lib/profile-sync (mapper legacy→canonico + round-trip)
 * Esegui: cd tests/js && npx vitest run
 *
 * Raccolto dal runner vitest di tests/js (vedi `include` in
 * tests/js/vitest.config.ts): finché usava `node:test` nessun runner lo
 * eseguiva e la copertura era solo apparente.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  mapYamlToCanonical,
  reconstructCanonicalProfile,
} from "./profile-sync.ts";

const RAW_LEGACY = {
  name: "Mario Rossi",
  target_role: "Backend Developer",
  location: "Roma",
  experience_years: 3,
  has_degree: true,
  seniority_target: "mid",
  industry: "Software",
  skills: { primary: ["Python", "SQL"], secondary: ["Docker"] },
  languages: [
    { language: "Italian", level: "native" },
    { language: "English", level: "C1" },
  ],
  candidate: {
    contacts: { email: "m@x.it", phone: "+39 333 000", linkedin: "mrossi" },
    experience: [
      {
        company: "Acme",
        role: "Dev",
        years: "2021 - 2023",
        summary: "Backend.",
      },
    ],
    education: [{ institution: "Uni", degree: "CS", year: "2020" }],
    citizenship: ["Italian (EU)"],
  },
  preferences: {
    geography: ["Milano", "Roma"],
    work_authorization: { eu: "yes" },
  },
  goals: { transition: "verso lead" },
};

describe("mapYamlToCanonical", () => {
  it("estrae le tabelle L1 dal legacy", () => {
    const c = mapYamlToCanonical(RAW_LEGACY, "u");
    assert.equal(c.skills.length, 3); // 2 primary + 1 secondary
    assert.equal(c.languages.length, 2);
    assert.equal(c.experiences.length, 1);
    assert.equal(c.education.length, 1);
    assert.equal(c.locationPrefs.length, 2);
    assert.equal(c.workAuth.length, 1);
    assert.equal(c.contacts?.email, "m@x.it");
    assert.equal(c.profileRow.nationality, "Italian (EU)"); // da candidate.citizenship[0]
    assert.ok(c.blocks.some((b) => b.key === "goals"));
  });

  it("summary .md → blocchi narrative con dedup (il summary vince sul raw)", () => {
    const c = mapYamlToCanonical(RAW_LEGACY, "u", {
      about: "Sono Mario",
      goals: "Voglio lead",
    });
    const about = c.blocks.find((b) => b.key === "about");
    const goals = c.blocks.filter((b) => b.key === "goals");
    assert.equal(about?.kind, "narrative");
    assert.equal(goals.length, 1); // niente doppione
    assert.equal(goals[0].kind, "narrative");
    assert.equal(goals[0].source, "assistant"); // il summary ha priorità
  });
});

describe("round-trip map → reconstruct conserva i campi chiave", () => {
  it("ricostruisce lo YAML canonico dalle tabelle", () => {
    const c = mapYamlToCanonical(RAW_LEGACY, "u");
    const r = reconstructCanonicalProfile({
      profile: c.profileRow,
      skills: c.skills,
      languages: c.languages,
      experiences: c.experiences,
      education: c.education,
      workAuth: c.workAuth,
      locationPrefs: c.locationPrefs,
      contacts: c.contacts,
      blocks: c.blocks,
    });
    assert.equal(r.name, "Mario Rossi");
    assert.equal(r.target_role, "Backend Developer");
    assert.equal(r.has_degree, true);
    assert.deepEqual((r.skills as { primary: string[] }).primary, [
      "Python",
      "SQL",
    ]);
    assert.equal((r.languages as unknown[]).length, 2);
    assert.equal((r.experience as unknown[]).length, 1);
    assert.equal((r.location_preferences as unknown[]).length, 2);
    assert.equal((r.contacts as { email: string }).email, "m@x.it");
    assert.equal(
      Object.hasOwn(
        c.profileRow.positioning as object,
        "target_role_category_id",
      ),
      false,
    );
    assert.equal(Object.hasOwn(r, "target_role_category_id"), false);
  });

  it("porta categoria e specialty nel positioning e ritorno", () => {
    const c = mapYamlToCanonical(
      {
        ...RAW_LEGACY,
        target_role_category_id: "software",
        target_specialty: "backend",
      },
      "u",
    );
    const positioning = c.profileRow.positioning as Record<string, unknown>;
    assert.equal(positioning.target_role_category_id, "software");
    assert.equal(positioning.target_specialty, "backend");

    const r = reconstructCanonicalProfile({
      profile: c.profileRow,
      skills: c.skills,
      languages: c.languages,
      experiences: c.experiences,
      education: c.education,
      workAuth: c.workAuth,
      locationPrefs: c.locationPrefs,
      contacts: c.contacts,
      blocks: c.blocks,
    });
    assert.equal(r.target_role, "Backend Developer");
    assert.equal(r.target_role_category_id, "software");
    assert.equal(r.target_specialty, "backend");
  });

  it("rifiuta una coppia non canonica prima del push", () => {
    assert.throws(
      () =>
        mapYamlToCanonical(
          {
            ...RAW_LEGACY,
            target_role_category_id: "software",
            target_specialty: "research",
          },
          "u",
        ),
      /target_specialty is not valid/,
    );
  });
});
