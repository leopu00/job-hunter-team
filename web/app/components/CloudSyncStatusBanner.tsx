"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import type { SyncCounts } from "@/lib/types";

interface SyncStatus {
  local: boolean;
  logged_in: boolean;
  remote?: boolean;
  last_sync: { at: string } | null;
  local_counts: SyncCounts;
  cloud_counts: SyncCounts;
  in_sync: boolean;
}

const T: Record<
  Locale,
  {
    inFuture: string;
    fewSecondsAgo: string;
    secAgo: (n: number) => string;
    minAgo: (n: number) => string;
    hourAgo: (n: number) => string;
    daysAgo: (n: number) => string;
    cloudSync: string;
    toSync: string;
    last: string;
    neverSynced: string;
    syncing: string;
    syncNow: string;
    networkError: string;
  }
> = {
  it: {
    inFuture: "nel futuro",
    fewSecondsAgo: "pochi secondi fa",
    secAgo: (n) => `${n} sec fa`,
    minAgo: (n) => (n === 1 ? "1 min fa" : `${n} min fa`),
    hourAgo: (n) => (n === 1 ? "1 ora fa" : `${n} ore fa`),
    daysAgo: (n) => (n === 1 ? "1 giorno fa" : `${n} giorni fa`),
    cloudSync: "✓ Cloud sync",
    toSync: "◐ Da sincronizzare",
    last: "Ultimo:",
    neverSynced: "Mai sincronizzato",
    syncing: "Sync…",
    syncNow: "Sync now",
    networkError: "Errore di rete",
  },
  en: {
    inFuture: "in the future",
    fewSecondsAgo: "a few seconds ago",
    secAgo: (n) => `${n} sec ago`,
    minAgo: (n) => (n === 1 ? "1 min ago" : `${n} min ago`),
    hourAgo: (n) => (n === 1 ? "1 hour ago" : `${n} hours ago`),
    daysAgo: (n) => (n === 1 ? "1 day ago" : `${n} days ago`),
    cloudSync: "✓ Cloud sync",
    toSync: "◐ To sync",
    last: "Last:",
    neverSynced: "Never synced",
    syncing: "Sync…",
    syncNow: "Sync now",
    networkError: "Network error",
  },
  es: {
    inFuture: "en el futuro",
    fewSecondsAgo: "hace unos segundos",
    secAgo: (n) => `hace ${n} s`,
    minAgo: (n) => (n === 1 ? "hace 1 min" : `hace ${n} min`),
    hourAgo: (n) => (n === 1 ? "hace 1 hora" : `hace ${n} horas`),
    daysAgo: (n) => (n === 1 ? "hace 1 día" : `hace ${n} días`),
    cloudSync: "✓ Cloud sync",
    toSync: "◐ Por sincronizar",
    last: "Último:",
    neverSynced: "Nunca sincronizado",
    syncing: "Sync…",
    syncNow: "Sync now",
    networkError: "Error de red",
  },
  fr: {
    inFuture: "dans le futur",
    fewSecondsAgo: "il y a quelques secondes",
    secAgo: (n) => `il y a ${n} s`,
    minAgo: (n) => (n === 1 ? "il y a 1 min" : `il y a ${n} min`),
    hourAgo: (n) => (n === 1 ? "il y a 1 heure" : `il y a ${n} heures`),
    daysAgo: (n) => (n === 1 ? "il y a 1 jour" : `il y a ${n} jours`),
    cloudSync: "✓ Cloud sync",
    toSync: "◐ À synchroniser",
    last: "Dernier :",
    neverSynced: "Jamais synchronisé",
    syncing: "Sync…",
    syncNow: "Sync now",
    networkError: "Erreur réseau",
  },
  de: {
    inFuture: "in der Zukunft",
    fewSecondsAgo: "vor wenigen Sekunden",
    secAgo: (n) => `vor ${n} Sek.`,
    minAgo: (n) => (n === 1 ? "vor 1 Min." : `vor ${n} Min.`),
    hourAgo: (n) => (n === 1 ? "vor 1 Stunde" : `vor ${n} Stunden`),
    daysAgo: (n) => (n === 1 ? "vor 1 Tag" : `vor ${n} Tagen`),
    cloudSync: "✓ Cloud sync",
    toSync: "◐ Zu synchronisieren",
    last: "Zuletzt:",
    neverSynced: "Nie synchronisiert",
    syncing: "Sync…",
    syncNow: "Sync now",
    networkError: "Netzwerkfehler",
  },
  hu: {
    inFuture: "a jövőben",
    fewSecondsAgo: "néhány másodperce",
    secAgo: (n) => `${n} mp.-e`,
    minAgo: (n) => `${n} perce`,
    hourAgo: (n) => (n === 1 ? "1 órája" : `${n} órája`),
    daysAgo: (n) => (n === 1 ? "1 napja" : `${n} napja`),
    cloudSync: "✓ Cloud sync",
    toSync: "◐ Szinkronizálandó",
    last: "Utolsó:",
    neverSynced: "Soha nem szinkronizált",
    syncing: "Sync…",
    syncNow: "Sync now",
    networkError: "Hálózati hiba",
  },
  pt: {
    inFuture: "no futuro",
    fewSecondsAgo: "há alguns segundos",
    secAgo: (n) => `há ${n} s`,
    minAgo: (n) => (n === 1 ? "há 1 min" : `há ${n} min`),
    hourAgo: (n) => (n === 1 ? "há 1 hora" : `há ${n} horas`),
    daysAgo: (n) => (n === 1 ? "há 1 dia" : `há ${n} dias`),
    cloudSync: "✓ Cloud sync",
    toSync: "◐ Por sincronizar",
    last: "Último:",
    neverSynced: "Nunca sincronizado",
    syncing: "Sync…",
    syncNow: "Sync now",
    networkError: "Erro de rede",
  },
};

