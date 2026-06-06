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

describe("cross-check zod ↔ python", () => {
  it("i BLOCK_KINDS coincidono tra profile-schema.ts e validate_profile.py", () => {
    const py = readFileSync(PY, "utf8");
    const m = py.match(/BLOCK_KINDS\s*=\s*\{([^}]*)\}/);
    assert.ok(m, "BLOCK_KINDS non trovato in validate_profile.py");
    const pyKinds = Array.from(m![1].matchAll(/"([a-z_]+)"/g)).map((x) => x[1]).sort();
    const tsKinds = [...BLOCK_KINDS].sort();
    assert.deepEqual(tsKinds, pyKinds);
  });
});
