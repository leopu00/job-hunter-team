import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import SwipeDeck from "@/app/(protected)/swipe/SwipeDeck";
import { supabase } from "../../lib/supabase";
import { useRefresh } from "../../shell/router";
import type { PageProps } from "../types";
import { loadSwipe, type SwipeDeckProps } from "./load-swipe";

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

  if (load.state === "loading")
    return (
      <p role="status" className="px-4 pt-8 text-center text-[12px] text-[var(--color-muted)]">
        Caricamento del mazzo…
      </p>
    );
  if (load.state === "failed")
    return (
      <p role="alert" className="max-w-6xl mx-auto px-5 pt-8 text-[12px]" style={{ color: "var(--color-red)" }}>
        Non riesco a leggere le posizioni da giudicare. Controlla la connessione e premi «Aggiorna».
      </p>
    );
  const { pendingCards, reviewedCards, initialVerdicts, salaryAxisMaxK } = load.deck;
  return (
    <div className="px-4 pt-2 pb-1" style={{ animation: "fade-in 0.35s ease both" }}>
      <SwipeDeck
        pending={pendingCards}
        reviewed={reviewedCards}
        initialVerdicts={initialVerdicts}
        salaryAxisMaxK={salaryAxisMaxK}
      />
    </div>
  );
}

export default function SwipeRoute(_props: PageProps) {
  return <SwipePage />;
}
