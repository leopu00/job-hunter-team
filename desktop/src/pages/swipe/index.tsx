import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import SwipeDeck from "@/app/(protected)/swipe/SwipeDeck";
import { appLocale } from "../../lib/app-locale";
import { useLocalTeamData } from "../../lib/local-team-data";
import { PAGE_STATES_TEXT } from "../../lib/page-states.i18n";
import { cloudClient } from "../../lib/cloud-client";
import { readOnce, withReadDeadline } from "../../lib/read-deadline";
import CloudDataNotice, { useCloudDataBlocked } from "../../shell/CloudDataNotice";
import { useRefresh } from "../../shell/router";
import { SHELL_TEXT } from "../../shell/shell.i18n";
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
export function SwipePage({ client = cloudClient() }: { client?: SupabaseClient }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  // A local profile has no cloud account, and its deck is read from the team on this computer: no cloud notice.
  const blocked = useCloudDataBlocked() && !useLocalTeamData();

  const read = useCallback(() => {
    withReadDeadline(readOnce("swipe", () => loadSwipe(client)))
      .then((deck) => setLoad({ state: "ready", deck }))
      .catch(() => setLoad((prev) => (prev.state === "ready" ? prev : { state: "failed" })));
  }, [client]);

  useEffect(read, [read]);
  useRefresh(read);

  const text = PAGE_STATES_TEXT[appLocale()];
  // No cloud session (a local profile): only the notice, not «deck finished» about a deck never read.
  if (blocked) return <CloudDataNotice />;
  if (load.state === "loading") return <SwipeSkeleton label={text.loadingSwipe} />;
  if (load.state === "failed")
    return (
      <div className="max-w-6xl mx-auto px-5 pt-8">
        <p role="alert" className="text-[12px]" style={{ color: "var(--color-red)" }}>
          {text.swipeFailed}
        </p>
        <button
          type="button"
          className="mt-3 border border-[var(--color-border)] rounded px-3 py-1.5 text-[12px]"
          onClick={() => { setLoad({ state: "loading" }); read(); }}
        >
          {SHELL_TEXT[appLocale()].retry}
        </button>
      </div>
    );
  const { pendingCards, reviewedCards, initialVerdicts, salaryAxisMaxK } = load.deck;
  return (
    <>
      <div
        data-testid="desktop-swipe-page"
        className="desktop-swipe-page min-h-0 overflow-hidden"
        style={{
          // the whole of the space the Shell gives it: the window under the navbar and its bars
          height: "100%",
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
    </>
  );
}

export default function SwipeRoute(_props: PageProps) {
  return <SwipePage />;
}
