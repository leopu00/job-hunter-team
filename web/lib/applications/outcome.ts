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

// ── O-105 · perché hanno detto di no ────────────────────────────────
//
// Il motivo sta QUI e non in `exclusion-reasons.ts`, che ha una lista simile e
// risponde a un'altra domanda: là si dice «perché NON MI interessa» (chiusa,
// già candidato, non in linea col mio profilo), qui «perché HANNO detto di
// no». Fondere le due sarebbe un vocabolario in più travestito da riuso.

/**
 * I motivi che l'utente può scegliere, decisi dall'operatore.
 *
 * Non c'è nessun `other`, e non è una dimenticanza: nell'esclusione quella
 * voce esiste perché il campo di testo compare SOLO scegliendola. Qui il testo
 * è sempre disponibile accanto alla lista, quindi «altro» non avrebbe niente
 * da fare — sarebbe una scelta che significa «guarda nell'altro campo».
 *
 * ⚠️ Nessun CHECK vincola questa lista sul database, come già per `response`.
 * È deliberato: un motivo nuovo dev'essere una riga qui e sette etichette, non
 * una migrazione. Il prezzo è che il vocabolario lo fa rispettare il codice —
 * il che vale per tutti i valori che scriviamo su quella tabella.
 */
export const REJECTION_REASONS = [
  "location",
  "salary",
  "experience",
  "language",
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

/** Il testo libero è un campo, non un tema: oltre questo si tronca l'utente. */
export const REJECTION_NOTE_MAX = 500;

export function isRejectionReason(value: unknown): value is RejectionReason {
  return (
    typeof value === "string" &&
    (REJECTION_REASONS as readonly string[]).includes(value)
  );
}

/**
 * Che cosa si registra quando l'utente dichiara un rifiuto.
 *
 * Funzione pura di proposito, come `negativeSignalFor` per l'esclusione: la
 * regola è il contenuto del ticket e va verificata senza un browser.
 *
 * Le tre cose che decide, e che sono tutte state scelte e non ereditate:
 *
 *  1. **Il motivo non è obbligatorio.** Dei quattro predefiniti nessuno copre
 *     il rifiuto più comune che esista — «hanno preso un altro» — e obbligare
 *     a scegliere vorrebbe dire farsi dare un motivo falso: il conteggio del
 *     Mentor peggiorerebbe invece di migliorare. Un rifiuto senza motivo resta
 *     un rifiuto, che è già il comportamento di oggi.
 *  2. **Il testo non sostituisce il motivo.** Se ci sono entrambi si salvano
 *     entrambi; il testo non viene mai promosso a motivo né viceversa. Sono
 *     due colonne perché sono due cose: una si conta, l'altra si legge.
 *  3. **Un motivo che non conosciamo si rifiuta**, non si salva com'è. Il
 *     campo è TEXT libero sul database, quindi è il solo punto in cui la lista
 *     viene fatta rispettare davvero.
 */
/**
 * Che cosa chiede un click, quando lo stesso bottone serve due gesti.
 *
 * Nata da un difetto vero, scritto e corretto lo stesso giorno: il bottone
 * «Salva» del motivo chiamava la stessa funzione del pulsante dell'esito, che
 * decide di ANNULLARE quando l'esito cliccato è quello già attivo. Salvare il
 * perché di un rifiuto già dichiarato passava quindi per «rifiuto cliccato due
 * volte» e cancellava il rifiuto: un utente che spiega perché l'hanno scartato
 * si sarebbe visto cancellare il fatto che l'hanno scartato.
 *
 * Sta qui e non nel componente perché è una decisione, non un rendering — la
 * stessa ragione per cui `negativeSignalFor` vive fuori da `ReasonPicker`.
 */
export type OutcomeClickIntent = "declare" | "undo" | "update_reason";

export function outcomeClickIntent({
  current,
  clicked,
  reasonOnly = false,
}: {
  current: DeclarableOutcome | null;
  clicked: DeclarableOutcome;
  /** Il click viene dal «Salva» del motivo, non dal pulsante dell'esito. */
  reasonOnly?: boolean;
}): OutcomeClickIntent {
  if (reasonOnly) return "update_reason";
  return current === clicked ? "undo" : "declare";
}

export type RejectionDetail =
  | { kind: "ok"; reason: RejectionReason | null; note: string | null }
  | { kind: "invalid"; field: "reason" | "note" };

export function rejectionDetailFor(
  reason: unknown,
  note: unknown,
): RejectionDetail {
  const chiave = typeof reason === "string" ? reason.trim() : "";
  if (chiave && !isRejectionReason(chiave)) {
    return { kind: "invalid", field: "reason" };
  }
  if (note != null && typeof note !== "string") {
    return { kind: "invalid", field: "note" };
  }
  const testo = (typeof note === "string" ? note : "").trim();
  if (testo.length > REJECTION_NOTE_MAX) {
    return { kind: "invalid", field: "note" };
  }
  return {
    kind: "ok",
    reason: chiave ? (chiave as RejectionReason) : null,
    note: testo || null,
  };
}
