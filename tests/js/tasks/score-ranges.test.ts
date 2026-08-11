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
import * as web from "../../../web/lib/score-ranges";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const SCORE_RANGES_PY = join(REPO_ROOT, "shared", "skills", "score_ranges.py");

/** Rilegge i tetti da `COMPONENT_LIMITS`, l'autorità lato Python. */
function limitsEnforcedByPython(): Record<string, number> {
  const source = readFileSync(SCORE_RANGES_PY, "utf-8");
  const block = source.match(
    /COMPONENT_LIMITS: dict\[str, int\] = \{([\s\S]*?)\}/,
  );
  if (!block) throw new Error("COMPONENT_LIMITS non trovato in score_ranges.py");
  const limits: Record<string, number> = {};
  for (const match of block[1].matchAll(/"(\w+)":\s*(\d+)/g)) {
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

describe("barFill — la barra della pagina posizione", () => {
  it("si ferma al pieno invece di disegnare 120%", () => {
    // Il caso del ticket: 18 su un tetto di 15. Prima `width: 120%` dentro un
    // contenitore overflow-hidden si vedeva pieno, indistinguibile da 15/15.
    expect(web.barFill(18, 15)).toEqual({ pct: 100, over: true });
    expect(web.barFill(96, 15)).toEqual({ pct: 100, over: true });
  });

  it("dichiara `over` solo oltre il tetto, non al tetto", () => {
    expect(web.barFill(15, 15)).toEqual({ pct: 100, over: false });
    expect(web.barFill(16, 15).over).toBe(true);
  });

  it("resta fedele sotto il tetto", () => {
    expect(web.barFill(30, 40)).toEqual({ pct: 75, over: false });
    expect(web.barFill(9, 10)).toEqual({ pct: 90, over: false });
    expect(web.barFill(0, 40)).toEqual({ pct: 0, over: false });
  });

  it("non disegna nulla su valore assente o tetto non valido", () => {
    expect(web.barFill(null, 40)).toEqual({ pct: 0, over: false });
    expect(web.barFill(undefined, 40)).toEqual({ pct: 0, over: false });
    expect(web.barFill(20, 0)).toEqual({ pct: 0, over: false });
  });

  it("non manda la barra in negativo", () => {
    expect(web.barFill(-5, 20)).toEqual({ pct: 0, over: false });
  });
});

describe("il gemello web non può divergere da quello CLI", () => {
  // Due implementazioni scritte a mano dello stesso righello sono la forma in
  // cui il difetto è nato. Finché restano due, almeno si controllano a vicenda.
  it("dichiara gli stessi tetti", () => {
    expect({ ...web.SCORE_COMPONENT_LIMITS }).toEqual({
      ...SCORE_COMPONENT_LIMITS,
    });
    expect({ ...web.SCORE_COMPONENT_LIMITS }).toEqual(limitsEnforcedByPython());
  });

  it("dà lo stesso verdetto sulle stesse righe", () => {
    const rows = [
      { stack_match: 40, experience_fit: 20, strategic_fit: 96 },
      { stack_match: 30, remote_fit: 25, salary_fit: 8 },
      { salary_fit: -1 },
      { experience_fit: null, remote_fit: "26" },
      {},
    ];
    for (const row of rows) {
      expect(web.outOfRangeComponents(row)).toEqual(outOfRangeComponents(row));
    }
    expect(web.summarizeOutOfRange(rows)).toEqual(summarizeOutOfRange(rows));
  });
});
