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
