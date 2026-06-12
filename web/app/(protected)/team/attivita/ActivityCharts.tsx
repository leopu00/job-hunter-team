"use client";

import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type {
  TeamActivity,
  TeamActivityActor,
  TeamActivityRole,
} from "@/lib/team-activity";

/* ── Metadati ruoli (colori allineati alla pagina /team) ──────────── */
const ROLE_META: Record<
  TeamActivityRole,
  { label: string; emoji: string; color: string; verb: string; action: string }
> = {
  scout: { label: "Scout", emoji: "🔍", color: "#2196f3", verb: "posizioni trovate", action: "ha trovato una posizione" },
  analista: { label: "Analista", emoji: "🏢", color: "#00e676", verb: "posizioni analizzate", action: "ha analizzato una posizione" },
  scorer: { label: "Scorer", emoji: "🎯", color: "#b388ff", verb: "score assegnati", action: "ha assegnato uno score" },
  scrittore: { label: "Scrittore", emoji: "✍️", color: "#ffd600", verb: "CV scritti", action: "ha scritto un CV" },
  critico: { label: "Critico", emoji: "🧐", color: "#ff6ac1", verb: "review completate", action: "ha completato una review" },
};

// ISO → 'DD/MM HH:MM' (ora locale).
function dmhm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace("T", " ");
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ── Helpers ──────────────────────────────────────────────────────── */
function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  if (diff < 0) return "ora";
  const min = Math.floor(diff / 60000);
  if (min < 1) return "ora";
  if (min < 60) return `${min}m fa`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h fa`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}g fa`;
  const mo = Math.floor(d / 30);
  return `${mo} mes${mo === 1 ? "e" : "i"} fa`;
}

// 'YYYY-MM-DD' → 'DD/MM'
function dm(date: string): string {
  const parts = date.split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : date;
}

function dayTotal(counts: Record<TeamActivityRole, number>): number {
  return (
    counts.scout +
    counts.analista +
    counts.scorer +
    counts.scrittore +
    counts.critico
  );
}

// Etichetta istanza:
//  - attore con id proprio (es. scout-1) → l'id.
//  - attore == ruolo (nessun id registrato):
//      · se il ruolo NON ha istanze nominate (Analista) → nome del ruolo;
//      · se il ruolo ha anche istanze nominate → "non attribuito"
//        (le righe dove la colonna *_by era nulla).
function actorLabel(
  a: TeamActivityActor,
  roleLabel: string,
  roleHasNamedInstances: boolean,
): string {
  if (a.actor !== a.role) return a.actor;
  return roleHasNamedInstances ? "non attribuito" : roleLabel;
}

const AGGREGATO_HINT =
  "Eventi senza id istanza registrato: per l'Analista è l'intera attività (last_checked non salva l'istanza); per gli altri ruoli sono le righe con *_by nullo.";

/* ── Tooltip isolato ──────────────────────────────────────────────
   Vive in un proprio componente con stato interno e portal su <body>:
   l'hover aggiorna SOLO questo layer, MAI i grafici → niente re-render
   delle celle e niente loop scrollbar (la pagina non "trema"). */
type TipRow = { color: string; label: string; value: string };
export type TooltipHandle = {
  show: (x: number, y: number, title: string, rows: TipRow[]) => void;
  move: (x: number, y: number) => void;
  hide: () => void;
};

