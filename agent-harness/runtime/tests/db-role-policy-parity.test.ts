/**
 * `db_insert.py` and `db_update.py` (shared/skills) refuse what a role may not write, from `shared/skills/db_role_policy.json`.
 * That file is the TABLE of `src/db/role-policy.ts` (what the native harness enforces), written out for the Python side. This
 * test fails when the two diverge, and rewrites the file when asked:
 *
 *   JHT_WRITE_DB_ROLE_POLICY=1 npx vitest run tests/db-role-policy-parity.test.ts
 *
 * What the Python side adds on top of the table (`python_only`) is listed in the file and checked in
 * tests/test_db_role_policy.py: it is where a legitimate writer of the TUI is not in the native table.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DB_ROLE_POLICIES } from "../src/db/role-policy.ts";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "shared", "skills", "db_role_policy.json");

/** The part of the table the Python tools can apply: which entity, which columns, which statuses. */
export function projection(): Record<string, unknown> {
  const roles: Record<string, unknown> = {};
  for (const role of Object.keys(DB_ROLE_POLICIES).sort()) {
    const p = DB_ROLE_POLICIES[role]!;
    const entry: Record<string, unknown> = { insert: [...p.insert], update: [...p.update] };
    if (p.position) {
      entry.position = {
        fields: p.position.fields === "*" ? "*" : [...p.position.fields],
        moves: Object.fromEntries(Object.entries(p.position.moves).map(([to, from]) => [to, [...from]])),
        touches: p.position.touches ? [...p.position.touches] : null,
        onlyWith: p.position.onlyWith ?? null,
        ownRowsOnly: p.position.ownRowsOnly === true,
      };
    }
    if (p.application) {
      entry.application = { fields: [...p.application.fields], statuses: [...p.application.statuses] };
    }
    roles[role] = entry;
  }
  return roles;
}

describe("db_role_policy.json follows role-policy.ts", () => {
  it("has the same table", () => {
    if (process.env.JHT_WRITE_DB_ROLE_POLICY === "1") {
      const old = JSON.parse(readFileSync(FILE, "utf-8")) as { python_only?: unknown };
      writeFileSync(FILE, JSON.stringify({ roles: projection(), python_only: old.python_only ?? {} }, null, 2) + "\n");
    }
    const file = JSON.parse(readFileSync(FILE, "utf-8")) as { roles: unknown };
    expect(file.roles, "shared/skills/db_role_policy.json is out of date: JHT_WRITE_DB_ROLE_POLICY=1 npx vitest run tests/db-role-policy-parity.test.ts").toEqual(
      JSON.parse(JSON.stringify(projection())),
    );
  });

  it("lists every role of the table", () => {
    const file = JSON.parse(readFileSync(FILE, "utf-8")) as { roles: Record<string, unknown> };
    expect(Object.keys(file.roles).sort()).toEqual(Object.keys(DB_ROLE_POLICIES).sort());
  });
});
