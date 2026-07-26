import { cookies } from "next/headers";
import { getSwipeDecks } from "@/lib/queries";
import type { PositionWithScore } from "@/lib/types";
import {
  getExchangeRates,
  convertCurrency,
  type Rates,
} from "@/lib/exchange-rates";
import {
  DISPLAY_CURRENCY_COOKIE,
  sanitizeDisplayCurrency,
} from "@/lib/display-currency";
import SwipeDeck, { type SwipeCardData } from "./SwipeDeck";
import { verdictOf, type Verdict } from "@/lib/position-verdict";

export const dynamic = "force-dynamic";

// Slim mapping: il path locale ritorna p.* (incluso jd_text intero) — al
// client servono solo i campi della card. legacy_id è la chiave delle API
// di swipe (user-exclude/feedback): senza, la carta non è azionabile.
// Gli stipendi vengono convertiti QUI nella valuta di visualizzazione
// (preferenza Impostazioni): così chip, filtro, istogramma e ordinamento
// per stipendio del deck lavorano tutti su una scala omogenea — prima le
// offerte in HUF finivano schiacciate sul bordo alto del filtro.
function toCard(
  p: PositionWithScore,
  displayCurrency: string,
  rates: Rates,
): SwipeCardData {
  const from = p.salary_currency ?? "EUR";
  const converted = from !== displayCurrency;
  const conv = (v: number | null | undefined) =>
    v == null
      ? null
      : converted
        ? Math.round(convertCurrency(v, from, displayCurrency, rates))
        : v;
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
    salary_min: conv(p.salary_min),
    salary_max: conv(p.salary_max),
    salary_currency: displayCurrency,
    salary_converted:
      converted && (p.salary_min != null || p.salary_max != null),
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
export default async function SwipePage() {
  const cookieStore = await cookies();
  const displayCurrency = sanitizeDisplayCurrency(
    cookieStore.get(DISPLAY_CURRENCY_COOKIE)?.value,
  );
  const [{ pending, reviewed }, rates] = await Promise.all([
    getSwipeDecks(),
    getExchangeRates(),
  ]);

  const pendingCards = pending
    .filter((p) => p.legacy_id != null)
    .map((p) => toCard(p, displayCurrency, rates));
  const reviewedCards = reviewed
    .filter((r) => r.position.legacy_id != null)
    .map((r) => toCard(r.position, displayCurrency, rates));

  // Asse del filtro stipendio in migliaia della valuta scelta: equivalente
  // di 200k EUR arrotondato al multiplo di 10k, così la scala resta sensata
  // anche per valute "grandi" (HUF ≈ 80M, non 200k).
  const salaryAxisMaxK = Math.max(
    10,
    Math.round(
      convertCurrency(200_000, "EUR", displayCurrency, rates) / 10_000,
    ) * 10,
  );
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
        salaryAxisMaxK={salaryAxisMaxK}
      />
    </div>
  );
}