const TooltipLayer = forwardRef<TooltipHandle>(function TooltipLayer(_props, ref) {
  const [tip, setTip] = useState<{
    x: number;
    y: number;
    title: string;
    rows: TipRow[];
  } | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      show: (x, y, title, rows) => setTip({ x, y, title, rows }),
      move: (x, y) => setTip((t) => (t ? { ...t, x, y } : t)),
      hide: () => setTip(null),
    }),
    [],
  );

  if (!tip || typeof document === "undefined") return null;

  // Clamp su entrambi gli assi così il box fixed non genera mai scrollbar.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const estH = 22 + tip.rows.length * 16;
  const left = Math.max(8, Math.min(tip.x + 14, vw - 230));
  const top =
    tip.y + 14 + estH > vh ? Math.max(8, tip.y - estH - 8) : tip.y + 14;

  return createPortal(
    <div
      className="fixed z-[9999] pointer-events-none rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2.5 py-1.5 shadow-lg"
      style={{ left, top, maxWidth: 220 }}
    >
      <div className="text-[10px] font-semibold text-[var(--color-white)] mb-0.5 whitespace-nowrap">
        {tip.title}
      </div>
      {tip.rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5 whitespace-nowrap">
          <span
            className="inline-block w-2 h-2 rounded-sm shrink-0"
            style={{ background: r.color }}
          />
          <span className="text-[10px] text-[var(--color-muted)]">{r.label}</span>
          {r.value !== "" && (
            <span className="text-[10px] font-bold text-[var(--color-white)] tabular-nums ml-1">
              {r.value}
            </span>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
});

/* ── Componente principale ────────────────────────────────────────── */
export default function ActivityCharts({
  activity,
}: {
  activity: TeamActivity;
}) {
  const { dates, roles, actors, roleDaily, roleTotals, totalAll, days, recent } =
    activity;

  // Leaderboard: raggruppa le istanze per ruolo; ruoli ordinati per azioni nel
  // range, istanze ordinate per azioni nel range.
  const groups = useMemo(() => {
    return roles
      .map((role) => {
        const items = actors
          .filter((a) => a.role === role)
          .sort((a, b) => b.total - a.total || a.actor.localeCompare(b.actor));
        const last = items.reduce<string | null>((acc, a) => {
          if (a.lastActiveAt && (!acc || a.lastActiveAt > acc)) return a.lastActiveAt;
          return acc;
        }, null);
        const maxInstance = Math.max(1, ...items.map((a) => a.total));
        const hasNamed = items.some((a) => a.actor !== a.role);
        return { role, items, total: roleTotals[role], last, maxInstance, hasNamed };
      })
      .sort((a, b) => b.total - a.total);
  }, [roles, actors, roleTotals]);

  const maxRole = Math.max(1, ...roles.map((r) => roleTotals[r]));

  const maxDayTotal = useMemo(
    () => Math.max(1, ...roleDaily.map((d) => dayTotal(d.counts))),
    [roleDaily],
  );

  // Heatmap: una riga per ISTANZA, raggruppata per ruolo. Intensità relativa
  // al picco giornaliero della singola istanza.
  const heatRows = useMemo(() => {
    const out: { actor: TeamActivityActor; max: number; label: string; aggregated: boolean }[] = [];
    for (const role of roles) {
      const items = actors
        .filter((a) => a.role === role)
        .sort((a, b) => b.total - a.total || a.actor.localeCompare(b.actor));
      const hasNamed = items.some((a) => a.actor !== a.role);
      for (const a of items) {
        const aggregated = a.actor === a.role;
        out.push({
          actor: a,
          max: Math.max(1, ...a.daily),
          label: actorLabel(a, ROLE_META[role].label, hasNamed),
          aggregated: aggregated && hasNamed,
        });
      }
    }
    return out;
  }, [roles, actors]);

  const tick = Math.max(1, Math.ceil(days / 8));

  // Donut: distribuzione del lavoro per ruolo (quota sul totale).
  const donut = useMemo(() => {
    const slices = roles
      .filter((r) => roleTotals[r] > 0)
      .map((r) => ({ role: r, value: roleTotals[r] }))
      .sort((a, b) => b.value - a.value);
    const sum = slices.reduce((s, x) => s + x.value, 0) || 1;
    let acc = 0;
    return slices.map((s) => {
      const frac = s.value / sum;
      const start = acc;
      acc += frac;
      return { ...s, frac, start, pct: Math.round(frac * 100) };
    });
  }, [roles, roleTotals]);

  // Scatter temporale: posizione x = quota del range, lane per ruolo.
  const fromMs = Date.parse(`${activity.from}T00:00:00Z`);
  const toMs = Date.parse(`${activity.to}T23:59:59Z`);
  const span = Math.max(1, toMs - fromMs);
  const laneH = 30;
  // Larghezza "zoom" del piano scatter: cresce coi giorni → scrollbar
  // orizzontale per esplorare la timeline nel dettaglio.
  const scatterW = Math.max(720, days * 56);
  const axisStep = Math.max(
    1,
    Math.ceil(days / Math.max(1, Math.floor(scatterW / 64))),
  );

  /* ── Tooltip custom (hover su barre/celle) ─────────────────────────
     Gli handler chiamano il layer isolato via ref: NON toccano lo stato di
     questo componente, quindi i grafici non si ri-renderizzano sull'hover. */
  const tipRef = useRef<TooltipHandle>(null);
  const showTip = (e: React.MouseEvent, title: string, rows: TipRow[]) =>
    tipRef.current?.show(e.clientX, e.clientY, title, rows);
  const moveTip = (e: React.MouseEvent) =>
    tipRef.current?.move(e.clientX, e.clientY);
  const hideTip = () => tipRef.current?.hide();

  if (totalAll === 0) {
    return (
      <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-10 text-center">
        <div className="text-3xl mb-3">😴</div>
        <div className="text-[13px] text-[var(--color-muted)] font-semibold mb-1">
          Nessuna attività nel periodo selezionato
        </div>
        <div className="text-[11px] text-[var(--color-dim)]">
          Prova ad allargare il range, oppure avvia il team perché i grafici si
          popolino — i dati arrivano da SQLite locale (o da Supabase quando
          sincronizzato).
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-10" style={{ animation: "fade-in 0.35s ease both" }}>
      {/* ── 0. Attività recente (chi ha fatto le ultime azioni) ──── */}
      <section>
        <div className="section-label mb-1">🕐 Attività recente</div>
        <p className="text-[10px] text-[var(--color-dim)] mb-4">
          Le ultime azioni del team, dalla più recente — con l&apos;istanza che
          l&apos;ha fatta.
        </p>
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg divide-y divide-[var(--color-border)] max-h-[340px] overflow-y-auto">
          {recent.map((ev, i) => {
            const meta = ROLE_META[ev.role];
            const label = ev.actor === ev.role ? meta.label : ev.actor;
            return (
              <div
                key={`${ev.role}-${ev.actor}-${ev.ts}-${i}`}
                className="flex items-center gap-3 px-4 py-2 hover:bg-[var(--color-bg)] transition-colors"
              >
                <span className="text-[10px] text-[var(--color-dim)] w-14 shrink-0 tabular-nums">
                  {timeAgo(ev.ts)}
                </span>
                <span className="text-[13px] leading-none shrink-0">
                  {meta.emoji}
                </span>
                <span
                  className="text-[11px] font-bold w-24 shrink-0 truncate tabular-nums"
                  style={{ color: meta.color }}
                  title={ev.actor}
                >
                  {label}
                </span>
                <span className="text-[11px] text-[var(--color-muted)] flex-1 min-w-0 truncate">
                  {meta.action}
                </span>
                {ev.pid && (
                  <Link
                    href={`/positions/${ev.pid}`}
                    className="text-[10px] font-semibold shrink-0 tabular-nums no-underline rounded px-1.5 py-0.5 border border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-blue)] hover:text-[var(--color-blue)] transition-colors"
                    title={`Apri la posizione #${ev.pid}`}
                  >
                    #{ev.pid}
                  </Link>
                )}
                <span className="text-[10px] text-[var(--color-dim)] shrink-0 tabular-nums hidden sm:block w-24 text-right">
                  {dmhm(ev.ts)}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── 1. Leaderboard nel periodo (per istanza) ─────────────── */}
      <section>
        <div className="section-label mb-1">🏅 Leaderboard · nel periodo</div>
        <p className="text-[10px] text-[var(--color-dim)] mb-4">
          Per ruolo e per singola istanza (es. scout-1), sul range selezionato.
        </p>
        <div className="space-y-3">
          {groups.map((g, i) => {
            const meta = ROLE_META[g.role];
            const showInstances =
              g.items.length > 1 ||
              (g.items.length === 1 && g.items[0].actor !== g.role);
            return (
              <div
                key={g.role}
                className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors"
                style={{ animation: `fade-in 0.4s ease ${i * 0.06}s both` }}
              >
                {/* Header ruolo */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[15px] leading-none">{meta.emoji}</span>
                    <span
                      className="text-[13px] font-bold"
                      style={{ color: meta.color }}
                    >
                      {meta.label}
                    </span>
                    <span className="text-[10px] text-[var(--color-dim)] truncate">
                      · {meta.verb}
                      {g.items.length > 1 ? ` · ${g.items.length} istanze` : ""}
                    </span>
                  </div>
                  <span
                    className="text-2xl font-bold leading-none tabular-nums shrink-0"
                    style={{ color: meta.color }}
                  >
                    {g.total}
                  </span>
                </div>

                {/* Barra ruolo (quota sul range) */}
                <div className="flex items-center gap-3">
                  <div
                    className="flex-1 h-1.5 rounded-full overflow-hidden"
                    style={{ background: "var(--color-border)" }}
                  >
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${(g.total / maxRole) * 100}%`,
                        background: meta.color,
                        opacity: g.total > 0 ? 0.85 : 0,
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-[var(--color-dim)] w-20 text-right shrink-0">
                    ultimo {timeAgo(g.last)}
                  </span>
                </div>

                {/* Dettaglio per istanza */}
                {showInstances && (
                  <div className="mt-3 pt-3 border-t border-[var(--color-border)] space-y-2">
                    {g.items.map((a) => {
                      const isAgg = a.actor === a.role && g.hasNamed;
                      return (
                      <div key={a.actor} className="flex items-center gap-3">
                        <span
                          className="text-[10px] font-semibold w-24 shrink-0 truncate tabular-nums"
                          style={{ color: isAgg ? "var(--color-dim)" : "var(--color-muted)" }}
                          title={isAgg ? AGGREGATO_HINT : a.actor}
                        >
                          {actorLabel(a, ROLE_META[g.role].label, g.hasNamed)}
                        </span>
                        <div
                          className="flex-1 h-1 rounded-full overflow-hidden"
                          style={{ background: "var(--color-border)" }}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${(a.total / g.maxInstance) * 100}%`,
                              background: meta.color,
                              opacity: a.total > 0 ? 0.7 : 0,
                            }}
                          />
                        </div>
                        <span
                          className="text-[11px] font-bold w-8 text-right shrink-0 tabular-nums"
                          style={{ color: meta.color }}
                        >
                          {a.total}
                        </span>
                        <span className="text-[9px] text-[var(--color-dim)] w-16 text-right shrink-0 tabular-nums">
                          ultimo {timeAgo(a.lastActiveAt)}
                        </span>
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── 2. Donut: distribuzione del lavoro ───────────────────── */}
      <section>
        <div className="section-label mb-1">🍩 Distribuzione del lavoro</div>
        <p className="text-[10px] text-[var(--color-dim)] mb-4">
          Quanto ha fatto ciascun ruolo, in quota sul totale del periodo.
        </p>
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 flex flex-col sm:flex-row items-center gap-6">
          {/* Donut SVG */}
          <div className="relative shrink-0" style={{ width: 168, height: 168 }}>
            <svg viewBox="0 0 168 168" width={168} height={168}>
              <g transform="rotate(-90 84 84)">
                {(() => {
                  const R = 60;
                  const C = 2 * Math.PI * R;
                  return donut.map((s) => {
                    const meta = ROLE_META[s.role];
                    return (
                      <circle
                        key={s.role}
                        cx={84}
                        cy={84}
                        r={R}
                        fill="none"
                        stroke={meta.color}
                        strokeWidth={22}
                        strokeDasharray={`${s.frac * C} ${C - s.frac * C}`}
                        strokeDashoffset={-s.start * C}
                        className="cursor-default transition-[stroke-width]"
                        style={{ opacity: 0.9 }}
                        onMouseEnter={(e) =>
                          showTip(e, `${meta.emoji} ${meta.label}`, [
                            {
                              color: meta.color,
                              label: `${s.pct}% · azioni`,
                              value: String(s.value),
                            },
                          ])
                        }
                        onMouseMove={moveTip}
                        onMouseLeave={hideTip}
                      />
                    );
                  });
                })()}
              </g>
              <text
                x={84}
                y={80}
                textAnchor="middle"
                className="fill-[var(--color-white)]"
                style={{ fontSize: 22, fontWeight: 700 }}
              >
                {totalAll}
              </text>
              <text
                x={84}
                y={98}
                textAnchor="middle"
                className="fill-[var(--color-dim)]"
                style={{ fontSize: 9, letterSpacing: 1 }}
              >
                AZIONI
              </text>
            </svg>
          </div>
          {/* Legenda */}
          <div className="flex-1 w-full space-y-2">
            {donut.map((s) => {
              const meta = ROLE_META[s.role];
              return (
                <div key={s.role} className="flex items-center gap-3">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ background: meta.color }}
                  />
                  <span className="text-[11px] leading-none">{meta.emoji}</span>
                  <span
                    className="text-[11px] font-semibold w-20 shrink-0"
                    style={{ color: meta.color }}
                  >
                    {meta.label}
                  </span>
                  <div
                    className="flex-1 h-1.5 rounded-full overflow-hidden"
                    style={{ background: "var(--color-border)" }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${s.frac * 100}%`,
                        background: meta.color,
                        opacity: 0.85,
                      }}
                    />
                  </div>
                  <span className="text-[11px] font-bold w-10 text-right shrink-0 tabular-nums">
                    {s.pct}%
                  </span>
                  <span className="text-[10px] text-[var(--color-dim)] w-12 text-right shrink-0 tabular-nums">
                    {s.value}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── 3. Timeline impilata (per ruolo) ─────────────────────── */}
      <section>
        <div className="section-label mb-1">📈 Volume di lavoro nel tempo</div>
        <p className="text-[10px] text-[var(--color-dim)] mb-4">
          Azioni totali al giorno, scomposte per ruolo · {days} giorni.
        </p>
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
          {/* Legenda */}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-4">
            {roles.map((r) => (
              <span key={r} className="flex items-center gap-1.5">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{ background: ROLE_META[r].color }}
                />
                <span className="text-[10px] text-[var(--color-muted)]">
                  {ROLE_META[r].emoji} {ROLE_META[r].label}
                </span>
              </span>
            ))}
          </div>
          {/* Barre */}
          <div className="flex items-end gap-[2px]" style={{ height: 170 }}>
            {roleDaily.map((d) => {
              const total = dayTotal(d.counts);
              const hPct = (total / maxDayTotal) * 100;
              const rows: TipRow[] =
                total > 0
                  ? roles
                      .filter((r) => d.counts[r] > 0)
                      .map((r) => ({
                        color: ROLE_META[r].color,
                        label: ROLE_META[r].label,
                        value: String(d.counts[r]),
                      }))
                  : [{ color: "var(--color-dim)", label: "nessuna attività", value: "" }];
              return (
                <div
                  key={d.date}
                  className="flex-1 flex flex-col-reverse min-w-0 cursor-default"
                  style={{ height: "100%" }}
                  onMouseEnter={(e) =>
                    showTip(e, `${dm(d.date)} · ${total} azioni`, rows)
                  }
                  onMouseMove={moveTip}
                  onMouseLeave={hideTip}
                >
                  <div
                    className="flex flex-col-reverse rounded-sm overflow-hidden"
                    style={{ height: `${hPct}%`, minHeight: total > 0 ? 2 : 0 }}
                  >
                    {roles.map((r) =>
                      d.counts[r] > 0 ? (
                        <div
                          key={r}
                          style={{
                            height: `${(d.counts[r] / total) * 100}%`,
                            background: ROLE_META[r].color,
                            opacity: 0.85,
                          }}
                        />
                      ) : null,
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {/* Asse x */}
          <div className="flex gap-[2px] mt-1.5">
            {dates.map((date, i) => (
              <div
                key={date}
                className="flex-1 text-center min-w-0 overflow-visible whitespace-nowrap"
                style={{ fontSize: 8, color: "var(--color-dim)" }}
              >
                {i % tick === 0 ? dm(date) : ""}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 4. Scatter temporale: chi, quando, cosa ──────────────── */}
      <section>
        <div className="section-label mb-1">🗓️ Quando, chi e cosa</div>
        <p className="text-[10px] text-[var(--color-dim)] mb-4">
          Ogni segno è un&apos;azione, posizionata all&apos;ora esatta. Una
          corsia per ruolo · passa il mouse per i dettagli.
          {recent.length > 0 && activity.timeline.length >= 2500
            ? " (mostrati gli ultimi 2500 eventi)"
            : ""}
        </p>
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
          <div className="flex">
            {/* Corsie (label ruolo) */}
            <div className="shrink-0" style={{ width: 96 }}>
              {roles.map((r) => (
                <div
                  key={r}
                  className="flex items-center gap-1.5"
                  style={{ height: laneH }}
                >
                  <span className="text-[12px] leading-none">
                    {ROLE_META[r].emoji}
                  </span>
                  <span
                    className="text-[10px] font-semibold"
                    style={{ color: ROLE_META[r].color }}
                  >
                    {ROLE_META[r].label}
                  </span>
                </div>
              ))}
            </div>
            {/* Piano scatter — largo e scrollabile orizzontalmente */}
            <div className="flex-1 overflow-x-auto">
              <div style={{ width: scatterW }}>
                <svg
                  width={scatterW}
                  height={roles.length * laneH}
                  viewBox={`0 0 ${scatterW} ${roles.length * laneH}`}
                >
                  {/* baseline corsie */}
                  {roles.map((r, i) => (
                    <line
                      key={r}
                      x1={0}
                      x2={scatterW}
                      y1={i * laneH + laneH / 2}
                      y2={i * laneH + laneH / 2}
                      stroke="var(--color-border)"
                      strokeWidth={1}
                      opacity={0.5}
                    />
                  ))}
                  {/* eventi */}
                  {activity.timeline.map((ev, idx) => {
                    const li = roles.indexOf(ev.role);
                    if (li < 0) return null;
                    const t = Date.parse(ev.ts);
                    const frac = Number.isNaN(t)
                      ? 0
                      : Math.max(0, Math.min(1, (t - fromMs) / span));
                    const meta = ROLE_META[ev.role];
                    const label = ev.actor === ev.role ? meta.label : ev.actor;
                    return (
                      <rect
                        key={`${idx}-${ev.ts}`}
                        x={frac * scatterW}
                        y={li * laneH + 6}
                        width={2}
                        height={laneH - 12}
                        rx={1}
                        fill={meta.color}
                        opacity={0.55}
                        className="cursor-default"
                        onMouseEnter={(e) =>
                          showTip(e, `${meta.emoji} ${label} · ${dmhm(ev.ts)}`, [
                            {
                              color: meta.color,
                              label: meta.action,
                              value: ev.pid ? `#${ev.pid}` : "",
                            },
                          ])
                        }
                        onMouseMove={moveTip}
                        onMouseLeave={hideTip}
                      />
                    );
                  })}
                </svg>
                {/* Asse x: tick per giorno */}
                <div className="flex mt-1.5" style={{ width: scatterW }}>
                  {dates.map((date, i) => (
                    <div
                      key={date}
                      className="flex-1 text-center overflow-visible whitespace-nowrap"
                      style={{ fontSize: 8, color: "var(--color-dim)" }}
                    >
                      {i % axisStep === 0 ? dm(date) : ""}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 5. Heatmap istanza × giorno ──────────────────────────── */}
      <section>
        <div className="section-label mb-1">📅 Heatmap attività</div>
        <p className="text-[10px] text-[var(--color-dim)] mb-4">
          Una riga per istanza. L&apos;intensità è relativa al picco
          giornaliero di ciascuna istanza.
        </p>
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 overflow-x-auto">
          <div style={{ minWidth: Math.max(360, days * 12) }}>
            {heatRows.map(({ actor: a, max, label, aggregated }) => {
              const meta = ROLE_META[a.role];
              return (
                <div
                  key={`${a.role}-${a.actor}`}
                  className="flex items-center gap-2 mb-1.5"
                >
                  <div
                    className="flex items-center gap-1.5 shrink-0"
                    style={{ width: 116 }}
                    title={aggregated ? AGGREGATO_HINT : `${meta.label} · ${a.actor}`}
                  >
                    <span className="text-[12px] leading-none">{meta.emoji}</span>
                    <span
                      className="text-[10px] font-semibold truncate tabular-nums"
                      style={{ color: aggregated ? "var(--color-dim)" : meta.color }}
                    >
                      {label}
                    </span>
                  </div>
                  <div className="flex gap-[2px] flex-1">
                    {a.daily.map((c, di) => {
                      const intensity = c > 0 ? 0.18 + 0.82 * (c / max) : 0;
                      return (
                        <div
                          key={dates[di]}
                          className="flex-1 rounded-[2px] cursor-default"
                          style={{
                            height: 15,
                            background: c > 0 ? meta.color : "var(--color-border)",
                            opacity: c > 0 ? intensity : 0.25,
                          }}
                          onMouseEnter={(e) =>
                            showTip(e, `${meta.emoji} ${label} · ${dm(dates[di])}`, [
                              {
                                color: meta.color,
                                label: c === 1 ? "azione" : "azioni",
                                value: String(c),
                              },
                            ])
                          }
                          onMouseMove={moveTip}
                          onMouseLeave={hideTip}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {/* Asse x heatmap */}
            <div className="flex items-center gap-2 mt-1">
              <div className="shrink-0" style={{ width: 116 }} />
              <div className="flex gap-[2px] flex-1">
                {dates.map((date, i) => (
                  <div
                    key={date}
                    className="flex-1 text-center overflow-visible whitespace-nowrap"
                    style={{ fontSize: 8, color: "var(--color-dim)" }}
                  >
                    {i % tick === 0 ? dm(date) : ""}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <TooltipLayer ref={tipRef} />
    </div>
  );
}
