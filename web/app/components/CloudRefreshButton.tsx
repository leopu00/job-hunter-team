"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// "Sync now" lato CLOUD ([JHT-DATA-SYNC] fase 3). Mirror del CloudSyncStatusBanner
// (che è LOCAL-only): quello pusha SQLite→cloud, questo chiede alla VPS un push
// fresco on-demand, senza polling continuo del browser.
//
// Flusso: PATCH /api/team-state { sync_requested_at } → il daemon VPS lo rileva,
// pusha e marca sync_completed_at → qui facciamo polling BOUNDED (3s, max ~45s)
// e a completamento UN solo router.refresh(). All'accesso parte una volta sola.
// Si mostra SOLO su cloud (status.remote) e loggato: in locale c'è il banner.

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return "ora";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return sec <= 5 ? "pochi secondi fa" : `${sec} sec fa`;
  const min = Math.floor(sec / 60);
  if (min < 60) return min === 1 ? "1 min fa" : `${min} min fa`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr === 1 ? "1 ora fa" : `${hr} ore fa`;
  const days = Math.floor(hr / 24);
  return days === 1 ? "1 giorno fa" : `${days} giorni fa`;
}

export default function CloudRefreshButton() {
  const router = useRouter();
  const [remote, setRemote] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const didAutoSync = useRef(false);
  const mounted = useRef(true);

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
        }
        return;
      }
    } catch (err) {
      if (mounted.current) {
        setError(err instanceof Error ? err.message : "Errore di rete");
        setSyncing(false);
      }
      return;
    }

    // Polling BOUNDED del completamento: nessun ascolto continuo, si ferma da sé.
    const deadline = Date.now() + 45_000;
    const poll = async () => {
      if (!mounted.current) return;
      if (Date.now() > deadline) {
        setSyncing(false); // la VPS non ha risposto in tempo: i dati a video restano gli ultimi noti
        return;
      }
      try {
        const r = await fetch("/api/team-state");
        if (r.ok) {
          const { state } = await r.json();
          const done: string | null = state?.sync_completed_at ?? null;
          if (done && done >= requestedAt) {
            if (!mounted.current) return;
            setLastSync(done);
            setSyncing(false);
            router.refresh(); // UN solo refetch dei dati freschi
            return;
          }
        }
      } catch {
        /* transient: ritenta */
      }
      setTimeout(poll, 3000);
    };
    setTimeout(poll, 3000);
  }

  // Auto-sync UNA volta all'accesso (solo cloud + loggato).
  useEffect(() => {
    if (remote && loggedIn && !didAutoSync.current) {
      didAutoSync.current = true;
      void requestSync();
    }
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
      {lastSync && !syncing && (
        <span>Aggiornato {formatRelativeTime(lastSync)}</span>
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
        title="Chiedi alla VPS un aggiornamento dei dati ora"
      >
        <span style={{ display: "inline-block", transformOrigin: "center" }}>
          ↻
        </span>
        {syncing ? "Sync…" : "Sync now"}
      </button>
    </div>
  );
}
