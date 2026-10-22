import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SENIORITY_LEVELS, canonicalSeniorityLevel } from "../../../web/lib/seniority-level";
import { SENIORITY_LEVELS as RUNTIME_LEVELS } from "../../../agent-harness/runtime/src/db/profile-exclusions.ts";

/**
 * JHT-T45 — the seniority level an advert asks for, as it reaches the cloud: a word of one closed set,
 * the same in the local database, the CLI's push and restore, the web's push route, the runtime twin and
 * the CHECK of migration 097; a client older than the field does not send it and the cloud's value stays.
 */
const ROOT = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf-8");
const LEVELS = ["junior", "mid", "senior", "lead"];

describe("the closed set", () => {
  it("is the same word list in the web, the runtime twin, the CLI, the local database and the migration", () => {
    expect([...SENIORITY_LEVELS]).toEqual(LEVELS);
    expect([...RUNTIME_LEVELS]).toEqual(LEVELS);
    const cli = /const SENIORITY_LEVELS = \[([^\]]*)\]/.exec(read("cli/src/commands/cloud.js"))![1];
    expect(cli.split(",").map((w) => w.trim().replace(/'/g, ""))).toEqual(LEVELS);
    const py = /SENIORITY_LEVELS = \(([^)]*)\)/.exec(read("shared/skills/_db.py"))![1];
    expect(py.split(",").map((w) => w.trim().replace(/'/g, "")).filter(Boolean)).toEqual(LEVELS);
    const sql = /seniority_level IN \(([^)]*)\)/.exec(read("supabase/migrations/097_positions_seniority_level.sql"))![1];
    expect(sql.split(",").map((w) => w.trim().replace(/'/g, ""))).toEqual(LEVELS);
  });
});

describe("canonicalSeniorityLevel", () => {
  it("keeps a word of the set exactly as written and gives null for everything else", () => {
    for (const level of LEVELS) expect(canonicalSeniorityLevel(level)).toBe(level);
    for (const bad of ["Senior", "SENIOR", " senior", "senior ", "principal", "", "not specified", "none", null, undefined, 3, {}, ["senior"]]) {
      expect(canonicalSeniorityLevel(bad)).toBeNull();
    }
  });
});

describe("the sync", () => {
  it("the web push route writes it only when the client sent the field, and only the canonical value", () => {
    const route = read("web/app/api/cloud-sync/push/route.ts");
    expect(route).toContain('Object.prototype.hasOwnProperty.call(p, "seniority_level")');
    expect(route).toContain("seniority_level: canonicalSeniorityLevel(p.seniority_level)");
  });

  it("the CLI pushes the column only when the jobs.db has it, and restores only a word of the set", () => {
    const cli = read("cli/src/commands/cloud.js");
    expect(cli).toContain("sqliteHasColumn(db, 'positions', 'seniority_level') ? ['seniority_level'] : []");
    expect(cli).toContain("SENIORITY_LEVELS.includes(p.seniority_level) ? p.seniority_level : null");
  });
});
