// Inattività di un token cloud-sync, per la lista dei token.
//
// I token web dei box non scadono più: l'unica difesa contro un token
// dimenticato (box spento, rivenduto, reinstallato) è la revoca a mano. La
// lista deve quindi dire quale token nessuno usa da tempo.
//
// last_used_at si aggiorna al massimo una volta l'ora (LAST_USED_THROTTLE_MS
// in auth.ts): è un segnale buono a giorni, non a ore. La soglia sta molto
// sopra quella granularità.

/** Giorni senza uso oltre i quali la riga del token diventa un avviso. */
export const TOKEN_INACTIVITY_WARNING_DAYS = 30;

const DAY_MS = 86_400_000;

export interface TokenActivityFields {
  last_used_at: string | null;
  created_at: string;
  revoked_at?: string | null;
}

export type TokenInactivity =
  | { inactive: false }
  | {
      inactive: true;
      /** Giorni interi dall'ultimo uso, o dalla creazione se mai usato. */
      days: number;
      neverUsed: boolean;
    };

export function tokenInactivity(
  token: TokenActivityFields,
  now: number = Date.now(),
): TokenInactivity {
  // Un token revocato non autentica più niente: non c'è nulla da revocare.
  if (token.revoked_at) return { inactive: false };
  const neverUsed = !token.last_used_at;
  const since = new Date(token.last_used_at ?? token.created_at).getTime();
  if (Number.isNaN(since)) return { inactive: false };
  const idleMs = now - since;
  if (idleMs <= TOKEN_INACTIVITY_WARNING_DAYS * DAY_MS) {
    return { inactive: false };
  }
  return { inactive: true, days: Math.floor(idleMs / DAY_MS), neverUsed };
}
