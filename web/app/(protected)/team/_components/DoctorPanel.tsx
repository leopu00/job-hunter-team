"use client";

// 🩺 DoctorPanel — visualizza i giri del Dottore (health-check agente
// che si autospawna ogni 30min). Legge /api/dottore/actions, mostra:
//   • header con stato live (DOTTORE attivo / spento / ultimo round)
//   • lista round (ultimi 8) con stati aggregati
//   • timeline eventi recenti (ping/diagnosi/restart) — emoji per evento
// Auto-refresh ogni 15s.

import { useEffect, useState } from "react";

type Diagnosis =
  | "alive"
  | "long_turn"
  | "stallo"
  | "cli_dead"
  | "ambiguous"
  | string;

type DoctorEvent = {
  ts: string;
  round_id?: string;
  session?: string;
  role?: string;
  event: string;
  status?: Diagnosis;
  evidence?: string;
  msg?: string;
  context_recovered?: string;
  agents_checked?: number;
  agents_restarted?: number;
  duration_sec?: number;
};

type Round = {
  round_id: string;
  started_at: string | null;
  ended_at: string | null;
  spawn_at: string | null;
  pings: number;
  diagnoses: Record<string, number>;
  restarts: number;
  duration_sec: number | null;
};

type Resp = {
  ok: boolean;
  events: DoctorEvent[];
  rounds: Round[];
  // counts e' opzionale: in alcuni branch del backend (es. ENOENT del
  // file dottore-actions.jsonl) puo' mancare. Il client usa ?? 0 per
  // degradare graceful invece di crashare con "reading 'pings'".
  counts?: {
    total: number;
    pings: number;
    restarts: number;
    rounds_complete: number;
  };
};

const EVENT_ICON: Record<string, string> = {
  spawn: "🩺",
  ping_sent: "📨",
  diagnosis: "🔍",
  restart: "🔄",
  round_complete: "✅",
};

const STATUS_COLOR: Record<string, string> = {
  alive: "#22c55e",
  long_turn: "#facc15",
  stallo: "#ef4444",
  cli_dead: "#ef4444",
  ambiguous: "#94a3b8",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const diff = Math.max(0, Date.now() - t) / 1000;
  if (diff < 60) return Math.round(diff) + "s fa";
  if (diff < 3600) return Math.round(diff / 60) + "min fa";
  return (diff / 3600).toFixed(1) + "h fa";
}

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function DoctorPanel() {
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/dottore/actions?sinceMin=180&limit=200", {
          cache: "no-store",
        });
        const d = await r.json();
        if (alive) {
          if (d.ok) {
            setData(d);
            setError(null);
          } else {
            setError(d.error || "unknown error");
          }
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const lastRound = data?.rounds.length
    ? data.rounds[data.rounds.length - 1]
    : null;
  const recentRounds = data?.rounds.slice(-8).reverse() || [];
  const recentEvents = data?.events.slice(-30).reverse() || [];

  return (
    <section className="mt-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <header className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl" aria-hidden>
            🩺
          </span>
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-bright)]">
              Dottore — health-check
            </h3>
            <p className="text-[10px] text-[var(--color-dim)] mt-0.5">
              Si autospawna ogni 30 min. Pinga ogni agente, riavvia chi è
              bloccato, poi si autodistrugge.
            </p>
          </div>
        </div>
        {data && (
          <div className="flex gap-2 text-[10px] text-[var(--color-dim)] uppercase tracking-wide">
            <span>📨 {data.counts?.pings ?? 0} ping</span>
            <span>🔄 {data.counts?.restarts ?? 0} restart</span>
            <span>✅ {data.counts?.rounds_complete ?? 0} round</span>
          </div>
        )}
      </header>

      {loading && !data && (
        <div className="text-[12px] text-[var(--color-dim)] mt-4">
          caricamento…
        </div>
      )}
      {error && (
        <div className="mt-3 rounded border border-red-700/40 bg-red-900/20 p-2 text-[12px] text-red-300">
          errore lettura azioni: {error}
        </div>
      )}

      {data && lastRound && (
        <div className="mt-3 rounded border border-[var(--color-border)] bg-[var(--color-card-hi)] p-3">
          <div className="text-[10px] text-[var(--color-dim)] uppercase tracking-wide">
            ultimo round
          </div>
          <div className="flex items-baseline gap-3 mt-1 flex-wrap">
            <code className="text-xs">{lastRound.round_id}</code>
            <span className="text-[12px] text-[var(--color-dim)]">
              {timeAgo(lastRound.started_at)}
            </span>
            <span className="text-[12px]">📨 {lastRound.pings}</span>
            <span className="text-[12px]">🔄 {lastRound.restarts}</span>
            {lastRound.duration_sec != null && (
              <span className="text-[12px] text-[var(--color-dim)]">
                {lastRound.duration_sec}s
              </span>
            )}
            {Object.entries(lastRound.diagnoses).map(([s, n]) => (
              <span
                key={s}
                className="text-[11px] px-1.5 py-0.5 rounded"
                style={{
                  background: (STATUS_COLOR[s] || "#94a3b8") + "22",
                  color: STATUS_COLOR[s] || "#94a3b8",
                }}
              >
                {s} · {n}
              </span>
            ))}
          </div>
        </div>
      )}

      {recentRounds.length > 0 && (
        <div className="mt-4">
          <div className="text-[10px] text-[var(--color-dim)] uppercase tracking-wide mb-1">
            round storici (ultimi 8)
          </div>
          <ul className="text-[12px] divide-y divide-[var(--color-border)]">
            {recentRounds.map((r) => (
              <li
                key={r.round_id}
                className="py-1.5 flex items-center gap-3 flex-wrap"
              >
                <span className="text-[10px] text-[var(--color-dim)] w-16">
                  {fmtTime(r.started_at)}
                </span>
                <code className="text-[10px]">{r.round_id.slice(0, 18)}</code>
                <span>📨 {r.pings}</span>
                <span>🔄 {r.restarts}</span>
                {r.duration_sec != null && (
                  <span className="text-[var(--color-dim)]">
                    {r.duration_sec}s
                  </span>
                )}
                {Object.entries(r.diagnoses).map(([s, n]) => (
                  <span
                    key={s}
                    className="text-[10px] px-1 rounded"
                    style={{
                      background: (STATUS_COLOR[s] || "#94a3b8") + "22",
                      color: STATUS_COLOR[s] || "#94a3b8",
                    }}
                  >
                    {s}·{n}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      {recentEvents.length > 0 && (
        <details className="mt-4 group">
          <summary className="text-[10px] text-[var(--color-dim)] uppercase tracking-wide cursor-pointer select-none">
            timeline eventi grezzi (ultimi 30)
          </summary>
          <ul className="mt-2 text-[11px] font-mono space-y-0.5 max-h-64 overflow-y-auto">
            {recentEvents.map((e, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-[var(--color-dim)] w-20 shrink-0">
                  {fmtTime(e.ts)}
                </span>
                <span className="w-5 text-center" aria-hidden>
                  {EVENT_ICON[e.event] || "•"}
                </span>
                <span className="w-24 truncate text-[var(--color-bright)]">
                  {e.session || "—"}
                </span>
                <span className="text-[var(--color-dim)]">{e.event}</span>
                {e.status && (
                  <span style={{ color: STATUS_COLOR[e.status] || "#94a3b8" }}>
                    {e.status}
                  </span>
                )}
                {e.evidence && (
                  <span className="truncate text-[var(--color-dim)]">
                    {e.evidence.slice(0, 80)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
