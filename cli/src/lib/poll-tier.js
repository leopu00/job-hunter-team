// Cadenza di polling ADATTIVA condivisa dai daemon VPS→cloud.
//
// [JHT-DATA-SYNC / scala] Il costo Vercel scala con il NUMERO DI UTENTI (1 VPS
// ciascuno, non con le tab del browser). Un intervallo FISSO a 5s × N utenti
// satura il piano: con 2 soli account si è già arrivati a un 402 / overage
// (vedi docs/internal/postmortems/2026-05-22-vercel-quota-exhaustion.md). La
// cura non è spegnere i daemon (servono finché l'interazione non passa al
// tunnel desktop) ma POLLARE VELOCE SOLO QUANDO C'È ATTIVITÀ recente, poi fare
// backoff. Stesso schema già collaudato in user-messages-poller.js.
//
// Tre tier in base al tempo dall'ultima ATTIVITÀ reale (= ultimo tick che ha
// fatto lavoro utile: comando processato, cambio di stato, file servito):
//   active    (5s)   — attività < 5 min fa  → bassa latenza quando serve
//   idle      (30s)  — 5–30 min              → l'utente non sta facendo nulla
//   deep-idle (120s) — > 30 min              → quasi spento (solo per i reader
//                       non-latency-critical; i poller di controllo cappano a idle)
//
// `errorBackoff` applica un backoff esponenziale sull'intervallo base.

export const POLL_ACTIVE_MS = 5000;
export const POLL_IDLE_MS = 30000;
export const POLL_DEEP_IDLE_MS = 120000;
export const POLL_MAX_MS = 60000;

const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 min
const DEEP_IDLE_THRESHOLD_MS = 30 * 60 * 1000; // 30 min

// Intervallo (ms) in base a quanto tempo è passato da `lastActivityAt`.
// `allowDeepIdle=false` cappa a idle (30s): per i poller di CONTROLLO, così un
// comando dell'utente viene raccolto entro ≤30s anche dopo lunga inattività.
export function tierInterval(lastActivityAt, { allowDeepIdle = true } = {}) {
  const elapsed = Date.now() - lastActivityAt;
  if (elapsed < IDLE_THRESHOLD_MS) return POLL_ACTIVE_MS;
  if (allowDeepIdle && elapsed >= DEEP_IDLE_THRESHOLD_MS) return POLL_DEEP_IDLE_MS;
  return POLL_IDLE_MS;
}

// Backoff esponenziale sull'intervallo base corrente, cap a POLL_MAX_MS.
export function errorBackoff(baseMs, consecutiveErrors) {
  return Math.min(POLL_MAX_MS, baseMs * 2 ** Math.min(consecutiveErrors, 4));
}
