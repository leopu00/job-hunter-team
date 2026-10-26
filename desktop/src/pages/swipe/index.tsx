import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import SwipeDeck from "@/app/(protected)/swipe/SwipeDeck";
import { appLocale } from "../../lib/app-locale";
import { PAGE_STATES_TEXT } from "../../lib/page-states.i18n";
import { supabase } from "../../lib/supabase";
import { useRefresh } from "../../shell/router";
import type { PageProps } from "../types";
import { loadSwipe, type SwipeDeckProps } from "./load-swipe";
import SwipeSkeleton from "./SwipeSkeleton";
import "./swipe.css";

type Load = { state: "loading" } | { state: "ready"; deck: SwipeDeckProps } | { state: "failed" };

/**
 * web/app/(protected)/swipe: il mazzo del web così com'è. Le sue scritture
 * (giudizio, esclusione, sintesi) chiamano /api/positions/…, che il ponte
 * del guscio passa a lib/web-api.ts: stessa scrittura, con la sessione.
 */
export function SwipePage({ client = supabase }: { client?: SupabaseClient }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const read = useCallback(() => {
    loadSwipe(client)
      .then((deck) => setLoad({ state: "ready", deck }))
      .catch(() => setLoad((prev) => (prev.state === "ready" ? prev : { state: "failed" })));
  }, [client]);

  useEffect(read, [read]);
  useRefresh(read);

  const text = PAGE_STATES_TEXT[appLocale()];
  if (load.state === "loading") return <SwipeSkeleton label={text.loadingSwipe} />;
  if (load.state === "failed")
    return (
      <p role="alert" className="max-w-6xl mx-auto px-5 pt-8 text-[12px]" style={{ color: "var(--color-red)" }}>
        {text.swipeFailed}
      </p>
    );
  const { pendingCards, reviewedCards, initialVerdicts, salaryAxisMaxK } = load.deck;
  return (
    <div
      data-testid="desktop-swipe-page"
      className="desktop-swipe-page min-h-0 overflow-hidden"
      style={{
        height: "calc(100svh / var(--zoom, 1) - 3.5rem)",
        animation: "fade-in 0.35s ease both",
      }}
    >
      <SwipeDeck
        pending={pendingCards}
        reviewed={reviewedCards}
        initialVerdicts={initialVerdicts}
        salaryAxisMaxK={salaryAxisMaxK}
        contained
      />
    </div>
  );
}

export default function SwipeRoute(_props: PageProps) {
  return <SwipePage />;
}
