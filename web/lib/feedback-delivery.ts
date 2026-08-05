/**
 * Traduce l'esito tecnico di /api/feedback in uno stato onesto per la UI.
 *
 * Un fallimento di trasporto puo' arrivare come eccezione di fetch oppure
 * come Response con status 0 (per esempio da un browser/proxy): entrambi
 * significano che non e' partito nessun invio. Un 503, invece, e' una
 * risposta del server e non va spacciata per una disconnessione dell'utente.
 */
export type FeedbackDeliveryOutcome =
  | { kind: "offline" }
  | { kind: "rate-limited" }
  | { kind: "not-delivered" }
  | { kind: "delivered"; ticket: string };

export function feedbackDeliveryOutcome(
  response: Pick<Response, "ok" | "status">,
  ticket: unknown,
): FeedbackDeliveryOutcome {
  if (response.status === 0) return { kind: "offline" };
  if (response.status === 429) return { kind: "rate-limited" };

  const reference = typeof ticket === "string" ? ticket.trim() : "";
  if (!response.ok || !reference) return { kind: "not-delivered" };

  return { kind: "delivered", ticket: reference };
}
