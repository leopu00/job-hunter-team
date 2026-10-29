import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSwipeDeck } from "@/app/(protected)/swipe/swipe-cards";
import { DISPLAY_CURRENCY_COOKIE, sanitizeDisplayCurrency } from "@/lib/display-currency";
import { getExchangeRates, type Rates } from "@/lib/exchange-rates";
import { getSwipeDecksCloud } from "@/lib/swipe-decks";
import { getSwipeDecksLocal } from "../../lib/local-swipe";
import { localTeamData } from "../../lib/local-team-data";

export type SwipeDeckProps = ReturnType<typeof buildSwipeDeck>;

export type SwipeSources = {
  /** The cloud's decks, read with the user's session; a local profile's come from the team on this computer. */
  decks: typeof getSwipeDecksCloud;
  localDecks?: typeof getSwipeDecksLocal;
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
  localDecks: getSwipeDecksLocal,
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
  // A profile with no cloud account shows the team of this computer: its decks, never the cloud's.
  const decks = localTeamData()
    ? (sources.localDecks ?? (() => Promise.reject(new Error("local_decks_unavailable"))))()
    : sources.decks(client);
  const [read, rates] = await Promise.all([decks, sources.rates()]);
  return buildSwipeDeck(read, sources.displayCurrency(), rates);
}
