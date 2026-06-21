"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  TeamActivity,
  TeamActivityActor,
  TeamActivityRole,
} from "@/lib/team-activity";
import { ROLE_META, timeAgo, dmhm } from "@/lib/team-activity-meta";
import RecentActivityFeed from "@/app/components/RecentActivityFeed";
import {
  TooltipLayer,
  type TipRow,
  type TooltipHandle,
} from "@/app/components/ChartTooltip";

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

/* ── Scatter temporale isolato (con zoom) ──────────────────────────
   Stato `zoom` interno: lo zoom espande la larghezza del piano (px/giorno)
   → la scrollbar orizzontale serve proprio a esplorare la timeline zoomata,
   separando i giorni e, a zoom alto, i singoli eventi (minuti). Isolato in un
   componente a parte così lo zoom NON ri-renderizza gli altri grafici. */
function TemporalScatter({
  roles,
  timeline,
  fromMs,
  span,
  dates,
  onShow,
  onMove,
  onHide,
}: {
  roles: TeamActivityRole[];
  timeline: {
    role: TeamActivityRole;
    actor: string;
    ts: string;
    pid: string | null;
  }[];
  fromMs: number;
  span: number;
  dates: string[];
  onShow: (e: React.MouseEvent, title: string, rows: TipRow[]) => void;
  onMove: (e: React.MouseEvent) => void;
  onHide: () => void;
}) {
  const ZOOMS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
  const [zoom, setZoom] = useState(1);
  // Misura la larghezza del piano: a zoom 1 il grafico riempie tutto il container
  // (primo giorno a sinistra, ultimo al bordo destro); zoom>1 espande → scroll.
  const planeRef = useRef<HTMLDivElement>(null);
  const [planeW, setPlaneW] = useState(0);
  useEffect(() => {
    const el = planeRef.current;
    if (!el) return;
    const update = () => setPlaneW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const days = dates.length;
  const laneH = 30;
  const scatterW = Math.max(1, Math.round((planeW || 600) * zoom));
  const axisStep = Math.max(
    1,
    Math.ceil(days / Math.max(1, Math.floor(scatterW / 70))),
  );
  const H = roles.length * laneH;
  const zi = ZOOMS.indexOf(zoom);

  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="section-label">🗓️ Quando, chi e cosa</div>
        {/* Controllo zoom */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setZoom(ZOOMS[Math.max(0, zi - 1)])}
            disabled={zi <= 0}
            className="w-6 h-6 rounded-md text-[12px] font-bold leading-none transition-colors disabled:opacity-30"
            style={{
              background: "transparent",
              color: "var(--color-muted)",
              border: "1px solid var(--color-border)",
            }}
            title="Zoom indietro"
          >
            −
          </button>
          <span className="text-[10px] text-[var(--color-dim)] w-8 text-center tabular-nums">
            {zoom}×
          </span>
          <button
            onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zi + 1)])}
            disabled={zi >= ZOOMS.length - 1}
            className="w-6 h-6 rounded-md text-[12px] font-bold leading-none transition-colors disabled:opacity-30"
            style={{
              background: "transparent",
              color: "var(--color-muted)",
              border: "1px solid var(--color-border)",
            }}
            title="Zoom avanti"
          >
            +
          </button>
        </div>
      </div>
      <p className="text-[10px] text-[var(--color-dim)] mb-4">
        Ogni segno è un&apos;azione all&apos;ora esatta · una corsia per ruolo.
        Zooma per separare giorni e minuti, poi scorri orizzontalmente.
      </p>
      <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
        <div className="flex">
          {/* Corsie (label ruolo, fisse) */}
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
          {/* Piano scatter — scrollabile */}
          <div ref={planeRef} className="flex-1 overflow-x-auto">
            <div style={{ width: scatterW }}>
              <svg width={scatterW} height={H} viewBox={`0 0 ${scatterW} ${H}`}>
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
                {timeline.map((ev, idx) => {
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
                      opacity={0.6}
                      className="cursor-default"
                      onMouseEnter={(e) =>
                        onShow(e, `${meta.emoji} ${label} · ${dmhm(ev.ts)}`, [
                          {
                            color: meta.color,
                            label: meta.action,
                            value: ev.pid ? `#${ev.pid}` : "",
                          },
                        ])
                      }
                      onMouseMove={onMove}
                      onMouseLeave={onHide}
                    />
                  );
                })}
              </svg>
              {/* Asse x: tick per giorno (più fitti a zoom alto) */}
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
  );
}

