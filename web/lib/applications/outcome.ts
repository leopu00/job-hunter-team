// Il vocabolario dell'esito di una candidatura (#187), in un posto solo.
//
// `applications.response` è TEXT libero: nessun CHECK lo vincola, né in SQLite
// né in Postgres. Prima di questo ticket ne circolavano cinque versioni e una
// sola aveva un lettore vero — il Mentor, che su questi valori calcola
// interview rate, rejection rate e ghost rate
// (`agents/_skills/mentor-patterns/SKILL.md`, Pattern D). Ha vinto quello.
//
// I valori sono LETTERALI e non si traducono: la traduzione vive nelle
// etichette dei pulsanti, non nel database.

/** I tre esiti che il Mentor conta. */
export const APPLICATION_OUTCOMES = [
  "interview",
  "rejected",
  "ghosted",
] as const;
export type ApplicationOutcome = (typeof APPLICATION_OUTCOMES)[number];

/**
 * Quelli che l'utente può DICHIARARE.
 *
 * `ghosted` non è qui, ed è una scelta: il Mentor lo DERIVA (nessuna risposta
 * oltre i 30 giorni, `db_query.py applications`). Un pulsante «nessuna
 * risposta» darebbe alla stessa cosa due definizioni, che divergono al primo
 * ripensamento sulla soglia — e il silenzio, a differenza di un rifiuto, non è
 * un evento che l'utente osserva: è un'assenza che si misura.
 */
export const DECLARABLE_OUTCOMES = ["interview", "rejected"] as const;
export type DeclarableOutcome = (typeof DECLARABLE_OUTCOMES)[number];

export function isDeclarableOutcome(
  value: unknown,
): value is DeclarableOutcome {
  return (
    typeof value === "string" &&
    (DECLARABLE_OUTCOMES as readonly string[]).includes(value)
  );
}

/** Il primo colloquio è il round 1; i successivi li scrive il team. */
export const FIRST_INTERVIEW_ROUND = 1;
