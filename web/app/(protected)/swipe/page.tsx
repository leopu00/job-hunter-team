import { getSwipeDeck } from "@/lib/queries";
import SwipeDeck, { type SwipeCardData } from "./SwipeDeck";

export const dynamic = "force-dynamic";

export default async function SwipePage() {
  const deck = await getSwipeDeck(100);

  // Slim mapping: il path locale ritorna p.* (incluso jd_text intero) — al
  // client servono solo i campi della card. legacy_id è la chiave delle API
  // di swipe (user-exclude/feedback): senza, la carta non è azionabile.
  const cards: SwipeCardData[] = deck
    .filter((p) => p.legacy_id != null)
    .map((p) => ({
      id: p.id,
      legacy_id: p.legacy_id as number,
      title: p.title,
      company: p.company,
      location: p.location,
      loc_city: p.loc_city ?? null,
      loc_country: p.loc_country ?? null,
      remote_type: p.remote_type,
      role_family: p.role_family ?? null,
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
    }));

  return (
    <div
      className="px-4 pt-2 pb-1"
      style={{ animation: "fade-in 0.35s ease both" }}
    >
      <SwipeDeck cards={cards} />
    </div>
  );
}
