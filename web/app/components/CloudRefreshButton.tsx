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
// Flusso: PATCH /api/team-state { sync_requested_at } (timbrato lato server) →
// il daemon VPS lo rileva, pusha e marca sync_completed_at → il browser lo
// riceve via Supabase REALTIME (websocket diretto, NIENTE polling, zero
// invocazioni Vercel) e fa un router.refresh().
//
// [JHT-DATA-FRESH-SIGNAL] Oltre al rendezvous esplicito, la route di push
// timbra sync_completed_at a ogni push che porta dati dashboard: qui lo
// intercettiamo come segnale "dati freschi" e aggiorniamo da soli (throttled,
// solo a tab visibile) — l'utente non deve più né premere il pulsante né
// ricaricare la pagina per vedere i dati nuovi.
//
// Fix UX 2026-07-21 (sintomi: "premo e non succede niente", "si ferma anche
// se ha sincronizzato, i dati cambiano solo ricaricando"):
//   1. setAuth(jwt) PRIMA della subscribe — senza, il canale parte anon e la
//      RLS blocca in silenzio tutti gli eventi (gotcha E2E 2026-05-23).
//   2. Niente confronti con l'orologio del browser: il completamento si
//      riconosce come avanzamento di sync_completed_at rispetto all'ultimo
//      valore NOTO DAL SERVER (baseline alla richiesta).
//   3. Un completamento in ritardo (VPS in deep-idle polla ogni 120s) aggiorna
//      comunque i dati appena arriva, anche dopo il timeout dello spinner.

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
    updatedNow: string;
    vpsSlow: string;
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
    updatedNow: "Dati aggiornati",
    vpsSlow:
      "La VPS non ha ancora risposto — i dati si aggiorneranno da soli appena arriva il push",
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
    updatedNow: "Data updated",
    vpsSlow:
      "The VPS hasn't answered yet — data will refresh automatically as soon as its push lands",
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
    updatedNow: "Datos actualizados",
    vpsSlow:
      "El VPS aún no ha respondido: los datos se actualizarán solos en cuanto llegue su push",
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
    updatedNow: "Données mises à jour",
    vpsSlow:
      "Le VPS n'a pas encore répondu — les données se rafraîchiront dès l'arrivée de son push",
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
    updatedNow: "Daten aktualisiert",
    vpsSlow:
      "Der VPS hat noch nicht geantwortet — die Daten aktualisieren sich automatisch, sobald sein Push ankommt",
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
    updatedNow: "Adatok frissítve",
    vpsSlow:
      "A VPS még nem válaszolt — az adatok automatikusan frissülnek, amint megérkezik a push",
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
    updatedNow: "Dados atualizados",
    vpsSlow:
      "O VPS ainda não respondeu — os dados serão atualizados automaticamente assim que o push chegar",
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

// Throttle degli auto-refresh spontanei: ogni router.refresh() costa una
// render server-side su Vercel — il segnale può arrivare a ogni push della
// VPS (~30-60s a team attivo), il refetch no.
const REFRESH_THROTTLE_MS = 90_000;
// Rete di sicurezza spinner: la VPS in deep-idle polla il rendezvous ogni
// 120s + tempo di push → 60s (valore storico) scadeva quasi sempre prima
// del completamento legittimo.
const REQUEST_TIMEOUT_MS = 180_000;

