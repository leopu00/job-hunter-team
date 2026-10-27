/**
 * Parità del minimo del profilo: i campi obbligatori dell'app (profile-completion.ts, quelli che
 * danno `ready` a GET /api/profile) e quelli di `validate_profile.py --minimum` sono la stessa
 * lista, e sugli stessi profili danno la stessa risposta.
 *
 * L'elenco e i casi stanno in shared/config/profile-minimum.json; il lato Python li legge in
 * tests/test_profile_minimum_checklist.py. Un campo aggiunto a un lato solo rompe uno dei due.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { completionByLevel, isTeamUnlocked } from "./profile-completion.ts";
import { mapYamlToProfile } from "./profile-reader.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const shared = JSON.parse(
  fs.readFileSync(
    path.join(here, "../../shared/config/profile-minimum.json"),
    "utf8",
  ),
) as {
  required: string[];
  cases: { name: string; profile: Record<string, unknown>; missing: string[] }[];
};

const requiredMissing = (raw: Record<string, unknown>) =>
  completionByLevel(mapYamlToProfile(raw)).required.missing.map((r) => r.key);

describe("minimo del profilo: parità con il validatore", () => {
  it("i required dell'app sono l'elenco condiviso, nello stesso ordine", () => {
    assert.deepEqual(
      completionByLevel(null).required.missing.map((r) => r.key),
      shared.required,
    );
  });

  for (const c of shared.cases) {
    it(c.name, () => {
      assert.deepEqual(requiredMissing(c.profile), c.missing);
      assert.equal(isTeamUnlocked(mapYamlToProfile(c.profile)), c.missing.length === 0);
    });
  }
});

describe("has_degree è facoltativo: assente è «non dichiarato», mai «no»", () => {
  const eight = shared.cases[0].profile;

  it("gli otto campi bastano e il titolo di studio resta non dichiarato", () => {
    assert.equal("has_degree" in eight, false);
    assert.equal(isTeamUnlocked(mapYamlToProfile(eight)), true);
    assert.equal(mapYamlToProfile(eight).has_degree, null);
  });

  it("un valore dichiarato resta com'è, anche false", () => {
    assert.equal(mapYamlToProfile({ ...eight, has_degree: false }).has_degree, false);
    assert.equal(mapYamlToProfile({ ...eight, has_degree: true }).has_degree, true);
  });

  it("un valore che non è un booleano non diventa un «no»", () => {
    assert.equal(mapYamlToProfile({ ...eight, has_degree: "no" }).has_degree, null);
  });
});
