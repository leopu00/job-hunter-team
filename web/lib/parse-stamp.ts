/**
 * Il timbro di una riga del team, come istante.
 *
 * Le righe di SQLite (`positions.found_at`, `scores.scored_at`, gli eventi del
 * team…) portano `YYYY-MM-DD HH:MM:SS` o `YYYY-MM-DDTHH:MM:SS` SENZA fuso, e
 * sono UTC: lo stesso criterio di `parseInstant` (lib/apply-request-rule.ts)
 * e di `timestampMillis` (lib/sync-vocabulary.ts). `new Date(valore)` invece
 * li legge come ora LOCALE: in un computer a UTC+1 un evento di cinque minuti
 * fa risulta di un'ora e cinque minuti fa, e una posizione delle 15:41 UTC
 * mostra «03:41 PM» mentre l'orologio dice le 4:41 PM.
 *
 * Una funzione sola per tutti i punti che mostrano un timbro del team: da qui
 * esce sempre un istante vero, e il formato (ora locale della persona) lo
 * decide chi lo scrive con `toLocaleString`, come il pannello Agenti.
 */
export function parseStamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const text = value.trim();
  if (!text) return null;
  const zoned = /[zZ]$|[+-]\d\d(:?\d\d)?$/.test(text) && /\d{2}:\d{2}/.test(text);
  const naive = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(text) && !zoned;
  const date = new Date(naive ? `${text.replace(" ", "T")}Z` : text);
  return Number.isNaN(date.getTime()) ? null : date;
}
