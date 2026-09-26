import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSwipeDeck } from "@/app/(protected)/swipe/swipe-cards";
import { DISPLAY_CURRENCY_COOKIE, sanitizeDisplayCurrency } from "@/lib/display-currency";
import { getExchangeRates, type Rates } from "@/lib/exchange-rates";
import { getSwipeDecksCloud } from "@/lib/swipe-decks";

export type SwipeDeckProps = ReturnType<typeof buildSwipeDeck>;

export type SwipeSources = {
  decks: typeof getSwipeDecksCloud;
  rates: () => Promise<Rates>;
  displayCurrency: () => string;
};

/** La preferenza di Impostazioni → Valuta, dove il web la tiene: il cookie. */
export function readDisplayCurrency(cookie: string = typeof document === "undefined" ? "" : document.cookie): string {
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${DISPLAY_CURRENCY_COOKIE}=([^;]+)`));
  return sanitizeDisplayCurrency(match?.[1]);
}

const SOURCES: SwipeSources = {
  decks: getSwipeDecksCloud,
  rates: getExchangeRates,
  displayCurrency: () => readDisplayCurrency(),
};

/**
 * web/app/(protected)/swipe/page.tsx, lato desktop: gli stessi due mazzi
 * (lib/swipe-decks.ts) letti con la sessione dell'utente, e le stesse carte
 * (swipe-cards.ts), stipendi convertiti nella valuta di visualizzazione.
 */
export async function loadSwipe(
  client: Pick<SupabaseClient, "from">,
  sources: SwipeSources = SOURCES,
): Promise<SwipeDeckProps> {
  const [decks, rates] = await Promise.all([sources.decks(client), sources.rates()]);
  return buildSwipeDeck(decks, sources.displayCurrency(), rates);
}