function formatRelativeTime(iso: string, t: (typeof T)[Locale]): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return t.inFuture;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return sec <= 5 ? t.fewSecondsAgo : t.secAgo(sec);
  const min = Math.floor(sec / 60);
  if (min < 60) return t.minAgo(min);
  const hr = Math.floor(min / 60);
  if (hr < 24) return t.hourAgo(hr);
  const days = Math.floor(hr / 24);
  return t.daysAgo(days);
}

/**
 * Banner compatto stato cloud-sync. Visualizza in una sola riga:
 * badge in/out of sync, ultimo sync relativo, count per tabella, bottone Sync.
 * Nascosto se l'utente non è loggato (non ha senso mostrare lo stato).
 */
export default function CloudSyncStatusBanner() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = T[useLocale()];

  async function refresh() {
    try {
      const res = await fetch("/api/local/sync/status");
      if (!res.ok) return;
      setStatus(await res.json());
    } catch {
      /* offline: lascia ultimo */
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // [JHT-NO-CLIENT-POLLING] Il banner su cloud renderizza null ma il vecchio
  // interval continuava a chiamare /api/local/sync/status ogni 30s da ogni
  // tab aperto (invocazioni Vercel a vuoto). Il polling parte SOLO quando lo
  // status conferma contesto locale + login: lì il server è co-locato e il
  // giro non costa nulla.
  const pollEligible = !!status && !status.remote && status.logged_in;
  useEffect(() => {
    if (!pollEligible) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollEligible]);

  async function handleSync() {
    setError(null);
    setSyncing(true);
    try {
      const res = await fetch("/api/local/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.networkError);
    } finally {
      setSyncing(false);
    }
  }

  // Nasconde se non loggato (banner ha senso solo per utenti che possono syncare).
  if (!status || !status.logged_in) return null;
  // Nasconde su cloud (Vercel): non c'è SQLite locale da sincronizzare,
  // la pagina sta già guardando direttamente Supabase. Il banner "Da
  // sincronizzare" qui era un falso positivo (vedi /api/local/sync/status).
  if (status.remote) return null;

  const inSync = status.in_sync;
  const accent = inSync ? "var(--color-green)" : "var(--sync-warn)";

  return (
    <div
      className="mb-5 px-4 py-2.5 border rounded-lg flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px]"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-card)",
      }}
    >
      <span
        className="px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap"
        style={{ color: accent, border: `1px solid ${accent}` }}
      >
        {inSync ? t.cloudSync : t.toSync}
      </span>

      <span className="text-[var(--color-dim)] whitespace-nowrap">
        {status.last_sync ? (
          <>
            {t.last}{" "}
            <span style={{ color: "var(--color-bright)" }}>
              {formatRelativeTime(status.last_sync.at, t)}
            </span>
          </>
        ) : (
          <>{t.neverSynced}</>
        )}
      </span>

      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[var(--color-dim)] font-mono">
        {(["positions", "scores", "applications"] as const).map((t) => {
          const local = status.local_counts[t];
          const cloud = status.cloud_counts[t];
          const eq = local === cloud;
          return (
            <span
              key={t}
              style={{
                color: eq ? "var(--color-dim)" : "var(--sync-warn)",
              }}
            >
              {t}: {local}/{cloud}
            </span>
          );
        })}
      </span>

      <button
        onClick={handleSync}
        disabled={syncing}
        className="ml-auto px-3 py-1 text-[10px] font-semibold border rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          color: "var(--color-green)",
          borderColor: "var(--color-green)",
          background: "transparent",
        }}
      >
        {syncing ? t.syncing : t.syncNow}
      </button>

      {error && (
        <span
          className="w-full text-[10px]"
          style={{ color: "var(--color-red)" }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
