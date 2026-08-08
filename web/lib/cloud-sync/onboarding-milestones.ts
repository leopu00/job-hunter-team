/**
 * Le milestone di onboarding che il cloud può osservare davvero.
 *
 * [ONBOARDING-STATE-HALF-DEAD] `user_onboarding_state.first_team_run_at`
 * esisteva dalla migration 011 ed era NULL per ogni account in produzione,
 * compresi quelli con migliaia di posizioni: nessuno la scriveva, nessuno la
 * leggeva. Un imbuto mezzo popolato è peggio di nessun imbuto, perché
 * qualcuno lo legge e ci crede.
 *
 * La decisione vive qui e non dentro la route del push per una ragione
 * pratica: quella route è troppo grande per essere collaudata a mock, e la
 * domanda vera — *questo push dimostra che il team ha lavorato?* — è una
 * funzione di pochi numeri, che si può interrogare direttamente.
 */

/** Righe che solo il team può aver prodotto, contate da un singolo push. */
export interface PushCounts {
  positions?: number;
  companies?: number;
  scores?: number;
  applications?: number;
  highlights?: number;
  positionTransitions?: number;
  sentinelTicks?: number;
}

/**
 * Il push porta lavoro degli agenti.
 *
 * Il profilo del candidato NON è in questa lista, e non per distrazione: lo
 * configura la persona, non la squadra, e ha già la sua milestone
 * (`profile_configured_at`). Contarlo qui vorrebbe dire datare il «primo run
 * del team» al giorno in cui l'utente ha caricato il CV — cioè rispondere
 * alla domanda sbagliata con un numero credibile, che è il modo peggiore di
 * sbagliare.
 */
export function teamProducedWork(counts: PushCounts): boolean {
  return (
    (counts.positions ?? 0) > 0 ||
    (counts.companies ?? 0) > 0 ||
    (counts.scores ?? 0) > 0 ||
    (counts.applications ?? 0) > 0 ||
    (counts.highlights ?? 0) > 0 ||
    (counts.positionTransitions ?? 0) > 0 ||
    (counts.sentinelTicks ?? 0) > 0
  );
}

/**
 * La riga da scrivere, o null se non c'è niente da segnare.
 *
 * Si scrive una volta sola: è la data in cui quel team ha cominciato a
 * lavorare, non quella dell'ultimo push. Riscriverla trasformerebbe una
 * milestone in un `last_seen` — che esiste già altrove, e per il quale non
 * varrebbe la pena tenere una colonna.
 */
export function firstTeamRunPatch(
  existing: { first_team_run_at?: string | null } | null,
  userId: string,
  nowIso: string,
): Record<string, unknown> | null {
  if (existing?.first_team_run_at) return null;
  return {
    user_id: userId,
    first_team_run_at: nowIso,
    updated_at: nowIso,
  };
}
