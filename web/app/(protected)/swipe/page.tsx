import { getSwipeDecks } from "@/lib/queries";
import type { PositionWithScore } from "@/lib/types";
import SwipeDeck, { type SwipeCardData, type Verdict } from "./SwipeDeck";

export const dynamic = "force-dynamic";

// Slim mapping: il path locale ritorna p.* (incluso jd_text intero) — al
// client servono solo i campi della card. legacy_id è la chiave delle API
// di swipe (user-exclude/feedback): senza, la carta non è azionabile.
function toCard(p: PositionWithScore): SwipeCardData {
  return {
    id: p.id,
    legacy_id: p.legacy_id as number,
    title: p.title,
    company: p.company,
    location: p.location,
    loc_city: p.loc_city ?? null,
    loc_country: p.loc_country ?? null,
    remote_type: p.remote_type,
    role_family: p.role_family ?? null,
    source: p.source ?? null,
    found_at: p.found_at,
    score: p.score ?? null,
    salary_min: p.salary_min ?? null,
    salary_max: p.salary_max ?? null,
    salary_currency: p.salary_currency ?? "EUR",
    // Fallback per le posizioni pre-mig-049 senza sintesi: il JD grezzo
    // troncato — meglio del vuoto sulla card. \r\n normalizzati perché
    // la card renderizza con white-space: pre-line.
    jd_summary:
      p.jd_summary ??
      (p.jd_text
        ? p.jd_text.replace(/\r\n/g, "\n").trim().slice(0, 1500)
        : null),
  };
}

// Ultimo evento feedback → giudizio della scala a 4 (inverso della
// mappatura VERDICTS in SwipeDeck; i vecchi eventi senza score cadono
// sul giudizio più vicino all'action).
function verdictOf(action: string, score: number | null): Verdict {
  if (action === "star") return "top";
  if (action === "dislike" || action === "hide")
    return score === 2 ? "review_low" : "no";
  if (score != null && score <= 2) return "review_low";
  if (score != null && score >= 5) return "top";
  return "review_ok";
}

export default async function SwipePage() {
  const { pending, reviewed } = await getSwipeDecks(100);

  const pendingCards = pending.filter((p) => p.legacy_id != null).map(toCard);
  const reviewedCards = reviewed
    .filter((r) => r.position.legacy_id != null)
    .map((r) => toCard(r.position));
  const initialVerdicts: Record<string, Verdict> = Object.fromEntries(
    reviewed
      .filter((r) => r.position.legacy_id != null)
      .map((r) => [r.position.id, verdictOf(r.action, r.fb_score)]),
  );

  return (
    <div
      className="px-4 pt-2 pb-1"
      style={{ animation: "fade-in 0.35s ease both" }}
    >
      <SwipeDeck
        pending={pendingCards}
        reviewed={reviewedCards}
        initialVerdicts={initialVerdicts}
      />
    </div>
  );
}
