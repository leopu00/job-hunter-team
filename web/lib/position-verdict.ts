/**
 * Verdetto mostrato su una posizione: come si combinano il feedback
 * esplicito dell'utente e il punteggio dello Scorer.
 *
 * Stava scritto due volte, identico, nella pagina di dettaglio e nella
 * vista swipe. Due copie di una regola di dominio sono un bug che
 * aspetta: basta ritoccarne una perché la stessa posizione risulti "top"
 * di là e "da rivedere" di qua.
 */
export type Verdict = "no" | "review_low" | "review_ok" | "top";

/**
 * `action` è il feedback dell'utente (`star`, `dislike`, `hide`, …),
 * `score` il voto dello Scorer. Il feedback esplicito vince sempre sul
 * punteggio; in sua assenza decide il voto.
 */
export function verdictOf(action: string, score: number | null): Verdict {
  if (action === "star") return "top";
  if (action === "dislike" || action === "hide")
    return score === 2 ? "review_low" : "no";
  if (score != null && score <= 2) return "review_low";
  if (score != null && score >= 5) return "top";
  return "review_ok";
}

/** Verdetti dal più negativo al più positivo. */
export const VERDICT_ORDER: Verdict[] = [
  "no",
  "review_low",
  "review_ok",
  "top",
];

/**
 * Cosa viene spedito al backend quando l'utente sceglie un verdetto:
 * l'azione e il punteggio registrati su `position_feedback`, il segnale
 * di direzione per lo Scout e se la posizione va esclusa.
 */
export type VerdictSignal = {
  action: "like" | "dislike" | "star";
  score: number;
  direction: "more_like_this" | "less_like_this" | null;
  exclude?: boolean;
};

/**
 * Verdetto → segnale. È l'inverso di `verdictOf`, che dalla coppia
 * (action, score) risale al verdetto: le due devono restare coerenti, e
 * per questo stanno nello stesso file.
 *
 * Era ricopiata in `FeedbackButtons` e in `SwipeDeck` — i due modi che
 * l'utente ha di esprimere lo stesso giudizio — con tanto di commenti
 * che si citavano a vicenda per tenerle allineate a mano. Se divergono,
 * lo stesso giudizio scrive dati diversi a seconda di dove viene dato.
 */
export const VERDICT_SIGNAL: Record<Verdict, VerdictSignal> = {
  no: { action: "dislike", score: 1, direction: "less_like_this", exclude: true },
  // 'Poco interessante' NON è un dislike (scelta utente 18/07): la
  // posizione resta tenuta (niente esclusione) e non manda un segnale
  // less_like_this allo Scout — è un keep con entusiasmo basso.
  review_low: { action: "like", score: 2, direction: null },
  review_ok: { action: "like", score: 4, direction: "more_like_this" },
  top: { action: "star", score: 5, direction: "more_like_this" },
};