export default function CloudRefreshButton() {
  const router = useRouter();
  const t = T[useLocale()];
  const [remote, setRemote] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const mounted = useRef(true);

  // Ultimo sync_completed_at NOTO (timestamp del server): unico riferimento
  // per riconoscere gli avanzamenti — mai l'orologio del browser.
  const lastSyncRef = useRef<string | null>(null);
  // Richiesta "Sync now" in corso + baseline (completed al momento del click).
  const pendingRef = useRef(false);
  const baselineRef = useRef<string | null>(null);
  const requestTokenRef = useRef(0);
  // Primo valore dal catch-up iniziale: è la baseline, non un avanzamento
  // (i dati SSR appena renderizzati sono già allineati a quel timestamp).
  const initializedRef = useRef(false);
  // Auto-refresh: throttle + refresh rimandato quando il tab è nascosto.
  const lastRefreshMsRef = useRef(0);
  const staleRef = useRef(false);
  const staleTimerRef = useRef<number | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (staleTimerRef.current != null)
        window.clearTimeout(staleTimerRef.current);
      if (flashTimerRef.current != null)
        window.clearTimeout(flashTimerRef.current);
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

  function showFlash() {
    setFlash(true);
    if (flashTimerRef.current != null)
      window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => {
      flashTimerRef.current = null;
      if (mounted.current) setFlash(false);
    }, 4000);
  }

  // Refetch dei dati. force=true (completamento di un Sync now esplicito)
  // bypassa throttle e visibilità; force=false (push spontaneo della VPS)
  // rispetta entrambi e in caso rimanda: al rientro del tab o allo scadere
  // della finestra di throttle.
  function doRefresh(force: boolean) {
    if (!mounted.current) return;
    if (!force) {
      if (document.visibilityState === "hidden") {
        staleRef.current = true;
        return;
      }
      const elapsed = Date.now() - lastRefreshMsRef.current;
      if (elapsed < REFRESH_THROTTLE_MS) {
        staleRef.current = true;
        if (staleTimerRef.current == null) {
          staleTimerRef.current = window.setTimeout(
            () => {
              staleTimerRef.current = null;
              if (staleRef.current) doRefresh(false);
            },
            REFRESH_THROTTLE_MS - elapsed + 250,
          );
        }
        return;
      }
    }
    staleRef.current = false;
    lastRefreshMsRef.current = Date.now();
    router.refresh();
    showFlash();
  }

  // Tab di nuovo visibile con dati arretrati → recupera il refresh rimandato.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && staleRef.current) {
        doRefresh(false);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function requestSync() {
    if (syncing) return;
    setError(null);
    setSyncing(true);
    pendingRef.current = true;
    baselineRef.current = lastSyncRef.current;
    const token = ++requestTokenRef.current;
    try {
      const res = await fetch("/api/team-state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Il valore è solo un trigger: la route lo timbra lato server
        // (orologio browser fuori dall'equazione del rendezvous).
        body: JSON.stringify({ sync_requested_at: new Date().toISOString() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        if (mounted.current && requestTokenRef.current === token) {
          setError(d.error || `HTTP ${res.status}`);
          setSyncing(false);
          pendingRef.current = false;
        }
        return;
      }
    } catch (err) {
      if (mounted.current && requestTokenRef.current === token) {
        setError(err instanceof Error ? err.message : t.networkError);
        setSyncing(false);
        pendingRef.current = false;
      }
      return;
    }

    // Rete di sicurezza: se la VPS non risponde entro la finestra, togliamo
    // lo spinner e lo diciamo. La subscription resta viva: al push in ritardo
    // i dati si aggiornano comunque (apply → doRefresh).
    window.setTimeout(() => {
      if (
        mounted.current &&
        pendingRef.current &&
        requestTokenRef.current === token
      ) {
        pendingRef.current = false;
        setSyncing(false);
        setError(t.vpsSlow);
      }
    }, REQUEST_TIMEOUT_MS);
  }

  // [REALTIME] Sottoscrizione ai cambi di team_state — niente polling. Supabase
  // PUSHA l'update sul websocket quando la VPS (o la route di push) scrive
  // sync_completed_at; la RLS fa sì che il browser riceva SOLO la propria riga.
  // All'apertura (e a ogni riconnessione) una lettura di catch-up.
  useEffect(() => {
    if (!remote || !loggedIn) return;
    const supabase = createClient();

    type StateRow = { sync_completed_at?: string | null };
    const apply = (row: StateRow | null) => {
      if (!mounted.current) return;
      const done = row?.sync_completed_at ?? null;
      if (!done) return;
      const doneMs = Date.parse(done);
      if (Number.isNaN(doneMs)) return;
      const prev = lastSyncRef.current;
      const prevMs = prev ? Date.parse(prev) : NaN;
      if (!Number.isNaN(prevMs) && doneMs <= prevMs) return; // niente di nuovo
      lastSyncRef.current = done;
      setLastSync(done);

      if (!initializedRef.current) {
        initializedRef.current = true;
        // Primo valore visto: solo baseline — a meno che un Sync now non sia
        // già in volo (row team_state appena nata), nel qual caso prosegui.
        if (!pendingRef.current) return;
      }

      setError(null);
      if (pendingRef.current) {
        const baseMs = baselineRef.current
          ? Date.parse(baselineRef.current)
          : 0;
        if (doneMs > baseMs) {
          pendingRef.current = false;
          requestTokenRef.current++; // invalida il timeout dello spinner
          setSyncing(false);
          doRefresh(true);
          return;
        }
      }
      // Push spontaneo della VPS → dati freschi: refresh throttled.
      doRefresh(false);
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

    // Client non configurato (mock): niente websocket, resta solo il catch-up.
    if (typeof supabase.channel !== "function") {
      void catchUp();
      return;
    }

    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let channel: any = null;
    void (async () => {
      // Auth del canale col JWT user PRIMA della subscribe: senza, il canale
      // parte con role anon → la RLS blocca in silenzio ogni postgres_changes
      // e il completamento non arriva MAI (root cause del "Sync now morto").
      const { data } = (await supabase.auth.getSession()) as {
        data: { session: { access_token: string } | null };
      };
      if (cancelled) return;
      const jwt = data.session?.access_token;
      if (jwt && supabase.realtime?.setAuth) {
        supabase.realtime.setAuth(jwt);
      }
      channel = supabase
        .channel("cloud-sync-status")
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "team_state" },
          (payload: { new: StateRow }) => {
            if (!cancelled) apply(payload.new);
          },
        )
        .subscribe((status: string) => {
          // Alla (ri)connessione recupera lo stato corrente (eventi persi
          // a socket giù).
          if (status === "SUBSCRIBED" && !cancelled) void catchUp();
        });
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote, loggedIn]);

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
      {flash && (
        <span style={{ color: "var(--color-green)" }}>{t.updatedNow}</span>
      )}
      {!flash && lastSync && !syncing && (
        <span>{t.updated(formatRelativeTime(lastSync, t))}</span>
      )}
      {error && <span style={{ color: "var(--color-yellow)" }}>{error}</span>}
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
