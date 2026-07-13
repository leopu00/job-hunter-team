/**
 * Cross-check: lo schema zod (profile-schema.ts) e il validatore runtime Python
 * (shared/skills/validate_profile.py) devono restare allineati sui block kind.
 * Esegui: node --experimental-strip-types --test shared/config/profile-schema-crosscheck.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BLOCK_KINDS } from "./profile-schema.ts";

const here = dirname(fileURLToPath(import.meta.url));
const PY = join(here, "../skills/validate_profile.py");
const PROFILE_PAGE = join(here, "../../web/app/(protected)/profile/page.tsx");

describe("cross-check zod ↔ python", () => {
  it("i BLOCK_KINDS coincidono tra profile-schema.ts e validate_profile.py", () => {
    const py = readFileSync(PY, "utf8");
    const m = py.match(/BLOCK_KINDS\s*=\s*\{([^}]*)\}/);
    assert.ok(m, "BLOCK_KINDS non trovato in validate_profile.py");
    const pyKinds = Array.from(m![1].matchAll(/"([a-z_]+)"/g))
      .map((x) => x[1])
      .sort();
    const tsKinds = [...BLOCK_KINDS].sort();
    assert.deepEqual(tsKinds, pyKinds);
  });
});

describe("cross-check schema ↔ dashboard reader", () => {
  // Regressione storica (2026-07): la pagina profilo leggeva
  // `e.description` (esperienza) e `e.title` (formazione), mentre lo schema
  // canonico usa `ExperienceSchema.summary` e `EducationSchema.degree`. Il
  // validator è permissivo (campi optional + chiavi extra ignorate) e non lo
  // rilevava → profilo valido ma card vuote in dashboard. Questa guardia lega
  // il reader allo schema. (`projects[].description` è di proposito, non è
  // nello schema: qui controlliamo solo i map `e.` di esperienza/formazione.)
  it("profile/page.tsx legge i campi canonici summary/degree, non description/title", () => {
    const src = readFileSync(PROFILE_PAGE, "utf8");
    assert.ok(
      /\be\.summary\b/.test(src),
      "deve leggere e.summary (ExperienceSchema.summary)",
    );
    assert.ok(
      /\be\.degree\b/.test(src),
      "deve leggere e.degree (EducationSchema.degree)",
    );
    assert.ok(
      !/\be\.description\b/.test(src),
      "non deve leggere e.description sull'esperienza (usa e.summary)",
    );
    assert.ok(
      !/\be\.title\b/.test(src),
      "non deve leggere e.title sulla formazione (usa e.degree)",
    );
  });
});
