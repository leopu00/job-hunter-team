// Stato della scadenza di un token cloud-sync, per la lista dei token.
//
// Un token web scaduto scollega il box in silenzio: verifyBearerToken
// risponde 401 e nessuno lo vede finché qualcuno non guarda la dashboard
// ferma. La lista deve quindi dire quanto manca, e alzare la voce in tempo
// per generare un token nuovo e incollarlo nel box.

/** Giorni di preavviso: da qui in giù la riga del token diventa un avviso.
 *  Due settimane coprono un box che si guarda una volta a settimana. */
export const TOKEN_EXPIRY_WARNING_DAYS = 14;

const DAY_MS = 86_400_000;

export type TokenExpiry =
  | { kind: "none" }
  | { kind: "unknown" }
  | { kind: "expired"; expiresAt: string }
  | {
      kind: "active";
      expiresAt: string;
      /** Giorni interi rimasti, arrotondati per eccesso: 1 = scade entro 24h. */
      daysLeft: number;
      warning: boolean;
    };

export function tokenExpiry(
  expiresAt: string | null | undefined,
  now: number = Date.now(),
): TokenExpiry {
  if (expiresAt === null || expiresAt === undefined) return { kind: "none" };
  const at = new Date(expiresAt).getTime();
  if (Number.isNaN(at)) return { kind: "unknown" };
  // Stesso confine di verifyBearerToken: scaduto quando expires_at <= adesso.
  if (at <= now) return { kind: "expired", expiresAt };
  const daysLeft = Math.ceil((at - now) / DAY_MS);
  return {
    kind: "active",
    expiresAt,
    daysLeft,
    warning: daysLeft <= TOKEN_EXPIRY_WARNING_DAYS,
  };
}
