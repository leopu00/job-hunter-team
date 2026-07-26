/**
 * Valori ammessi nelle colonne vincolate, condivisi dalle due direzioni
 * della sincronizzazione: `api/cloud-sync/push` (locale → Supabase) e
 * `api/local/sync` (Supabase → SQLite).
 *
 * Erano dichiarati in copia in entrambe le route. È il tipo di
 * duplicazione che si paga in silenzio: se una delle due liste accetta
 * uno stato che l'altra scarta, la stessa riga sopravvive da un lato e
 * viene riscritta dall'altro a ogni giro di sync, senza che nulla
 * segnali l'errore.
 */

// `positions.application_status` — CHECK sul cloud.
// 'ready' = CV finito + Critic PASS (lo Scrittore lo setta nel gate finale,
// single-writer). DEVE restare in whitelist: senza, normalizeApplicationStatus
// lo degrada a 'draft' e la pagina posizione mostra "draft" pur avendo il CV
// pronto — il CHECK cloud lo ammette già (mig 014_applications_status_ready).
export const ALLOWED_APPLICATION_STATUS = new Set([
  "draft",
  "review",
  "ready",
  "approved",
  "applied",
  "response",
]);

/** `positions.status` — stato della posizione nella pipeline. */
export const ALLOWED_POSITION_STATUS = new Set([
  "new",
  "checked",
  "excluded",
  "scored",
  "writing",
  "review",
  "ready",
  "applied",
  "response",
]);

/** `positions.critic_verdict` — CHECK sul cloud. */
export const ALLOWED_CRITIC_VERDICT = new Set([
  "PASS",
  "NEEDS_WORK",
  "REJECT",
]);

/**
 * Stato posizione sanificato. Fuori vocabolario torna a `new`: la
 * posizione ricomincia il giro di pipeline invece di sparire.
 */
export function normalizePositionStatus(s: string | null | undefined): string {
  if (!s) return "new";
  return ALLOWED_POSITION_STATUS.has(s) ? s : "new";
}

/**
 * Stato candidatura sanificato. Un valore fuori vocabolario diventa
 * `draft` invece di far fallire l'intera riga: meglio una posizione
 * riportata all'inizio del percorso che una posizione persa.
 */
export function normalizeApplicationStatus(
  s: string | null | undefined,
): string | null {
  if (!s) return null;
  return ALLOWED_APPLICATION_STATUS.has(s) ? s : "draft";
}

/**
 * Verdetto del Critico sanificato. Qui un valore ignoto diventa `null`
 * (nessun verdetto) e non un default: inventare un giudizio che il
 * Critico non ha dato sarebbe peggio che non averne.
 */
export function normalizeCriticVerdict(
  v: string | null | undefined,
): string | null {
  if (!v) return null;
  return ALLOWED_CRITIC_VERDICT.has(v) ? v : null;
}
