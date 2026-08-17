export interface SyncFreshnessState {
  sync_requested_at?: string | null;
  sync_completed_at?: string | null;
  last_action?: string | null;
  last_action_at?: string | null;
}

// Il daemon prova il full push ogni 15 minuti. Cinque minuti di margine
// coprono tick, coda esclusiva e rete senza mostrare un falso allarme durante
// una sincronizzazione normale.
export const CLOUD_SYNC_STALE_AFTER_MS = 20 * 60 * 1000;

/** Sanitized aggregate published by the box; no table, row or error detail. */
export function cloudPushQuarantineCount(status: string | null): number {
  const match = /^quarantined:(\d{1,6})$/.exec(status ?? "");
  if (!match) return 0;
  const count = Number(match[1]);
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

/**
 * Supabase restituisce gli errori nel risultato, non necessariamente come
 * eccezioni. `undefined` significa "lettura sconosciuta" e non deve diventare
 * uno stato cloud arretrato; `null` resta invece una lettura autorevole senza
 * riga team_state.
 */
export function freshnessRowFromRead<T>(result: {
  data: T | null;
  error: unknown;
}): T | null | undefined {
  return result.error ? undefined : result.data;
}

/** Vero quando il cloud non ha una conferma entro il bound automatico. */
export function cloudSyncIsBehind(
  status: string | null,
  checkedAt: string | null,
  now = Date.now(),
  staleAfterMs = CLOUD_SYNC_STALE_AFTER_MS,
): boolean {
  if (status !== "current") return true;
  const checkedMs = Date.parse(checkedAt ?? "");
  if (!Number.isFinite(checkedMs)) return true;
  // Un timestamp futuro può derivare da clock skew, ma non dimostra ritardo.
  if (checkedMs > now) return false;
  return now - checkedMs > staleAfterMs;
}

const TERMINAL_SYNC_ACTIONS = new Set([
  "sync:completed",
  "sync:timeout",
  "sync:push_failed",
  "sync:ack_failed",
]);

/** Un push periodico non puo' avanzare la freshness durante un Sync now. */
export function syncRequestIsPending(
  state: SyncFreshnessState | null,
): boolean {
  const requestedMs = Date.parse(state?.sync_requested_at ?? "");
  if (!Number.isFinite(requestedMs)) return false;
  const completedMs = Date.parse(state?.sync_completed_at ?? "");
  if (Number.isFinite(completedMs) && completedMs >= requestedMs) return false;

  const actionMs = Date.parse(state?.last_action_at ?? "");
  const terminalForRequest =
    TERMINAL_SYNC_ACTIONS.has(String(state?.last_action ?? "")) &&
    Number.isFinite(actionMs) &&
    actionMs > requestedMs;
  return !terminalForRequest;
}
