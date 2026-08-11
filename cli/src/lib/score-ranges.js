/**
 * Tetti per dimensione di uno score, lato JS.
 *
 * L'autorità è `_validate_score_range` in `shared/skills/db_insert.py`: quello
 * è il solo writer che rifiuta un valore fuori scala, e questi numeri devono
 * restare i suoi. `tests/js/tasks/score-ranges.test.ts` li rilegge dal sorgente
 * Python e fallisce se i due righelli divergono — perché divergere in silenzio
 * è esattamente come il difetto è nato: la tabella dei pesi dello Scorer e
 * l'esempio sotto sono rimasti su due scale diverse per mesi.
 *
 * Nota sul totale: la somma dei tetti fa 110, non 100, mentre `--total` è
 * validato 0..100. La contraddizione è nota e non si chiude qui.
 */
export const SCORE_COMPONENT_LIMITS = Object.freeze({
  stack_match: 40,
  remote_fit: 25,
  salary_fit: 20,
  experience_fit: 10,
  strategic_fit: 15,
});

/**
 * Elenca le dimensioni di una riga score che sfondano il proprio massimo.
 *
 * Non normalizza e non scarta nulla: serve a *contare*, non a correggere. I
 * punteggi già scritti appartengono a utenti reali e un clamp silenzioso al
 * confine nasconderebbe il fenomeno invece di renderlo misurabile.
 *
 * @param {Record<string, unknown>} row riga score (locale o cloud)
 * @returns {Array<{column: string, value: number, max: number}>}
 */
export function outOfRangeComponents(row) {
  if (!row || typeof row !== 'object') return [];
  const found = [];
  for (const [column, max] of Object.entries(SCORE_COMPONENT_LIMITS)) {
    const value = row[column];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (value > max || value < 0) found.push({ column, value, max });
  }
  return found;
}

/**
 * Aggrega il conteggio fuori scala su un insieme di righe.
 *
 * @param {Iterable<Record<string, unknown>>} rows
 * @returns {{rows: number, byColumn: Record<string, number>, worst: {column: string, value: number, max: number} | null}}
 */
export function summarizeOutOfRange(rows) {
  const byColumn = {};
  let affected = 0;
  let worst = null;
  for (const row of rows ?? []) {
    const hits = outOfRangeComponents(row);
    if (hits.length === 0) continue;
    affected++;
    for (const hit of hits) {
      byColumn[hit.column] = (byColumn[hit.column] ?? 0) + 1;
      // "Peggiore" = quanto sfonda in rapporto al proprio tetto, non il valore
      // assoluto: 18/15 e 45/40 sfondano di 3 punti ma non allo stesso modo.
      if (worst === null || hit.value / hit.max > worst.value / worst.max) worst = hit;
    }
  }
  return { rows: affected, byColumn, worst };
}
