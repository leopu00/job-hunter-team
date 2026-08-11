/**
 * Tetti per dimensione di uno score, lato web.
 *
 * L'autorità è `_validate_score_range` in `shared/skills/db_insert.py`: quello
 * è il solo writer che rifiuta un valore fuori scala. Il gemello JS per la CLI
 * è `cli/src/lib/score-ranges.js`; `tests/js/tasks/score-ranges.test.ts`
 * rilegge i tetti dal sorgente Python e fallisce se i righelli divergono.
 *
 * Nota sul totale: la somma dei tetti fa 110, non 100, mentre `--total` è
 * validato 0..100. La contraddizione è nota e non si chiude qui.
 */
export const SCORE_COMPONENT_LIMITS = {
  stack_match: 40,
  remote_fit: 25,
  salary_fit: 20,
  experience_fit: 10,
  strategic_fit: 15,
} as const;

export type ScoreComponent = keyof typeof SCORE_COMPONENT_LIMITS;

export interface OutOfRangeHit {
  column: ScoreComponent;
  value: number;
  max: number;
}

export interface OutOfRangeSummary {
  rows: number;
  byColumn: Partial<Record<ScoreComponent, number>>;
  worst: OutOfRangeHit | null;
}

/**
 * Elenca le dimensioni di una riga score che sfondano il proprio massimo.
 *
 * Non normalizza e non scarta nulla: serve a *contare*, non a correggere. I
 * punteggi già scritti appartengono a utenti reali, e un clamp silenzioso al
 * confine della sincronizzazione nasconderebbe il fenomeno invece di chiuderlo.
 */
export function outOfRangeComponents(
  row: Record<string, unknown> | null | undefined,
): OutOfRangeHit[] {
  if (!row || typeof row !== "object") return [];
  const hits: OutOfRangeHit[] = [];
  for (const [column, max] of Object.entries(SCORE_COMPONENT_LIMITS) as [
    ScoreComponent,
    number,
  ][]) {
    const value = row[column];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (value > max || value < 0) hits.push({ column, value, max });
  }
  return hits;
}

/** Aggrega il conteggio fuori scala su un insieme di righe score. */
export function summarizeOutOfRange(
  rows: Iterable<Record<string, unknown>> | null | undefined,
): OutOfRangeSummary {
  const byColumn: Partial<Record<ScoreComponent, number>> = {};
  let affected = 0;
  let worst: OutOfRangeHit | null = null;
  for (const row of rows ?? []) {
    const hits = outOfRangeComponents(row);
    if (hits.length === 0) continue;
    affected++;
    for (const hit of hits) {
      byColumn[hit.column] = (byColumn[hit.column] ?? 0) + 1;
      // "Peggiore" = quanto sfonda in rapporto al proprio tetto, non il valore
      // assoluto: 18/15 e 45/40 sfondano di 3 punti ma non allo stesso modo.
      if (worst === null || hit.value / hit.max > worst.value / worst.max) {
        worst = hit;
      }
    }
  }
  return { rows: affected, byColumn, worst };
}
