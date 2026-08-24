"use client";

// [JHT-MSG-REALTIME] Aggiornamenti live dei messaggi agente→utente via
// Supabase Realtime: websocket DIRETTO browser↔Supabase, zero invocazioni
// Vercel, zero polling. Il payload postgres_changes contiene la riga intera
// → il client aggiorna lo stato in place senza alcun refetch.
//
// Consumo: la sottoscrizione vive solo finché il componente è montato; a tab
// chiuso il socket cade da sé. Gli eventi arrivano SOLO quando una riga
// cambia davvero (il merge-RPC del push salta i no-op, mig 057).
//
// Guardie: in local-mode (Supabase non configurato) il client è un mock senza
// `channel` → no-op. Senza sessione (non loggato) → no-op. `setAuth(jwt)` è
// OBBLIGATORIO prima della subscribe: senza, il canale parte con role anon e
// la RLS blocca silenziosamente tutti gli eventi (gotcha E2E 2026-05-23,
// stesso pattern di CloudRefreshButton).

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PendingMessage, PendingMessageKind } from "@/lib/types";

type CloudRow = {
  id?: string;
  agent?: string;
  body?: string;
  kind?: string | null;
  author?: string | null;
  related_position_id?: string | null;
  delivered_via?: string | null;
  delivered_at?: string | null;
  acknowledged_at?: string | null;
  user_reply?: string | null;
  user_reply_at?: string | null;
  agent_seen_reply_at?: string | null;
  created_at?: string;
};

function toPendingMessage(r: CloudRow): PendingMessage | null {
  if (!r?.id || !r.agent || !r.body || !r.created_at) return null;
  const kind: PendingMessageKind =
    r.kind === "question" || r.kind === "digest" || r.kind === "alert"
      ? r.kind
      : "notification";
  return {
    id: String(r.id),
    agent: r.agent,
    body: r.body,
    kind,
    author: r.author === "user" ? "user" : "agent",
    related_position_id: r.related_position_id ?? null,
    delivered_via:
      r.delivered_via === "telegram" || r.delivered_via === "web"
        ? r.delivered_via
        : null,
    delivered_at: r.delivered_at ?? null,
    acknowledged_at: r.acknowledged_at ?? null,
    user_reply: r.user_reply ?? null,
    user_reply_at: r.user_reply_at ?? null,
    agent_seen_reply_at: r.agent_seen_reply_at ?? null,
    created_at: r.created_at,
  };
}

/**
 * Sottoscrive INSERT/UPDATE su pending_user_messages dell'utente loggato.
 * `onChange` riceve la riga normalizzata; il chiamante fa il merge nel
 * proprio stato. Callback tenuta in ref: nessun re-subscribe ai re-render.
 */
export function usePendingMessagesLive(
  onChange: (row: PendingMessage, event: "INSERT" | "UPDATE") => void,
) {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  useEffect(() => {
    const supabase = createClient();
    // Local-mode / mock: nessun Realtime disponibile.
    if (typeof (supabase as { channel?: unknown }).channel !== "function") {
      return;
    }
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let channel: any = null;

    void (async () => {
      try {
        const { data } = (await supabase.auth.getSession()) as {
          data: {
            session: { access_token: string; user: { id: string } } | null;
          };
        };
        if (cancelled || !data.session) return;
        if (supabase.realtime?.setAuth) {
          await supabase.realtime.setAuth(data.session.access_token);
        }
        const userId = data.session.user.id;
        // Auth, subscribe() e il costruttore WebSocket possono fallire sia
        // in modo asincrono sia sincrono. Tutto resta nello stesso catch:
        // senza Realtime il drawer degrada al fetch, non a un rejection non
        // gestito che spezza la pagina.
        channel = supabase
          .channel(`pending_user_messages:live:${userId}`)
          .on(
            "postgres_changes" as never,
            {
              event: "*",
              schema: "public",
              table: "pending_user_messages",
              filter: `user_id=eq.${userId}`,
            },
            (payload: { eventType: string; new: CloudRow }) => {
              if (cancelled) return;
              if (
                payload.eventType !== "INSERT" &&
                payload.eventType !== "UPDATE"
              ) {
                return;
              }
              const row = toPendingMessage(payload.new);
              if (row) cbRef.current(row, payload.eventType);
            },
          )
          .subscribe((status: string) => {
            if (status !== "SUBSCRIBED" || cancelled) return;
            // postgres_changes non riproduce gli eventi persi mentre il
            // socket era giù. Un solo catch-up a ogni (ri)subscribe ricuce
            // la timeline senza introdurre polling; il merge del chiamante
            // è per id, quindi le righe già viste restano idempotenti.
            void (async () => {
              try {
                const response = await fetch("/api/pending-messages", {
                  cache: "no-store",
                });
                if (!response.ok || cancelled) return;
                const snapshot = await response.json();
                if (!Array.isArray(snapshot?.messages)) return;
                for (const raw of snapshot.messages) {
                  const row = toPendingMessage(raw as CloudRow);
                  if (row && !cancelled) cbRef.current(row, "UPDATE");
                }
              } catch {
                /* offline: la prossima riconnessione riprova */
              }
            })();
          });
      } catch {
        channel = null;
      }
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, []);
}
