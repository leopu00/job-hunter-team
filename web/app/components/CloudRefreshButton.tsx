"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import { createClient } from "@/lib/supabase/client";

// "Sync now" lato CLOUD ([JHT-DATA-SYNC] fase 3). Mirror del CloudSyncStatusBanner
// (che è LOCAL-only): quello pusha SQLite→cloud, questo chiede alla VPS un push
// fresco on-demand, senza polling continuo del browser.
//
// Flusso: PATCH /api/team-state { sync_requested_at } → il daemon VPS lo rileva,
// pusha e marca sync_completed_at → il browser lo riceve via Supabase REALTIME
// (websocket, NIENTE polling) e fa UN solo router.refresh(). All'apertura NON
// sincronizza: mostra solo l'ultimo timestamp; il refresh avviene SOLO col pulsante.
// Si mostra SOLO su cloud (status.remote) e loggato: in locale c'è il banner.

const T: Record<
  Locale,
  {
    now: string;
    fewSecondsAgo: string;
    secAgo: (n: number) => string;
    minAgo: (n: number) => string;
    hourAgo: (n: number) => string;
    daysAgo: (n: number) => string;
    updated: (rel: string) => string;
    networkError: string;
    syncing: string;
    syncNow: string;
    title: string;
  }
> = {
  it: {
    now: "ora",
    fewSecondsAgo: "pochi secondi fa",
    secAgo: (n) => `${n} sec fa`,
    minAgo: (n) => (n === 1 ? "1 min fa" : `${n} min fa`),
    hourAgo: (n) => (n === 1 ? "1 ora fa" : `${n} ore fa`),
    daysAgo: (n) => (n === 1 ? "1 giorno fa" : `${n} giorni fa`),
    updated: (rel) => `Aggiornato ${rel}`,
    networkError: "Errore di rete",
    syncing: "Sync…",
    syncNow: "Sync now",
    title: "Chiedi alla VPS un aggiornamento dei dati ora",
  },
  en: {
    now: "now",
    fewSecondsAgo: "a few seconds ago",
    secAgo: (n) => `${n} sec ago`,
    minAgo: (n) => (n === 1 ? "1 min ago" : `${n} min ago`),
    hourAgo: (n) => (n === 1 ? "1 hour ago" : `${n} hours ago`),
    daysAgo: (n) => (n === 1 ? "1 day ago" : `${n} days ago`),
    updated: (rel) => `Updated ${rel}`,
    networkError: "Network error",
    syncing: "Sync…",
    syncNow: "Sync now",
    title: "Ask the VPS for a data refresh now",
  },
  es: {
    now: "ahora",
    fewSecondsAgo: "hace unos segundos",
    secAgo: (n) => `hace ${n} s`,
    minAgo: (n) => (n === 1 ? "hace 1 min" : `hace ${n} min`),
    hourAgo: (n) => (n === 1 ? "hace 1 hora" : `hace ${n} horas`),
    daysAgo: (n) => (n === 1 ? "hace 1 día" : `hace ${n} días`),
    updated: (rel) => `Actualizado ${rel}`,
    networkError: "Error de red",
    syncing: "Sync…",
    syncNow: "Sync now",
    title: "Pedir a la VPS una actualización de datos ahora",
  },
  fr: {
    now: "maintenant",
    fewSecondsAgo: "il y a quelques secondes",
    secAgo: (n) => `il y a ${n} s`,
    minAgo: (n) => (n === 1 ? "il y a 1 min" : `il y a ${n} min`),
    hourAgo: (n) => (n === 1 ? "il y a 1 heure" : `il y a ${n} heures`),
    daysAgo: (n) => (n === 1 ? "il y a 1 jour" : `il y a ${n} jours`),
    updated: (rel) => `Mis à jour ${rel}`,
    networkError: "Erreur réseau",
    syncing: "Sync…",
    syncNow: "Sync now",
    title: "Demander au VPS une actualisation des données maintenant",
  },
  de: {
    now: "jetzt",
    fewSecondsAgo: "vor wenigen Sekunden",
    secAgo: (n) => `vor ${n} Sek.`,
    minAgo: (n) => (n === 1 ? "vor 1 Min." : `vor ${n} Min.`),
    hourAgo: (n) => (n === 1 ? "vor 1 Stunde" : `vor ${n} Stunden`),
    daysAgo: (n) => (n === 1 ? "vor 1 Tag" : `vor ${n} Tagen`),
    updated: (rel) => `Aktualisiert ${rel}`,
    networkError: "Netzwerkfehler",
    syncing: "Sync…",
    syncNow: "Sync now",
    title: "Den VPS jetzt um eine Datenaktualisierung bitten",
  },
  hu: {
    now: "most",
    fewSecondsAgo: "néhány másodperce",
    secAgo: (n) => `${n} mp.-e`,
    minAgo: (n) => `${n} perce`,
    hourAgo: (n) => (n === 1 ? "1 órája" : `${n} órája`),
    daysAgo: (n) => (n === 1 ? "1 napja" : `${n} napja`),
    updated: (rel) => `Frissítve ${rel}`,
    networkError: "Hálózati hiba",
    syncing: "Sync…",
    syncNow: "Sync now",
    title: "Kérj a VPS-től friss adatfrissítést most",
  },
  pt: {
    now: "agora",
    fewSecondsAgo: "há alguns segundos",
    secAgo: (n) => `há ${n} s`,
    minAgo: (n) => (n === 1 ? "há 1 min" : `há ${n} min`),
    hourAgo: (n) => (n === 1 ? "há 1 hora" : `há ${n} horas`),
    daysAgo: (n) => (n === 1 ? "há 1 dia" : `há ${n} dias`),
    updated: (rel) => `Atualizado ${rel}`,
    networkError: "Erro de rede",
    syncing: "Sync…",
    syncNow: "Sync now",
    title: "Pedir ao VPS uma atualização dos dados agora",
  },
};

