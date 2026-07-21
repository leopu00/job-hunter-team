"use client";

// [JHT-WEB-NOTIFICATIONS] Runtime delle notifiche browser (solo web cloud).
//
// Montato una volta nella navbar (WebNotificationsAgent). Ascolta gli stessi
// eventi Realtime già usati dalla UI (websocket diretto browser↔Supabase,
// zero Vercel) e li traduce in notifiche di sistema:
//   · messaggi agente→utente (pending_user_messages INSERT)
//   · regole configurabili sulle posizioni (positions INSERT/UPDATE, mig 058)
// Le preferenze arrivano da notification_prefs (lettura diretta con RLS) con
// cache localStorage; il salvataggio dalla pagina impostazioni riscrive la
// cache → l'evento 'storage' riallinea le altre tab senza round-trip.
//
// Nessun service worker / Web Push: le notifiche vivono finché una tab del
// sito è aperta (requisito esplicito: "se l'utente sta sul browser").

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { agentInfo } from "@/lib/message-display";
import { useLocale } from "@/lib/use-locale";
import {
  addPending,
  alreadySeen,
  cachePrefs,
  clearPending,
  markSeen,
  normalizePrefs,
  matchesRule,
  readCachedPrefs,
  DEFAULT_PREFS,
  PREFS_CACHE_KEY,
  type PositionEventRow,
  type WebNotificationPrefs,
} from "@/lib/web-notifications";

type MessageRow = {
  id?: string;
  agent?: string;
  body?: string;
  delivered_via?: string | null;
  acknowledged_at?: string | null;
};

function stripMd(s: string): string {
  return s.replace(/\*\*|\*|`/g, "");
}

export function useWebNotifications() {
  const router = useRouter();
  const locale = useLocale();
  const localeRef = useRef(locale);
  localeRef.current = locale;

  const [prefs, setPrefs] = useState<WebNotificationPrefs>(
    () => readCachedPrefs() ?? DEFAULT_PREFS,
  );
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  // Prefs dal cloud al mount (cache come fast-path) + riallineo cross-tab
  // via evento 'storage' quando la pagina impostazioni salva.
  useEffect(() => {
    const supabase = createClient();
    if (typeof (supabase as { channel?: unknown }).channel === "function") {
      void (async () => {
        const { data } = await supabase
          .from("notification_prefs")
          .select("prefs")
          .maybeSingle();
        if (data?.prefs) {
          const p = normalizePrefs(data.prefs);
          setPrefs(p);
          cachePrefs(p);
        }
      })();
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === PREFS_CACHE_KEY) {
        const cached = readCachedPrefs();
        if (cached) setPrefs(cached);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const active =
    prefs.enabled &&
    typeof window !== "undefined" &&
    "Notification" in window &&
    Notification.permission === "granted";

  useEffect(() => {
    if (!active) return;
    const supabase = createClient();
    if (typeof (supabase as { channel?: unknown }).channel !== "function") {
      return; // local-mode: feature solo web cloud
    }
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let channel: any = null;

    const shouldSuppress = () =>
      prefsRef.current.onlyWhenHidden &&
      document.visibilityState === "visible";

    const notify = (
      title: string,
      body: string,
      tag: string,
      href: string,
    ) => {
      try {
        const n = new Notification(title, { body, tag });
        n.onclick = () => {
          window.focus();
          router.push(href);
          n.close();
        };
      } catch {
        /* Notification può lanciare su piattaforme senza supporto */
      }
    };

    const onMessage = (row: MessageRow) => {
      const p = prefsRef.current;
      if (!p.messages || shouldSuppress()) return;
      if (!row?.id || !row.agent || !row.body) return;
      if (row.delivered_via !== "web" || row.acknowledged_at) return;
      const info = agentInfo(row.agent, localeRef.current);
      const preview = stripMd(row.body).split("\n").find((l) => l.trim()) ?? "";
      notify(
        info.name,
        preview.slice(0, 160),
        `jht-msg-${row.id}`,
        "/messages",
      );
    };

    const onPosition = (row: PositionEventRow, event: "INSERT" | "UPDATE") => {
      const p = prefsRef.current;
      if (!row?.id || shouldSuppress()) return;
      for (const rule of p.rules) {
        if (!matchesRule(rule, row, event)) continue;
        if (alreadySeen(rule.id, row.id)) continue;
        markSeen(rule.id, row.id);
        const label = [
          row.title ?? "?",
          row.company ? `— ${row.company}` : "",
          typeof row.score === "number" ? `· score ${row.score}` : "",
          row.location ? `· ${row.location}` : "",
        ]
          .filter(Boolean)
          .join(" ");
        if (rule.minCount <= 1) {
          notify(rule.name, label.slice(0, 180), `jht-rule-${rule.id}-${row.id}`, `/positions/${row.id}`);
          continue;
        }
        // Digest: accumula e notifica al raggiungimento della soglia.
        const pending = addPending(rule.id, row.title ?? "?");
        if (pending.length >= rule.minCount) {
          clearPending(rule.id);
          notify(
            rule.name,
            `${pending.length}× — ${pending.slice(-3).join(" · ")}`.slice(0, 180),
            `jht-rule-${rule.id}-digest`,
            "/positions",
          );
        }
      }
    };

    void (async () => {
      const { data } = (await supabase.auth.getSession()) as {
        data: {
          session: { access_token: string; user: { id: string } } | null;
        };
      };
      if (cancelled || !data.session) return;
      // setAuth PRIMA della subscribe: senza JWT il canale è anon e la RLS
      // sopprime in silenzio ogni evento (gotcha E2E 2026-05-23).
      if (supabase.realtime?.setAuth) {
        supabase.realtime.setAuth(data.session.access_token);
      }
      const userId = data.session.user.id;
      channel = supabase.channel(`web-notifications:${userId}`);
      channel.on(
        "postgres_changes" as never,
        {
          event: "INSERT",
          schema: "public",
          table: "pending_user_messages",
          filter: `user_id=eq.${userId}`,
        },
        (payload: { new: MessageRow }) => {
          if (!cancelled) onMessage(payload.new);
        },
      );
      channel.on(
        "postgres_changes" as never,
        {
          event: "*",
          schema: "public",
          table: "positions",
          filter: `user_id=eq.${userId}`,
        },
        (payload: { eventType: string; new: PositionEventRow }) => {
          if (cancelled) return;
          if (payload.eventType !== "INSERT" && payload.eventType !== "UPDATE")
            return;
          onPosition(payload.new, payload.eventType);
        },
      );
      channel.subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
    // Il canale dipende solo dall'on/off: le regole si leggono da ref, così
    // modificarle non ricrea la subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, router]);
}

/** Componente invisibile da montare nella navbar. */
export default function WebNotificationsAgent() {
  useWebNotifications();
  return null;
}
