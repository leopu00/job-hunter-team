"use client";

// Lo stato della CORSIA della chat, dal vivo: `team_state.chat_requested_at`
// (il campanello che il sito suona a ogni messaggio) contro
// `chat_delivered_at` (la conferma che il box ha ritirato tutto).
//
// Serve a una cosa sola: distinguere "l'agente sta pensando" da "nessuno ha
// ritirato il tuo messaggio". Senza questo dato la chat mostrava la bolla
// come inviata e taceva per sempre — il 24/07 per sei ore.
//
// Stesso trasporto di CloudRefreshButton: lettura di catch-up + Supabase
// Realtime (websocket DIRETTO browser↔Supabase). Zero polling e zero
// invocazioni Vercel — la regola di casa, e qui conta doppio perché la
// pagina della chat resta aperta a lungo.
//
// Guardie: in local mode il client è un mock senza `channel` (e la SELECT
// torna un errore) → resta `null`, e chi lo usa decide sulla sola età della
// riga. `setAuth(jwt)` PRIMA della subscribe è OBBLIGATORIO: senza, il
// canale parte con role anon e la RLS blocca in silenzio ogni evento
// (gotcha E2E 2026-05-23).
//
// Il canale ascolta SOLO la riga dell'utente loggato: filtro esplicito
// `user_id=eq.<uid>` sopra la RLS, e l'handler scarta comunque un payload
// che porta un altro user_id. Senza sessione non si sottoscrive nulla.

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ChatLane } from "@/lib/chat-delivery";

type LaneRow = {
  user_id?: string | null;
  chat_requested_at?: string | null;
  chat_delivered_at?: string | null;
};

// Ogni montaggio ha il suo topic: due superfici della chat aperte insieme,
// o uno smontaggio seguito da un rimontaggio, non riusano lo stesso canale.
let laneMountSeq = 0;

export interface ChatLaneLive {
  lane: ChatLane | null;
  /**
   * Rilegge la corsia adesso.
   *
   * Serve dopo un'azione che la cambia — «richiama il box» riscrive
   * `chat_requested_at` — perché l'unico aggiornamento automatico è
   * l'evento Realtime, e Realtime può non esserci: Safari su http, un
   * socket caduto, una rete che blocca i websocket. In quei casi la
   * richiesta partiva davvero, il messaggio diceva «fatto» e la bolla
   * restava gialla: l'interfaccia contraddiceva sé stessa proprio nel
   * momento in cui l'utente aveva appena agito.
   */
  refresh: () => void;
}

export function useChatLaneLive(): ChatLaneLive {
  const [lane, setLane] = useState<ChatLane | null>(null);
  // La lettura di catch-up vive dentro l'effect (ha bisogno del client e
  // della guardia `cancelled`): la ref è il modo di offrirla a chi sta
  // fuori senza duplicarla né rifare la subscribe.
  const catchUpRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let channel: any = null;

    const apply = (row: LaneRow | null) => {
      if (cancelled || !row) return;
      // Le colonne `chat_*` (mig 060) possono non esistere su un progetto
      // non ancora migrato: in quel caso arrivano `undefined` e la corsia
      // resta muta invece di dichiarare un guasto che non sa di avere.
      if (!("chat_requested_at" in row) && !("chat_delivered_at" in row))
        return;
      setLane({
        requestedAt: row.chat_requested_at ?? null,
        deliveredAt: row.chat_delivered_at ?? null,
      });
    };

    const catchUp = async () => {
      try {
        const { data } = await supabase
          .from("team_state")
          .select("chat_requested_at, chat_delivered_at")
          .maybeSingle();
        apply(data as LaneRow | null);
      } catch {
        /* offline o local mode: nessuna corsia da mostrare */
      }
    };

    catchUpRef.current = () => void catchUp();
    void catchUp();

    // Local mode / mock: niente websocket, resta il solo catch-up.
    if (typeof (supabase as { channel?: unknown }).channel !== "function") {
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const { data } = (await supabase.auth.getSession()) as {
          data: {
            session: { access_token: string; user: { id: string } } | null;
          };
        };
        if (cancelled || !data.session) return;
        const userId = data.session.user.id;
        if (supabase.realtime?.setAuth)
          await supabase.realtime.setAuth(data.session.access_token);
        // Smontato durante setAuth: nessun canale da creare (la cleanup è
        // già passata e non lo rimuoverebbe più).
        if (cancelled) return;
        // subscribe() (e il costruttore WebSocket) possono LANCIARE
        // SINCRONO — Safari su http://localhost: "The operation is
        // insecure". Senza Realtime la chat degrada al catch-up, non si
        // rompe.
        channel = supabase
          .channel(`chat-lane:${userId}:${++laneMountSeq}`)
          .on(
            "postgres_changes" as never,
            {
              event: "UPDATE",
              schema: "public",
              table: "team_state",
              filter: `user_id=eq.${userId}`,
            },
            (payload: { new: LaneRow; old?: LaneRow }) => {
              // Difesa in profondità: una riga di un altro utente non
              // muove mai la corsia, qualunque cosa abbia fatto passare.
              const oldOwner = payload.old?.user_id;
              if (payload.new?.user_id !== userId) return;
              if (oldOwner != null && oldOwner !== userId) return;
              apply(payload.new);
            },
          )
          .subscribe((status: string) => {
            // Alla (ri)connessione recupera lo stato corrente: gli eventi
            // passati a socket giù sono persi per sempre.
            if (status === "SUBSCRIBED" && !cancelled) void catchUp();
          });
      } catch {
        channel = null;
      }
    })();

    return () => {
      cancelled = true;
      catchUpRef.current = null;
      if (channel) void supabase.removeChannel(channel);
    };
  }, []);

  const refresh = useCallback(() => {
    catchUpRef.current?.();
  }, []);

  return { lane, refresh };
}
