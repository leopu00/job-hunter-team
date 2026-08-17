/**
 * Cross-check: lo schema zod (profile-schema.ts) e il validatore runtime Python
 * (shared/skills/validate_profile.py) devono restare allineati sui block kind.
 *
 * Gira dentro la suite vitest di `tests/js` (include `../../shared/**\/*.test.ts`).
 * Prima usava `node:test` e nessun runner lo raccoglieva: un guard di drift che
 * non girava mai è un guard che non esiste — e questo si romperebbe proprio
 * nelle PR che toccano il lato Python, dove pytest gira e questo no.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BLOCK_KINDS, TARGET_ROLE_CATEGORY_IDS } from "./profile-schema.ts";

const here = dirname(fileURLToPath(import.meta.url));
const PY = join(here, "../skills/validate_profile.py");
const PROFILE_PAGE = join(here, "../../web/app/(protected)/profile/page.tsx");

describe("cross-check zod ↔ python", () => {
  it("i BLOCK_KINDS coincidono tra profile-schema.ts e validate_profile.py", () => {
    const py = readFileSync(PY, "utf8");
    const m = py.match(/BLOCK_KINDS\s*=\s*\{([^}]*)\}/);
    expect(m, "BLOCK_KINDS non trovato in validate_profile.py").toBeTruthy();
    const pyKinds = Array.from(m![1].matchAll(/"([a-z_]+)"/g))
      .map((x) => x[1])
      .sort();
    const tsKinds = [...BLOCK_KINDS].sort();
    expect(tsKinds).toEqual(pyKinds);
  });

  it("gli ID categoria ruolo coincidono tra Zod e validatore Python", () => {
    const py = readFileSync(PY, "utf8");
    const m = py.match(/TARGET_ROLE_CATEGORY_IDS\s*=\s*\{([^}]*)\}/);
    expect(
      m,
      "TARGET_ROLE_CATEGORY_IDS non trovato nel validator",
    ).toBeTruthy();
    const pyIds = Array.from(m![1].matchAll(/"([a-z_]+)"/g))
      .map((x) => x[1])
      .sort();
    expect([...TARGET_ROLE_CATEGORY_IDS].sort()).toEqual(pyIds);
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
    expect(
      /\be\.summary\b/.test(src),
      "deve leggere e.summary (ExperienceSchema.summary)",
    ).toBe(true);
    expect(
      /\be\.degree\b/.test(src),
      "deve leggere e.degree (EducationSchema.degree)",
    ).toBe(true);
    expect(
      /\be\.description\b/.test(src),
      "non deve leggere e.description sull'esperienza (usa e.summary)",
    ).toBe(false);
    expect(
      /\be\.title\b/.test(src),
      "non deve leggere e.title sulla formazione (usa e.degree)",
    ).toBe(false);
  });
});
