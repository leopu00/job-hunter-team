"use client";

// Chi è il box di questo utente e cosa dichiara di saper fare.
//
// Legge le colonne `client_*` che il box scrive su `cloud_sync_tokens` a
// ogni chiamata cloud-sync ([CLIENT-VERSION-INVISIBLE]) e le incrocia con
// `team_state.active_device_id` per capire QUALE device sta lavorando.
//
// Stesso trasporto di `useChatLaneLive`: lettura diretta browser↔Supabase
// sotto RLS, nessuna invocazione Vercel. Niente Realtime però, e per una
// ragione: la versione di un box cambia quando qualcuno lo aggiorna, cioè
// quasi mai — un canale websocket aperto tutto il giorno per aspettare un
// evento all'anno sarebbe costo puro. Si legge al mount e basta.
//
// In local mode il client è un mock: la SELECT fallisce, resta `null`, e
// chi lo usa tratta `null` come "non so" — che è esattamente il caso in cui
// il gate non deve scattare.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { pickActiveBox, type BoxClientRow } from "@/lib/box-client";

export function useBoxClient(): BoxClientRow | null {
  const [box, setBox] = useState<BoxClientRow | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    void (async () => {
      try {
        const [tokensRes, stateRes] = await Promise.all([
          supabase
            .from("cloud_sync_tokens")
            .select(
              "id, client_version, client_platform, client_capabilities, client_seen_at",
            )
            .is("revoked_at", null),
          supabase.from("team_state").select("active_device_id").maybeSingle(),
        ]);
        if (cancelled) return;
        const tokens = (tokensRes.data ?? []) as BoxClientRow[];
        if (tokens.length === 0) return;
        const activeDeviceId =
          (stateRes.data as { active_device_id?: string | null } | null)
            ?.active_device_id ?? null;
        setBox(pickActiveBox(tokens, activeDeviceId));
      } catch {
        /* local mode, offline o progetto non migrato: resta "non so" */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return box;
}