/* ── Donut interattivo (drill-down ruoli → istanze) ───────────────
   Vista per ruoli; cliccando un ruolo con istanze il donut si "apre" sulle
   sue istanze (scout-1, scout-2…) come spicchi a tonalità decrescenti, con
   legenda dettagliata e back. Stato interno → non ri-renderizza il resto. */
function WorkDonut({
  roles,
  roleTotals,
  actors,
  totalAll,
  onShow,
  onMove,
  onHide,
}: {
  roles: TeamActivityRole[];
  roleTotals: Record<TeamActivityRole, number>;
  actors: TeamActivityActor[];
  totalAll: number;
  onShow: (e: React.MouseEvent, title: string, rows: TipRow[]) => void;
  onMove: (e: React.MouseEvent) => void;
  onHide: () => void;
}) {
  const [sel, setSel] = useState<TeamActivityRole | null>(null);
  const roleHasInstances = (r: TeamActivityRole) =>
    actors.some((a) => a.role === r && a.actor !== a.role && a.total > 0);

  type Slice = {
    key: string;
    label: string;
    emoji: string;
    color: string;
    opacity: number;
    value: number;
    pct: number;
    clickable: boolean;
    role?: TeamActivityRole;
    last?: string | null;
    tipTitle: string;
  };

  let slices: Slice[];
  let centerMain: number;
  let centerSub: string;

  if (sel) {
    const meta = ROLE_META[sel];
    const items = actors
      .filter((a) => a.role === sel && a.total > 0)
      .sort((a, b) => b.total - a.total || a.actor.localeCompare(b.actor));
    const hasNamed = items.some((a) => a.actor !== a.role);
    const sum = items.reduce((s, x) => s + x.total, 0) || 1;
    slices = items.map((a, k) => {
      const lbl = actorLabel(a, meta.label, hasNamed);
      return {
        key: a.actor,
        label: lbl,
        emoji: meta.emoji,
        color: meta.color,
        opacity: Math.max(0.32, 1 - k * 0.16),
        value: a.total,
        pct: Math.round((a.total / sum) * 100),
        clickable: false,
        last: a.lastActiveAt,
        tipTitle: `${meta.emoji} ${lbl}`,
      };
    });
    centerMain = roleTotals[sel];
    centerSub = meta.label.toUpperCase();
  } else {
    const rs = roles
      .filter((r) => roleTotals[r] > 0)
      .map((r) => ({ r, value: roleTotals[r] }))
      .sort((a, b) => b.value - a.value);
    const sum = rs.reduce((s, x) => s + x.value, 0) || 1;
    slices = rs.map(({ r, value }) => ({
      key: r,
      label: ROLE_META[r].label,
      emoji: ROLE_META[r].emoji,
      color: ROLE_META[r].color,
      opacity: 0.9,
      value,
      pct: Math.round((value / sum) * 100),
      clickable: roleHasInstances(r),
      role: r,
      tipTitle: `${ROLE_META[r].emoji} ${ROLE_META[r].label}`,
    }));
    centerMain = totalAll;
    centerSub = "AZIONI";
  }

  const sliceSum = slices.reduce((t, x) => t + x.value, 0) || 1;
  let acc = 0;
  const arcs = slices.map((s) => {
    const frac = s.value / sliceSum;
    const start = acc;
    acc += frac;
    return { ...s, frac, start };
  });

  const R = 60;
  const C = 2 * Math.PI * R;

  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="section-label">🍩 Distribuzione del lavoro</div>
        {sel && (
          <button
            onClick={() => setSel(null)}
            className="text-[10px] font-semibold rounded-md px-2 py-1 border border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-blue)] hover:text-[var(--color-blue)] transition-colors"
          >
            ← tutti i ruoli
          </button>
        )}
      </div>
      <p className="text-[10px] text-[var(--color-dim)] mb-4">
        {sel
          ? `Dettaglio istanze di ${ROLE_META[sel].label}, in quota sul totale del ruolo.`
          : "Quota di lavoro per ruolo · clicca un ruolo per vederne le istanze."}
      </p>
      <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 flex flex-col sm:flex-row items-center gap-6">
        {/* Donut SVG */}
        <div className="relative shrink-0" style={{ width: 168, height: 168 }}>
          <svg viewBox="0 0 168 168" width={168} height={168}>
            <g transform="rotate(-90 84 84)">
              {arcs.map((s) => (
                <circle
                  key={s.key}
                  cx={84}
                  cy={84}
                  r={R}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={22}
                  strokeDasharray={`${s.frac * C} ${C - s.frac * C}`}
                  strokeDashoffset={-s.start * C}
                  className={s.clickable ? "cursor-pointer" : "cursor-default"}
                  style={{ opacity: s.opacity }}
                  onClick={
                    s.clickable && s.role ? () => setSel(s.role!) : undefined
                  }
                  onMouseEnter={(e) =>
                    onShow(e, s.tipTitle, [
                      {
                        color: s.color,
                        label: `${s.pct}% · azioni`,
                        value: String(s.value),
                      },
                    ])
                  }
                  onMouseMove={onMove}
                  onMouseLeave={onHide}
                />
              ))}
            </g>
            <text
              x={84}
              y={80}
              textAnchor="middle"
              className="fill-[var(--color-white)]"
              style={{ fontSize: 22, fontWeight: 700 }}
            >
              {centerMain}
            </text>
            <text
              x={84}
              y={98}
              textAnchor="middle"
              className="fill-[var(--color-dim)]"
              style={{ fontSize: 9, letterSpacing: 1 }}
            >
              {centerSub}
            </text>
          </svg>
        </div>
        {/* Legenda */}
        <div className="flex-1 w-full space-y-2">
          {arcs.map((s) => (
            <div
              key={s.key}
              className={`flex items-center gap-3 rounded-md px-2 py-1 -mx-2 ${
                s.clickable ? "cursor-pointer hover:bg-[var(--color-bg)]" : ""
              }`}
              onClick={
                s.clickable && s.role ? () => setSel(s.role!) : undefined
              }
            >
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ background: s.color, opacity: s.opacity }}
              />
              {!sel && (
                <span className="text-[11px] leading-none">{s.emoji}</span>
              )}
              <span
                className="text-[11px] font-semibold shrink-0 truncate"
                style={{
                  color: sel ? "var(--color-muted)" : s.color,
                  width: sel ? 96 : 80,
                }}
                title={s.label}
              >
                {s.label}
              </span>
              <div
                className="flex-1 h-1.5 rounded-full overflow-hidden"
                style={{ background: "var(--color-border)" }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${s.frac * 100}%`,
                    background: s.color,
                    opacity: Math.max(0.55, s.opacity),
                  }}
                />
              </div>
              <span className="text-[11px] font-bold w-10 text-right shrink-0 tabular-nums">
                {s.pct}%
              </span>
              <span className="text-[10px] text-[var(--color-dim)] w-12 text-right shrink-0 tabular-nums">
                {s.value}
              </span>
              {sel ? (
                <span className="text-[9px] text-[var(--color-dim)] w-20 text-right shrink-0 tabular-nums whitespace-nowrap">
                  ultimo {timeAgo(s.last ?? null)}
                </span>
              ) : (
                <span
                  className="text-[10px] w-4 text-right shrink-0"
                  style={{
                    color: "var(--color-dim)",
                    visibility: s.clickable ? "visible" : "hidden",
                  }}
                >
                  ▶
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Componente principale ──────────────────────────────────────────
   `showRecent`: il feed "Attività recente" linka a rotte protette
   (/team/attivita/log, /positions/[id]) → su pagine pubbliche (case-studies)
   va passato false. Default true per la vista protetta. */
export default function ActivityCharts({
  activity,
  showRecent = true,
  showLeaderboard = true,
  showDonut = true,
  showVolume = true,
}: {
  activity: TeamActivity;
  showRecent?: boolean;
  showLeaderboard?: boolean;
  showDonut?: boolean;
  showVolume?: boolean;
}) {
  const {
    dates,
    roles,
    actors,
    roleDaily,
    roleTotals,
    totalAll,
    days,
    recent,
  } = activity;

  // Regola UI: nascondiamo agenti/categorie a 0 → mostriamo solo chi ha
  // almeno un dato nel periodo.
  const activeRoles = useMemo(
    () => roles.filter((r) => roleTotals[r] > 0),
    [roles, roleTotals],
  );

  // Leaderboard: raggruppa le istanze per ruolo; ruoli ordinati per azioni nel
  // range, istanze ordinate per azioni nel range.
  const groups = useMemo(() => {
    return roles
      .map((role) => {
        // Solo istanze con almeno un dato nel periodo.
        const items = actors
          .filter((a) => a.role === role && a.total > 0)
          .sort((a, b) => b.total - a.total || a.actor.localeCompare(b.actor));
        const last = items.reduce<string | null>((acc, a) => {
          if (a.lastActiveAt && (!acc || a.lastActiveAt > acc))
            return a.lastActiveAt;
          return acc;
        }, null);
        const maxInstance = Math.max(1, ...items.map((a) => a.total));
        const hasNamed = items.some((a) => a.actor !== a.role);
        return {
          role,
          items,
          total: roleTotals[role],
          last,
          maxInstance,
          hasNamed,
        };
      })
      .filter((g) => g.total > 0) // niente ruoli a 0
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
    const out: {
      actor: TeamActivityActor;
      max: number;
      label: string;
      aggregated: boolean;
    }[] = [];
    for (const role of roles) {
      const items = actors
        .filter((a) => a.role === role && a.total > 0)
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
  // Scatter temporale: posizione x = quota del range, lane per ruolo.
  const fromMs = Date.parse(`${activity.from}T00:00:00Z`);
  const toMs = Date.parse(`${activity.to}T23:59:59Z`);
  const span = Math.max(1, toMs - fromMs);

  /* ── Tooltip custom (hover su barre/celle) ─────────────────────────
     Gli handler chiamano il layer isolato via ref: NON toccano lo stato di
     questo componente, quindi i grafici non si ri-renderizzano sull'hover. */
  const tipRef = useRef<TooltipHandle>(null);
  const showTip = (e: React.MouseEvent, title: string, rows: TipRow[]) =>
    tipRef.current?.show(e.clientX, e.clientY, title, rows);
  const moveTip = (e: React.MouseEvent) =>
    tipRef.current?.move(e.clientX, e.clientY);
  const hideTip = () => tipRef.current?.hide();

  // Leaderboard: dettaglio istanze collassato di default (vediamo i ruoli uno
  // sotto l'altro); click sull'header per espandere.
  const [expanded, setExpanded] = useState<Set<TeamActivityRole>>(new Set());
  const toggleRole = (r: TeamActivityRole) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });

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
    <div
      className="space-y-10"
      style={{ animation: "fade-in 0.35s ease both" }}
    >
      {/* ── 0. Attività recente (chi ha fatto le ultime azioni) ──── */}
      {showRecent && (
        <RecentActivityFeed recent={recent} viewAllHref="/team/attivita/log" />
      )}
      {/* ── 1. Leaderboard nel periodo (per istanza) ─────────────── */}
      {showLeaderboard && (
        <section>
          <div className="section-label mb-1">🏅 Leaderboard · nel periodo</div>
          <p className="text-[10px] text-[var(--color-dim)] mb-4">
            Per ruolo e per singola istanza (es. scout-1), sul range
            selezionato.
          </p>
          <div className="space-y-3">
            {groups.map((g, i) => {
              const meta = ROLE_META[g.role];
              const showInstances =
                g.items.length > 1 ||
                (g.items.length === 1 && g.items[0].actor !== g.role);
              const isExpanded = expanded.has(g.role);
              return (
                <div
                  key={g.role}
                  className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors"
                  style={{ animation: `fade-in 0.4s ease ${i * 0.06}s both` }}
                >
                  {/* Header ruolo (cliccabile per espandere le istanze) */}
                  <div
                    className={`flex items-center justify-between mb-3 ${showInstances ? "cursor-pointer select-none" : ""}`}
                    onClick={
                      showInstances ? () => toggleRole(g.role) : undefined
                    }
                    role={showInstances ? "button" : undefined}
                    aria-expanded={showInstances ? isExpanded : undefined}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="text-[9px] w-3 shrink-0 transition-transform"
                        style={{
                          color: "var(--color-dim)",
                          visibility: showInstances ? "visible" : "hidden",
                          transform: isExpanded ? "rotate(90deg)" : "none",
                        }}
                        aria-hidden="true"
                      >
                        ▶
                      </span>
                      <span className="text-[15px] leading-none">
                        {meta.emoji}
                      </span>
                      <span
                        className="text-[13px] font-bold"
                        style={{ color: meta.color }}
                      >
                        {meta.label}
                      </span>
                      <span className="text-[10px] text-[var(--color-dim)] truncate">
                        · {meta.verb}
                        {g.items.length > 1
                          ? ` · ${g.items.length} istanze`
                          : ""}
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
                    <span className="text-[10px] text-[var(--color-dim)] w-20 text-right shrink-0 whitespace-nowrap">
                      ultimo {timeAgo(g.last)}
                    </span>
                  </div>

                  {/* Dettaglio per istanza (visibile solo se espanso) */}
                  {showInstances && isExpanded && (
                    <div className="mt-3 pt-3 border-t border-[var(--color-border)] space-y-2">
                      {g.items.map((a) => {
                        const isAgg = a.actor === a.role && g.hasNamed;
                        return (
                          <div
                            key={a.actor}
                            className="flex items-center gap-3"
                          >
                            <span
                              className="text-[10px] font-semibold w-24 shrink-0 truncate tabular-nums"
                              style={{
                                color: isAgg
                                  ? "var(--color-dim)"
                                  : "var(--color-muted)",
                              }}
                              title={isAgg ? AGGREGATO_HINT : a.actor}
                            >
                              {actorLabel(
                                a,
                                ROLE_META[g.role].label,
                                g.hasNamed,
                              )}
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
                            <span className="text-[9px] text-[var(--color-dim)] w-20 text-right shrink-0 tabular-nums whitespace-nowrap">
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
      )}

      {/* ── 2. Donut interattivo: distribuzione + drill-down ─────── */}
      {showDonut && (
        <WorkDonut
          roles={roles}
          roleTotals={roleTotals}
          actors={actors}
          totalAll={totalAll}
          onShow={showTip}
          onMove={moveTip}
          onHide={hideTip}
        />
      )}
      {/* ── 3. Timeline impilata (per ruolo) ─────────────────────── */}
      {showVolume && (
        <section>
          <div className="section-label mb-1">
            📈 Volume di lavoro nel tempo
          </div>
          <p className="text-[10px] text-[var(--color-dim)] mb-4">
            Azioni totali al giorno, scomposte per ruolo · {days} giorni.
          </p>
          <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
            {/* Legenda (solo ruoli con dati) */}
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-4">
              {activeRoles.map((r) => (
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
                    : [
                        {
                          color: "var(--color-dim)",
                          label: "nessuna attività",
                          value: "",
                        },
                      ];
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
                      style={{
                        height: `${hPct}%`,
                        minHeight: total > 0 ? 2 : 0,
                      }}
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
      )}

      {/* ── 4. Scatter temporale: chi, quando, cosa ──────────────── */}
      <TemporalScatter
        roles={activeRoles}
        timeline={activity.timeline}
        fromMs={fromMs}
        span={span}
        dates={dates}
        onShow={showTip}
        onMove={moveTip}
        onHide={hideTip}
      />
      {/* ── 5. Heatmap istanza × giorno ──────────────────────────── */}
      <section>
        <div className="section-label mb-1">📅 Heatmap attività</div>
        <p className="text-[10px] text-[var(--color-dim)] mb-4">
          Una riga per istanza. L&apos;intensità è relativa al picco giornaliero
          di ciascuna istanza.
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
                    title={
                      aggregated ? AGGREGATO_HINT : `${meta.label} · ${a.actor}`
                    }
                  >
                    <span className="text-[12px] leading-none">
                      {meta.emoji}
                    </span>
                    <span
                      className="text-[10px] font-semibold truncate tabular-nums"
                      style={{
                        color: aggregated ? "var(--color-dim)" : meta.color,
                      }}
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
                            background:
                              c > 0 ? meta.color : "var(--color-border)",
                            opacity: c > 0 ? intensity : 0.25,
                          }}
                          onMouseEnter={(e) =>
                            showTip(
                              e,
                              `${meta.emoji} ${label} · ${dm(dates[di])}`,
                              [
                                {
                                  color: meta.color,
                                  label: c === 1 ? "azione" : "azioni",
                                  value: String(c),
                                },
                              ],
                            )
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
