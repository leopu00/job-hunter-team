import { cookies } from "next/headers";
import { getSwipeDecks } from "@/lib/queries";
import { getExchangeRates } from "@/lib/exchange-rates";
import {
  DISPLAY_CURRENCY_COOKIE,
  sanitizeDisplayCurrency,
} from "@/lib/display-currency";
import SwipeDeck from "./SwipeDeck";
import { buildSwipeDeck } from "./swipe-cards";

export const dynamic = "force-dynamic";

export default async function SwipePage() {
  const cookieStore = await cookies();
  const displayCurrency = sanitizeDisplayCurrency(
    cookieStore.get(DISPLAY_CURRENCY_COOKIE)?.value,
  );
  const [{ pending, reviewed }, rates] = await Promise.all([
    getSwipeDecks(),
    getExchangeRates(),
  ]);

  const { pendingCards, reviewedCards, salaryAxisMaxK, initialVerdicts } =
    buildSwipeDeck({ pending, reviewed }, displayCurrency, rates);

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