function formatRelativeTime(iso: string, t: (typeof T)[Locale]): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return t.now;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return sec <= 5 ? t.fewSecondsAgo : t.secAgo(sec);
  const min = Math.floor(sec / 60);
  if (min < 60) return t.minAgo(min);
  const hr = Math.floor(min / 60);
  if (hr < 24) return t.hourAgo(hr);
  const days = Math.floor(hr / 24);
  return t.daysAgo(days);
}

export default function CloudRefreshButton() {
  const router = useRouter();
  const t = T[useLocale()];
  const [remote, setRemote] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  // Timestamp della richiesta sync in corso (null = nessuna pendente): il callback
  // Realtime lo usa per capire se un sync_completed_at in arrivo è "il nostro".
  const requestedAtRef = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Determina cloud-vs-local + login (stessa fonte del banner locale).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/local/sync/status");
        if (!res.ok) return;
        const s = await res.json();
        if (!mounted.current) return;
        setRemote(!!s.remote);
        setLoggedIn(!!s.logged_in);
      } catch {
        /* offline: resta nascosto */
      }
    })();
  }, []);

  async function requestSync() {
    if (syncing) return;
    setError(null);
    setSyncing(true);
    const requestedAt = new Date().toISOString();
    requestedAtRef.current = requestedAt;
    try {
      const res = await fetch("/api/team-state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sync_requested_at: requestedAt }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        if (mounted.current) {
          setError(d.error || `HTTP ${res.status}`);
          setSyncing(false);
          requestedAtRef.current = null;
        }
        return;
      }
    } catch (err) {
      if (mounted.current) {
        setError(err instanceof Error ? err.message : t.networkError);
        setSyncing(false);
        requestedAtRef.current = null;
      }
      return;
    }

    // NIENTE polling: il completamento arriva via Realtime (vedi useEffect sotto).
    // Rete di sicurezza: se entro ~60s non arriva nulla (es. VPS offline), togliamo
    // lo spinner — i dati a video restano gli ultimi noti.
    window.setTimeout(() => {
      if (mounted.current && requestedAtRef.current === requestedAt) {
        requestedAtRef.current = null;
        setSyncing(false);
      }
    }, 60_000);
  }

  // [REALTIME] Sottoscrizione ai cambi di team_state — niente polling. Supabase
  // PUSHA l'update sul websocket quando la VPS scrive sync_completed_at; la RLS fa
  // sì che il browser riceva SOLO la propria riga. All'apertura (e a ogni
  // riconnessione) una lettura di catch-up: timestamp iniziale + recupero di un
  // eventuale completamento avvenuto mentre il socket era giù.
  useEffect(() => {
    if (!remote || !loggedIn) return;
    const supabase = createClient();

    type StateRow = { sync_completed_at?: string | null };
    const apply = (row: StateRow | null) => {
      const done = row?.sync_completed_at ?? null;
      if (!done) return;
      setLastSync((prev) => (prev && prev >= done ? prev : done));
      const req = requestedAtRef.current;
      if (req && done >= req) {
        requestedAtRef.current = null;
        if (mounted.current) {
          setSyncing(false);
          router.refresh();
        }
      }
    };

    const catchUp = async () => {
      try {
        const { data } = await supabase
          .from("team_state")
          .select("sync_completed_at")
          .maybeSingle();
        if (mounted.current) apply(data as StateRow | null);
      } catch {
        /* offline: nessun timestamp */
      }
    };
    void catchUp();

    // Client non configurato (mock): niente websocket, resta solo il catch-up.
    if (typeof supabase.channel !== "function") return;

    const channel = supabase
      .channel("cloud-sync-status")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "team_state" },
        (payload: { new: StateRow }) => apply(payload.new),
      )
      .subscribe((status: string) => {
        // Alla (ri)connessione recupera lo stato corrente (eventi persi a socket giù).
        if (status === "SUBSCRIBED") void catchUp();
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [remote, loggedIn, router]);

  if (!remote || !loggedIn) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.6rem",
        justifyContent: "flex-end",
        marginBottom: "0.75rem",
        fontSize: "0.8rem",
        color: "var(--color-muted)",
      }}
    >
      {lastSync && !syncing && (
        <span>{t.updated(formatRelativeTime(lastSync, t))}</span>
      )}
      {error && <span style={{ color: "var(--color-red)" }}>{error}</span>}
      <button
        onClick={() => void requestSync()}
        disabled={syncing}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.35rem",
          padding: "0.3rem 0.7rem",
          borderRadius: "6px",
          border: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          color: "var(--color-text)",
          cursor: syncing ? "default" : "pointer",
          opacity: syncing ? 0.6 : 1,
        }}
        title={t.title}
      >
        <span style={{ display: "inline-block", transformOrigin: "center" }}>
          ↻
        </span>
        {syncing ? t.syncing : t.syncNow}
      </button>
    </div>
  );
}
