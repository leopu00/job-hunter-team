import RULE_FILE from "../../shared/cloud/apply-request-rule.json";
import type { ApplyRequestState } from "@/lib/apply-request-rule";

// [JHT-CLOSER] Il tetto giornaliero delle candidature AUTORIZZATE DAL SITO, detto all'utente.
//
// Il box ne invia al più `DEFAULT_MAX_WEB_PER_DAY` (5) al giorno per le posizioni il cui flag è stato
// acceso dal sito (`apply_requested_by = user_web`); le altre restano autorizzate e partono il giorno
// dopo (`daily_web_cap_reached`, nella coda del gate). La porta del sito ne ammette di più (15): i due
// tetti restano com'è e la pagina deve dire la verità, cioè «in coda: parte domani», non «autorizzata»
// come se partisse al prossimo giro e non «errore».
//
// Qui non si decide niente: si guardano le candidature già partite oggi (stessi canali automatici e stessa
// origine del gate) e si dice se il tetto è pieno. Il giorno è quello locale dell'utente, come per il box.

/** Lo stesso valore di `DEFAULT_MAX_WEB_PER_DAY` in `shared/skills/apply_gate.py`: un test li confronta. */
export const WEB_DAILY_CAP = 5;
/** L'origine che consuma il tetto: quella del sito. */
export const WEB_ORIGIN = "user_web";

/** I canali automatici del gate: gli stessi, dal JSON che legge anche il gate. */
export const AUTOMATED_APPLIED_VIA: readonly string[] = Array.isArray(
  (RULE_FILE as { automated_applied_via?: unknown }).automated_applied_via,
)
  ? (RULE_FILE as { automated_applied_via: string[] }).automated_applied_via
  : [];

const sameLocalDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/**
 * Il tetto di oggi è pieno? `sentAt` sono gli istanti delle candidature automatiche, partite dal sito, che
 * il sito conosce. Ciò che non è un istante valido non conta; più invii per lo stesso istante contano uno
 * ciascuno (sono posizioni diverse).
 */
export function webCapReached(
  sentAt: readonly (string | null | undefined)[],
  now: Date,
  cap: number = WEB_DAILY_CAP,
): boolean {
  let today = 0;
  for (const value of sentAt) {
    if (!value) continue;
    const at = new Date(value);
    if (Number.isNaN(at.getTime())) continue;
    if (sameLocalDay(at, now)) today++;
  }
  return today >= cap;
}

/**
 * Come `isQueuedForTomorrow`, per una resa che non conosce ancora il giorno dell'utente: sul server e nel
 * browser prima del montaggio `now` è assente, e allora non si dice «domani» (si dice «autorizzata»).
 */
export function queuedTomorrowAt(
  now: Date | null,
  input: {
    state: ApplyRequestState;
    authorisedBy: string | null | undefined;
    sentAt: readonly (string | null | undefined)[];
  },
): boolean {
  return now !== null && isQueuedForTomorrow({ ...input, now });
}

/**
 * Questa candidatura aspetta domani? Solo se è autorizzata (non in invio, non ferma, non partita), la
 * autorizzazione l'ha data il sito (le altre non consumano il tetto) e il tetto di oggi è pieno.
 */
export function isQueuedForTomorrow(input: {
  state: ApplyRequestState;
  authorisedBy: string | null | undefined;
  sentAt: readonly (string | null | undefined)[];
  now: Date;
}): boolean {
  return (
    input.state.kind === "authorised" &&
    input.authorisedBy === WEB_ORIGIN &&
    webCapReached(input.sentAt, input.now)
  );
}
