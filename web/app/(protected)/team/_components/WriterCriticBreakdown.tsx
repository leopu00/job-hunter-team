"use client";

// WriterCriticBreakdown — per-Scrittore cost = own + critic spawned.
//
// Mostra il rate aggregato che il Capitano usa per le decisioni di
// throttle (RULE C-11): il Critico (CRITICO-S<N>) è child task atomico
// dello Scrittore N. Il widget visualizza, per ciascuno Scrittore vivo,
// una barra stacked own + critic con i valori numerici a destra.
//
// Sorgente: /api/tokens/status → perWriterAggregated (mappa
// scrittore-N → {own_rate, critic_rate, combined_rate, ...}). Stato
// scritto ogni 30s dal token-meter daemon, qui polliamo ogni 15s.
//
// Empty state: nessuno Scrittore attivo nella finestra (writer-on-demand
// V6, REGOLA C-10): chiarisce che è atteso, non un bug.

import { useEffect, useState } from "react";
import { colorForAgent } from "./agent-colors";

type WriterEntry = {
  own_rate_kt_per_min?: number;
  critic_rate_kt_per_min?: number;
  combined_rate_kt_per_min?: number;
  own_weighted_60s?: number;
  critic_weighted_60s?: number;
  combined_weighted_60s?: number;
  critic_session?: string | null;
  writer_session_alive?: boolean;
};

type ApiPayload = {
  running?: boolean;
  stale?: boolean;
  updatedAt?: string;
  perWriterAggregated?: Record<string, WriterEntry>;
};

function formatRate(kt: number): string {
  if (kt < 0.1) return "0";
  if (kt < 1) return kt.toFixed(2);
  if (kt < 100) return kt.toFixed(1);
  return Math.round(kt).toString();
}

export default function WriterCriticBreakdown() {
  const [data, setData] = useState<ApiPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch("/api/tokens/status", { cache: "no-store" });
        const j: ApiPayload = await r.json();
        if (!cancelled) setData(j);
      } catch {
        /* best-effort, ritenta al prossimo tick */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const aggregated = data?.perWriterAggregated ?? {};
  const writers = Object.entries(aggregated)
    .map(([key, entry]) => ({
      key,
      ...entry,
      own: entry.own_rate_kt_per_min ?? 0,
      critic: entry.critic_rate_kt_per_min ?? 0,
      combined: entry.combined_rate_kt_per_min ?? 0,
    }))
    .filter((w) => w.combined > 0 || w.writer_session_alive)
    .sort((a, b) => b.combined - a.combined);

  const maxCombined = writers.reduce((m, w) => Math.max(m, w.combined), 0);

  // Scaling barra: usiamo maxCombined come 100%. Se tutti i writer sono a
  // valori bassi (idle/cooldown), il widget mostra comunque la proporzione
  // relativa fra loro, utile per "chi sta partendo per primo dopo idle".
  // Se vuoto → empty state.

  const updatedAt = data?.updatedAt
    ? new Date(data.updatedAt).toLocaleTimeString("it-IT", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : null;
  const isStale = data?.stale === true;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-[11px] uppercase tracking-wide text-[var(--color-dim)]">
            Per-Scrittore cost
          </span>
          <span className="text-[11px] text-[var(--color-muted)]">
            own + critic spawnato (RULE C-11)
          </span>
        </div>
        {updatedAt && (
          <span
            className="text-[10px] text-[var(--color-dim)] tabular-nums"
            title={isStale ? "Dato non aggiornato (>5min)" : "Ultimo update"}
          >
            {isStale ? "stale · " : ""}aggiornato {updatedAt}
          </span>
        )}
      </div>

      {loading && !data ? (
        <div className="text-[11px] text-[var(--color-dim)] py-6 text-center">
          Caricamento…
        </div>
      ) : writers.length === 0 ? (
        <div
          className="text-[11px] text-[var(--color-dim)] py-3 px-3 rounded"
          style={{ background: "rgba(255,255,255,0.02)" }}
        >
          Nessuno Scrittore attivo. Atteso in Writer-on-demand V6 — gli
          Scrittori vengono spawnati dal Capitano solo quando l&apos;utente
          clicca &quot;Scrivi CV&quot; o invia <code>/cv</code> su Telegram.
        </div>
      ) : (
        <div className="space-y-1.5">
          {writers.map((w) => {
            const color = colorForAgent("scrittore");
            const criticColor = colorForAgent("critico");
            const ownPct = maxCombined > 0 ? (w.own / maxCombined) * 100 : 0;
            const criticPct =
              maxCombined > 0 ? (w.critic / maxCombined) * 100 : 0;
            const orphan = w.writer_session_alive === false && w.critic > 0;
            return (
              <div
                key={w.key}
                className="grid grid-cols-[140px_1fr_auto] items-center gap-3 px-2 py-1.5 rounded"
                style={{ background: "rgba(255,255,255,0.02)" }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    aria-hidden="true"
                    style={{
                      display: "inline-block",
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      background: color,
                      flexShrink: 0,
                    }}
                  />
                  <span className="text-[11px] text-[var(--color-bright)] font-mono truncate">
                    {w.key}
                  </span>
                  {orphan && (
                    <span
                      className="text-[9px] px-1 py-0.5 rounded font-semibold"
                      style={{
                        color: "var(--color-yellow)",
                        border: "1px solid rgba(255,193,7,0.4)",
                        background: "rgba(255,193,7,0.08)",
                      }}
                      title="Scrittore parent morto/respawnato, Critico ancora vivo (transiente post-restart)"
                    >
                      orphan
                    </span>
                  )}
                </div>
                <div
                  className="relative h-2 rounded overflow-hidden flex"
                  style={{ background: "rgba(255,255,255,0.05)" }}
                  aria-label={`Scrittore ${w.own.toFixed(1)} kT/min + Critico ${w.critic.toFixed(1)} kT/min = ${w.combined.toFixed(1)} kT/min`}
                >
                  <div
                    style={{
                      width: `${ownPct}%`,
                      background: color,
                      opacity: 0.85,
                    }}
                  />
                  <div
                    style={{
                      width: `${criticPct}%`,
                      background: criticColor,
                      opacity: 0.85,
                    }}
                  />
                </div>
                <div className="flex items-baseline gap-3 text-[10px] font-mono whitespace-nowrap">
                  <span
                    className="tabular-nums"
                    style={{ color }}
                    title="Scrittore own rate"
                  >
                    {formatRate(w.own)}
                  </span>
                  <span className="text-[var(--color-dim)]">+</span>
                  <span
                    className="tabular-nums"
                    style={{ color: criticColor }}
                    title={
                      w.critic_session
                        ? `Critico ${w.critic_session} spawnato dallo Scrittore`
                        : "Nessun Critico spawnato (review non in flight)"
                    }
                  >
                    {formatRate(w.critic)}
                  </span>
                  <span className="text-[var(--color-dim)]">=</span>
                  <span
                    className="tabular-nums font-semibold text-[var(--color-bright)] w-12 text-right"
                    title="Combined rate (own + critic) — usato dal Capitano per throttle"
                  >
                    {formatRate(w.combined)}
                  </span>
                  <span className="text-[9px] text-[var(--color-dim)]">
                    kT/min
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
