/**
 * Test — cli/src/lib/score-ranges.js (vitest)
 *
 * [SCORE-DIMENSIONS-EXCEED-THEIR-CAP] — i punteggi per dimensione sfondano il
 * proprio massimo, e il giro cloud è l'unica superficie che non ha righello:
 * su Supabase il CHECK esiste solo su `total_score` (mig 001), le dimensioni
 * sono INTEGER liberi (mig 003), e sia il push sia il restore le passano
 * verbatim. Una riga fuori scala, una volta in cloud, rientra nel SQLite di
 * ogni restore.
 *
 * Cosa proteggono questi test:
 *  1. i tetti JS restano quelli che `_validate_score_range` applica davvero in
 *     `shared/skills/db_insert.py` — la divergenza fra due righelli scritti a
 *     mano in file diversi è il modo in cui il difetto è nato;
 *  2. il conteggio *conta* e non corregge: nessun valore viene normalizzato,
 *     perché i punteggi già scritti sono di utenti reali.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SCORE_COMPONENT_LIMITS,
  outOfRangeComponents,
  summarizeOutOfRange,
} from "../../../cli/src/lib/score-ranges.js";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const DB_INSERT = join(REPO_ROOT, "shared", "skills", "db_insert.py");

/** Rilegge i tetti dalle chiamate `_validate_score_range` del writer canonico. */
function limitsEnforcedByPython(): Record<string, number> {
  const source = readFileSync(DB_INSERT, "utf-8");
  const limits: Record<string, number> = {};
  const pattern =
    /_validate_score_range\(\s*args\.\w+\s*,\s*'(\w+)'\s*,\s*0\s*,\s*(\d+)\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    if (match[1] === "total") continue;
    limits[match[1]] = Number(match[2]);
  }
  return limits;
}

describe("score ranges", () => {
  it("usa gli stessi tetti che db_insert.py applica davvero", () => {
    const fromPython = limitsEnforcedByPython();
    expect(Object.keys(fromPython).length).toBe(5);
    expect({ ...SCORE_COMPONENT_LIMITS }).toEqual(fromPython);
  });

  it("elenca solo le dimensioni che sfondano, con il proprio tetto", () => {
    const hits = outOfRangeComponents({
      total_score: 78,
      stack_match: 40,
      remote_fit: 25,
      salary_fit: 20,
      experience_fit: 20,
      strategic_fit: 96,
    });
    expect(hits).toEqual([
      { column: "experience_fit", value: 20, max: 10 },
      { column: "strategic_fit", value: 96, max: 15 },
    ]);
  });

  it("non segnala una riga interamente al proprio massimo", () => {
    expect(
      outOfRangeComponents({
        stack_match: 40,
        remote_fit: 25,
        salary_fit: 20,
        experience_fit: 10,
        strategic_fit: 15,
      }),
    ).toEqual([]);
  });

  it("ignora NULL e non-numeri invece di contarli come zero", () => {
    expect(
      outOfRangeComponents({
        stack_match: null,
        remote_fit: undefined,
        salary_fit: "18",
        experience_fit: 3,
      }),
    ).toEqual([]);
  });

  it("segnala anche un valore negativo", () => {
    expect(outOfRangeComponents({ salary_fit: -1 })).toEqual([
      { column: "salary_fit", value: -1, max: 20 },
    ]);
  });

  it("aggrega per colonna e sceglie il peggiore in rapporto al tetto", () => {
    const summary = summarizeOutOfRange([
      { experience_fit: 20 }, // 2.0× il tetto
      { experience_fit: 11 },
      { stack_match: 45 }, // 1.125× il tetto: sfonda di più in valore assoluto
      { strategic_fit: 15 }, // esattamente al tetto: non conta
    ]);
    expect(summary.rows).toBe(3);
    expect(summary.byColumn).toEqual({ experience_fit: 2, stack_match: 1 });
    expect(summary.worst).toEqual({
      column: "experience_fit",
      value: 20,
      max: 10,
    });
  });

  it("su righe tutte in scala non riporta nulla", () => {
    const summary = summarizeOutOfRange([{ stack_match: 30 }, { salary_fit: 8 }]);
    expect(summary).toEqual({ rows: 0, byColumn: {}, worst: null });
  });

  it("non normalizza la riga che ispeziona", () => {
    const row = { experience_fit: 20, strategic_fit: 96 };
    summarizeOutOfRange([row]);
    expect(row).toEqual({ experience_fit: 20, strategic_fit: 96 });
  });
});
