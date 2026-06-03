"use client";

import {
  Fragment,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { AgentActivity, CaseStudy, FiveHourWindow, Window } from "./types";
import { providerColor } from "./types";
import { chartPalette, useChartTheme, type ChartPalette } from "./chart-theme";

// Dedicated tab: per-5h-window breakdown of the concrete pipeline actions the
// team performed (positions found, analyzed, scored, excluded, CVs written /
// ready). Source = case_study_agent_activity.reason, which encodes each action
// with a leading emoji. Messages / sleeps / health pings are NOT actions and
// are filtered out here.
//
// All charts are interactive: the legend / KPI cards toggle series on every
// chart, hovering a legend item focuses that series everywhere, and each chart
// shows a rich hover tooltip.

type Props = {
  caseStudy: CaseStudy;
  weekly: Window;
};

type ActionKey =
  | "found"
  | "checked"
  | "scored"
  | "excluded"
  | "writing"
  | "ready";

type ActionDef = {
  key: ActionKey;
  label: string;
  short: string;
  emoji: string;
  color: string;
  agent: string;
};

// Pipeline order (left→right / bottom→top). `excluded` is a drop-off but kept
// in the volume views as real work performed by analyst/scorer.
const ACTIONS: ActionDef[] = [
  {
    key: "found",
    label: "Posizioni trovate",
    short: "Trovate",
    emoji: "📥",
    color: "#00e87a",
    agent: "scout",
  },
  {
    key: "checked",
    label: "Analizzate",
    short: "Analizzate",
    emoji: "✅",
    color: "#60a5fa",
    agent: "analista",
  },
  {
    key: "scored",
    label: "Scored",
    short: "Scored",
    emoji: "⭐",
    color: "#facc15",
    agent: "scorer",
  },
  {
    key: "excluded",
    label: "Escluse",
    short: "Escluse",
    emoji: "🚫",
    color: "#f87171",
    agent: "analista/scorer",
  },
  {
    key: "writing",
    label: "CV in scrittura",
    short: "In scrittura",
    emoji: "✍️",
    color: "#a78bfa",
    agent: "scrittore",
  },
  {
    key: "ready",
    label: "CV pronti",
    short: "Pronti",
    emoji: "📄",
    color: "#f472b6",
    agent: "scrittore",
  },
];

const EMPTY_COUNTS = (): Record<ActionKey, number> => ({
  found: 0,
  checked: 0,
  scored: 0,
  excluded: 0,
  writing: 0,
  ready: 0,
});

function classify(reason: string | null): ActionKey | null {
  if (!reason) return null;
  const r = reason.trimStart();
  if (r.startsWith("📥")) return "found";
  if (r.startsWith("✅")) return "checked";
  if (r.startsWith("⭐")) return "scored";
  if (r.startsWith("🚫")) return "excluded";
  if (r.startsWith("✍️") || r.startsWith("✍")) return "writing";
  if (r.startsWith("📄")) return "ready";
  return null;
}

function parseTs(s: string): number {
  const iso = s.includes("T") ? s : s.replace(" ", "T") + "Z";
  return new Date(iso).getTime();
}

const FIVE_HOURS_MS = 5 * 3600_000;

function hm(iso: string): string {
  return iso.length >= 16 ? iso.slice(11, 16) : iso;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

type WindowBucket = {
  win: FiveHourWindow;
  counts: Record<ActionKey, number>;
  total: number;
};

function buildBuckets(
  windows: FiveHourWindow[],
  activity: AgentActivity[],
): WindowBucket[] {
  const buckets: WindowBucket[] = windows.map((win) => ({
    win,
    counts: EMPTY_COUNTS(),
    total: 0,
  }));
  if (windows.length === 0) return buckets;
  const startMs = parseTs(windows[0].started_at);
  for (const a of activity) {
    const key = classify(a.reason);
    if (!key) continue;
    const t = parseTs(a.ts_start);
    const idx = clamp(
      Math.floor((t - startMs) / FIVE_HOURS_MS),
      0,
      windows.length - 1,
    );
    buckets[idx].counts[key] += 1;
    buckets[idx].total += 1;
  }
  return buckets;
}

/* ----------------------------------------------------------------------- */
/* Interactive tooltip plumbing                                            */
/* ----------------------------------------------------------------------- */

type Tip = { x: number; y: number; node: ReactNode } | null;

function useTooltip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip>(null);
  function show(e: { clientX: number; clientY: number }, node: ReactNode) {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, node });
  }
  const hide = () => setTip(null);
  return { ref, tip, show, hide };
}

function TooltipLayer({
  tip,
  pal,
  containerRef,
}: {
  tip: Tip;
  pal: ChartPalette;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  if (!tip) return null;
  const cw = containerRef.current?.clientWidth ?? 0;
  const flip = tip.x > cw - 230;
  return (
    <div
      className="pointer-events-none absolute z-30 w-[220px] rounded-md border px-3 py-2 text-[11px] shadow-xl"
      style={{
        left: tip.x + (flip ? -12 : 12),
        top: tip.y + 12,
        transform: flip ? "translateX(-100%)" : undefined,
        backgroundColor: pal.hoverTooltipBg,
        borderColor: pal.hoverTooltipBorder,
        color: pal.hoverTooltipText,
      }}
    >
      {tip.node}
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
      style={{ backgroundColor: color }}
    />
  );
}

/* ----------------------------------------------------------------------- */

export function TeamActionsTab({ caseStudy, weekly }: Props) {
  const { mode } = useChartTheme();
  const isDark = mode === "dark";
  const pal = chartPalette(mode);
  const accent = providerColor(caseStudy.provider_name);

  const windows = weekly.five_hour_windows ?? [];
  const activity = weekly.agent_activity ?? [];

  // Shared interactivity state across all charts.
  const [hidden, setHidden] = useState<Set<ActionKey>>(new Set());
  const [focus, setFocus] = useState<ActionKey | null>(null);
  const toggle = (k: ActionKey) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const { buckets, totals, grandTotal } = useMemo(() => {
    const bks = buildBuckets(windows, activity);
    const tot = EMPTY_COUNTS();
    for (const b of bks) {
      for (const a of ACTIONS) tot[a.key] += b.counts[a.key];
    }
    const grand = ACTIONS.reduce((s, a) => s + tot[a.key], 0);
    return { buckets: bks, totals: tot, grandTotal: grand };
  }, [windows, activity]);

  if (windows.length === 0 || grandTotal === 0) return null;

  const visible = ACTIONS.filter((a) => !hidden.has(a.key));

  const hi = { focus, setFocus };

  return (
    <section
      className={`py-10 ${isDark ? "bg-slate-950" : "bg-slate-50"}`}
      style={{ color: isDark ? "#f1f5f9" : "#0f172a" }}
    >
      <div className="mx-auto max-w-6xl px-6">
        <header className="mb-6">
          <h2
            className="text-2xl font-bold sm:text-3xl"
            style={{ color: isDark ? "#ffffff" : "#0f172a" }}
          >
            🔧 Azioni per finestra
          </h2>
          <p
            className="mt-1 max-w-3xl text-sm"
            style={{ color: isDark ? "#94a3b8" : "#475569" }}
          >
            {caseStudy.title} · cosa ha <em>fatto</em> il team in ogni slice
            rolling 5h: posizioni trovate, analizzate, scored, escluse, e CV
            scritti/pronti. Conteggi estratti dagli eventi di cambio-stato sul
            DB ({grandTotal.toLocaleString("it-IT")} azioni su {windows.length}{" "}
            finestre). I grafici sono interattivi: <strong>clicca</strong> una
            card qui sotto per mostrarla/nasconderla ovunque,{" "}
            <strong>passa il mouse</strong> per evidenziarla e vedere i
            dettagli.
          </p>
        </header>

        {/* KPI totali — fungono anche da legenda/filtro cliccabile */}
        <KpiStrip
          totals={totals}
          grandTotal={grandTotal}
          pal={pal}
          hidden={hidden}
          toggle={toggle}
          {...hi}
        />

        {/* Istogramma impilato: volume azioni per finestra */}
        <ChartCard
          pal={pal}
          title="📊 Volume azioni per finestra 5h"
          caption="Altezza colonna = azioni totali nella finestra; ogni segmento è un tipo di azione. Passa il mouse su una colonna per il dettaglio."
        >
          <StackedColumns
            buckets={buckets}
            visible={visible}
            pal={pal}
            {...hi}
          />
        </ChartCard>

        {/* Linee cumulative: avanzamento pipeline */}
        <ChartCard
          pal={pal}
          title="📈 Avanzamento cumulativo della pipeline"
          caption="Totale cumulato per tipo di azione, finestra dopo finestra. La distanza tra «Trovate» e «Pronti» è il lag della pipeline."
        >
          <CumulativeLines
            buckets={buckets}
            visible={visible}
            pal={pal}
            {...hi}
          />
        </ChartCard>

        {/* Donut distribuzione a tutta larghezza */}
        <ChartCard
          pal={pal}
          title="🍩 Distribuzione complessiva"
          caption="Quota di ogni tipo di azione sul totale (solo serie visibili)."
        >
          <DistributionDonut
            totals={totals}
            visible={visible}
            pal={pal}
            {...hi}
          />
        </ChartCard>

        {/* Dettaglio per finestra a tutta larghezza */}
        <ChartCard
          pal={pal}
          title="🗂️ Dettaglio per finestra"
          caption="Conteggi esatti per ciascuna slice 5h — i numeri così come sono nel DB."
        >
          <PerWindowSmallMultiples
            buckets={buckets}
            visible={visible}
            pal={pal}
            accent={accent}
            {...hi}
          />
        </ChartCard>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------------- */
/* Shared bits                                                             */
/* ----------------------------------------------------------------------- */

type HiProps = {
  focus: ActionKey | null;
  setFocus: (k: ActionKey | null) => void;
};

function ChartCard({
  pal,
  title,
  caption,
  children,
}: {
  pal: ChartPalette;
  title: string;
  caption: string;
  children: ReactNode;
}) {
  return (
    <figure
      className="mb-6 rounded-xl border p-5"
      style={{
        borderColor: pal.figBorder,
        backgroundColor: pal.figBg,
        color: pal.figText,
      }}
    >
      <figcaption className="mb-1 text-base font-semibold">{title}</figcaption>
      <p className="mb-4 text-xs" style={{ color: pal.fullChartCaption }}>
        {caption}
      </p>
      {children}
    </figure>
  );
}

function KpiStrip({
  totals,
  grandTotal,
  pal,
  hidden,
  toggle,
  focus,
  setFocus,
}: HiProps & {
  totals: Record<ActionKey, number>;
  grandTotal: number;
  pal: ChartPalette;
  hidden: Set<ActionKey>;
  toggle: (k: ActionKey) => void;
}) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
      <div
        className="rounded-xl border p-4"
        style={{ borderColor: pal.figBorder, backgroundColor: pal.figBg }}
      >
        <div
          className="text-xs uppercase tracking-wider"
          style={{ color: pal.legendLabel }}
        >
          Azioni totali
        </div>
        <div className="mt-1 text-2xl font-bold" style={{ color: pal.figText }}>
          {grandTotal.toLocaleString("it-IT")}
        </div>
      </div>
      {ACTIONS.map((a) => {
        const off = hidden.has(a.key);
        return (
          <button
            key={a.key}
            type="button"
            onClick={() => toggle(a.key)}
            onMouseEnter={() => setFocus(a.key)}
            onMouseLeave={() => setFocus(null)}
            className="rounded-xl border p-4 text-left transition"
            style={{
              borderColor: focus === a.key ? a.color : pal.figBorder,
              backgroundColor: pal.figBg,
              opacity: off ? 0.4 : 1,
              boxShadow:
                focus === a.key ? `inset 0 0 0 1px ${a.color}` : undefined,
            }}
            title={off ? "Mostra serie" : "Nascondi serie"}
          >
            <div
              className="flex items-center gap-1.5 text-xs uppercase tracking-wider"
              style={{ color: pal.legendLabel }}
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-[2px]"
                style={{ backgroundColor: a.color }}
              />
              {a.short}
            </div>
            <div
              className="mt-1 text-2xl font-bold leading-none"
              style={{
                color: a.color,
                textDecoration: off ? "line-through" : "none",
              }}
            >
              {totals[a.key].toLocaleString("it-IT")}
            </div>
            <div
              className="mt-1 whitespace-nowrap text-[10px] leading-tight"
              style={{ color: pal.legendLabel }}
            >
              {a.agent}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.5; v += step) ticks.push(Math.round(v));
  return ticks;
}

/* ----------------------------------------------------------------------- */
/* 1. Stacked columns (interactive)                                        */
/* ----------------------------------------------------------------------- */

function StackedColumns({
  buckets,
  visible,
  pal,
  focus,
  setFocus,
}: HiProps & {
  buckets: WindowBucket[];
  visible: ActionDef[];
  pal: ChartPalette;
}) {
  const { ref, tip, show, hide } = useTooltip();
  const [hiCol, setHiCol] = useState<number | null>(null);

  const W = 760;
  const H = 360;
  const m = { top: 16, right: 16, bottom: 44, left: 44 };
  const plotW = W - m.left - m.right;
  const plotH = H - m.top - m.bottom;
  const n = buckets.length;
  const colW = plotW / n;
  const barW = Math.min(54, colW * 0.62);

  const visTotal = (b: WindowBucket) =>
    visible.reduce((s, a) => s + b.counts[a.key], 0);
  const maxTotal = Math.max(1, ...buckets.map(visTotal));
  const ticks = niceTicks(maxTotal);
  const yMax = ticks[ticks.length - 1] || maxTotal;
  const y = (v: number) => m.top + plotH - (v / yMax) * plotH;

  const tooltipNode = (b: WindowBucket) => (
    <div>
      <div className="mb-1 font-mono font-semibold">
        Finestra #{b.win.window_number} · {hm(b.win.started_at)}→
        {hm(b.win.ended_at)}
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 font-mono">
        {visible.map((a) => (
          <Fragment key={a.key}>
            <dt
              className="inline-flex items-center gap-1.5"
              style={{ color: pal.hoverTooltipMuted }}
            >
              <Swatch color={a.color} />
              {a.short}
            </dt>
            <dd className="text-right font-semibold" style={{ color: a.color }}>
              {b.counts[a.key]}
            </dd>
          </Fragment>
        ))}
        <dt
          className="mt-1 border-t pt-1"
          style={{
            color: pal.hoverTooltipMuted,
            borderColor: pal.hoverTooltipBorder,
          }}
        >
          Totale
        </dt>
        <dd
          className="mt-1 border-t pt-1 text-right font-bold"
          style={{
            color: pal.hoverTooltipText,
            borderColor: pal.hoverTooltipBorder,
          }}
        >
          {visTotal(b)}
        </dd>
      </dl>
    </div>
  );

  return (
    <div ref={ref} className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        onMouseLeave={() => {
          hide();
          setHiCol(null);
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={m.left}
              x2={W - m.right}
              y1={y(t)}
              y2={y(t)}
              stroke={pal.gridLine}
              strokeWidth={1}
            />
            <text
              x={m.left - 6}
              y={y(t) + 3}
              textAnchor="end"
              fontSize={10}
              fill={pal.majorTick}
            >
              {t}
            </text>
          </g>
        ))}
        {buckets.map((b, i) => {
          const cx = m.left + i * colW + colW / 2;
          const x = cx - barW / 2;
          let yCursor = m.top + plotH;
          const tot = visTotal(b);
          return (
            <g key={i}>
              {/* hover capture + highlight band over the full column */}
              <rect
                x={m.left + i * colW}
                y={m.top}
                width={colW}
                height={plotH}
                fill={hiCol === i ? pal.bandB : "transparent"}
                onMouseMove={(e) => {
                  setHiCol(i);
                  show(e, tooltipNode(b));
                }}
              />
              {visible.map((a) => {
                const c = b.counts[a.key];
                if (c <= 0) return null;
                const hgt = (c / yMax) * plotH;
                yCursor -= hgt;
                const dim = focus != null && focus !== a.key;
                return (
                  <rect
                    key={a.key}
                    x={x}
                    y={yCursor}
                    width={barW}
                    height={hgt}
                    fill={a.color}
                    fillOpacity={dim ? 0.22 : 1}
                    pointerEvents="none"
                  />
                );
              })}
              <text
                x={cx}
                y={y(tot) - 5}
                textAnchor="middle"
                fontSize={11}
                fontWeight={700}
                fill={pal.figText}
                pointerEvents="none"
              >
                {tot}
              </text>
              <text
                x={cx}
                y={H - m.bottom + 16}
                textAnchor="middle"
                fontSize={11}
                fontWeight={600}
                fill={pal.bottomAxisText}
                pointerEvents="none"
              >
                #{b.win.window_number}
              </text>
              <text
                x={cx}
                y={H - m.bottom + 30}
                textAnchor="middle"
                fontSize={9}
                fill={pal.legendLabel}
                pointerEvents="none"
              >
                {hm(b.win.started_at)}
              </text>
            </g>
          );
        })}
        <line
          x1={m.left}
          x2={W - m.right}
          y1={m.top + plotH}
          y2={m.top + plotH}
          stroke={pal.baseline}
          strokeWidth={1.5}
        />
      </svg>
      <TooltipLayer tip={tip} pal={pal} containerRef={ref} />
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* 2. Cumulative lines (interactive)                                       */
/* ----------------------------------------------------------------------- */

function CumulativeLines({
  buckets,
  visible,
  pal,
  focus,
  setFocus,
}: HiProps & {
  buckets: WindowBucket[];
  visible: ActionDef[];
  pal: ChartPalette;
}) {
  const { ref, tip, show, hide } = useTooltip();
  const [hiIdx, setHiIdx] = useState<number | null>(null);

  const W = 760;
  const H = 320;
  const m = { top: 16, right: 64, bottom: 44, left: 44 };
  const plotW = W - m.left - m.right;
  const plotH = H - m.top - m.bottom;
  const n = buckets.length;

  const series = visible.map((a) => {
    let acc = 0;
    const pts = buckets.map((b) => {
      acc += b.counts[a.key];
      return acc;
    });
    return { def: a, pts, end: acc };
  });

  const yMaxRaw = Math.max(1, ...series.map((s) => s.end));
  const ticks = niceTicks(yMaxRaw);
  const yMax = ticks[ticks.length - 1] || yMaxRaw;
  const x = (i: number) =>
    n <= 1 ? m.left + plotW / 2 : m.left + (i / (n - 1)) * plotW;
  const y = (v: number) => m.top + plotH - (v / yMax) * plotH;

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const i = clamp(Math.round(((svgX - m.left) / plotW) * (n - 1)), 0, n - 1);
    setHiIdx(i);
    show(
      e,
      <div>
        <div className="mb-1 font-mono font-semibold">
          Fine finestra #{buckets[i].win.window_number}
        </div>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 font-mono">
          {series.map((s) => (
            <Fragment key={s.def.key}>
              <dt
                className="inline-flex items-center gap-1.5"
                style={{ color: pal.hoverTooltipMuted }}
              >
                <Swatch color={s.def.color} />
                {s.def.short}
              </dt>
              <dd
                className="text-right font-semibold"
                style={{ color: s.def.color }}
              >
                {s.pts[i]}
              </dd>
            </Fragment>
          ))}
        </dl>
      </div>,
    );
  }

  return (
    <div ref={ref} className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        onMouseMove={handleMove}
        onMouseLeave={() => {
          hide();
          setHiIdx(null);
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={m.left}
              x2={W - m.right}
              y1={y(t)}
              y2={y(t)}
              stroke={pal.gridLine}
              strokeWidth={1}
            />
            <text
              x={m.left - 6}
              y={y(t) + 3}
              textAnchor="end"
              fontSize={10}
              fill={pal.majorTick}
            >
              {t}
            </text>
          </g>
        ))}
        {/* hover guide */}
        {hiIdx != null && (
          <line
            x1={x(hiIdx)}
            x2={x(hiIdx)}
            y1={m.top}
            y2={m.top + plotH}
            stroke={pal.hoverGuide}
            strokeWidth={0.8}
            strokeDasharray="2 2"
            pointerEvents="none"
          />
        )}
        {buckets.map((b, i) => (
          <text
            key={i}
            x={x(i)}
            y={H - m.bottom + 18}
            textAnchor="middle"
            fontSize={11}
            fontWeight={hiIdx === i ? 700 : 600}
            fill={pal.bottomAxisText}
          >
            #{b.win.window_number}
          </text>
        ))}
        {series.map((s) => {
          const dim = focus != null && focus !== s.def.key;
          const d = s.pts
            .map(
              (v, idx) =>
                `${idx === 0 ? "M" : "L"} ${x(idx).toFixed(1)} ${y(v).toFixed(1)}`,
            )
            .join(" ");
          return (
            <g
              key={s.def.key}
              opacity={dim ? 0.28 : 1}
              onMouseEnter={() => setFocus(s.def.key)}
              onMouseLeave={() => setFocus(null)}
            >
              <path
                d={d}
                fill="none"
                stroke={s.def.color}
                strokeWidth={focus === s.def.key ? 3.5 : 2.5}
                strokeLinejoin="round"
              />
              {hiIdx != null && (
                <circle
                  cx={x(hiIdx)}
                  cy={y(s.pts[hiIdx])}
                  r={4}
                  fill={s.def.color}
                  stroke={pal.hoverDot}
                  strokeWidth={1.2}
                  pointerEvents="none"
                />
              )}
              <text
                x={x(s.pts.length - 1) + 6}
                y={y(s.end) + 3}
                fontSize={10}
                fontWeight={700}
                fill={s.def.color}
              >
                {s.end}
              </text>
            </g>
          );
        })}
        <line
          x1={m.left}
          x2={W - m.right}
          y1={m.top + plotH}
          y2={m.top + plotH}
          stroke={pal.baseline}
          strokeWidth={1.5}
        />
      </svg>
      <TooltipLayer tip={tip} pal={pal} containerRef={ref} />
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* 3. Distribution donut (interactive)                                     */
/* ----------------------------------------------------------------------- */

function DistributionDonut({
  totals,
  visible,
  pal,
  focus,
  setFocus,
}: HiProps & {
  totals: Record<ActionKey, number>;
  visible: ActionDef[];
  pal: ChartPalette;
}) {
  const { ref, tip, show, hide } = useTooltip();
  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const r = 78;
  const sw = 26;
  const C = 2 * Math.PI * r;

  const grand = visible.reduce((s, a) => s + totals[a.key], 0);
  let acc = 0;
  const segs = visible.map((a) => {
    const v = totals[a.key];
    const frac = grand > 0 ? v / grand : 0;
    const dash = frac * C;
    const seg = { def: a, v, frac, dash, offset: acc };
    acc += dash;
    return seg;
  });

  return (
    <div
      ref={ref}
      className="relative flex flex-col items-center justify-center gap-6 sm:flex-row sm:items-center sm:gap-12"
    >
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="w-52 shrink-0"
        role="img"
        onMouseLeave={hide}
      >
        <g transform={`rotate(-90 ${cx} ${cy})`}>
          {segs.map((s) => {
            const dim = focus != null && focus !== s.def.key;
            return (
              <circle
                key={s.def.key}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={s.def.color}
                strokeWidth={focus === s.def.key ? sw + 6 : sw}
                strokeOpacity={dim ? 0.3 : 1}
                strokeDasharray={`${s.dash.toFixed(2)} ${(C - s.dash).toFixed(2)}`}
                strokeDashoffset={(-s.offset).toFixed(2)}
                onMouseMove={(e) => {
                  setFocus(s.def.key);
                  show(
                    e,
                    <div className="font-mono">
                      <span
                        className="font-semibold"
                        style={{ color: s.def.color }}
                      >
                        {s.def.emoji} {s.def.label}
                      </span>
                      <div
                        className="mt-0.5"
                        style={{ color: pal.hoverTooltipText }}
                      >
                        {s.v} azioni · {(s.frac * 100).toFixed(1)}%
                      </div>
                    </div>,
                  );
                }}
                onMouseLeave={() => setFocus(null)}
                style={{ cursor: "pointer" }}
              />
            );
          })}
        </g>
        <text
          x={cx}
          y={cy - 2}
          textAnchor="middle"
          fontSize={24}
          fontWeight={800}
          fill={pal.figText}
        >
          {grand.toLocaleString("it-IT")}
        </text>
        <text
          x={cx}
          y={cy + 16}
          textAnchor="middle"
          fontSize={11}
          fill={pal.legendLabel}
        >
          azioni
        </text>
      </svg>
      <ul className="w-full max-w-md space-y-2 text-sm sm:w-auto sm:min-w-[320px]">
        {segs.map((s) => (
          <li
            key={s.def.key}
            className="flex items-center justify-between gap-2 rounded px-1 transition"
            style={{
              backgroundColor:
                focus === s.def.key ? s.def.color + "22" : "transparent",
            }}
            onMouseEnter={() => setFocus(s.def.key)}
            onMouseLeave={() => setFocus(null)}
          >
            <span className="inline-flex items-center gap-2 whitespace-nowrap">
              <Swatch color={s.def.color} />
              {s.def.emoji} {s.def.short}
            </span>
            <span
              className="whitespace-nowrap font-mono tabular-nums"
              style={{ color: pal.figText }}
            >
              {s.v} · {(s.frac * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
      <TooltipLayer tip={tip} pal={pal} containerRef={ref} />
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* 4. Per-window small multiples (interactive horizontal bars)             */
/* ----------------------------------------------------------------------- */

function PerWindowSmallMultiples({
  buckets,
  visible,
  pal,
  accent,
  focus,
  setFocus,
}: HiProps & {
  buckets: WindowBucket[];
  visible: ActionDef[];
  pal: ChartPalette;
  accent: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {buckets.map((b) => {
        const maxInWin = Math.max(1, ...visible.map((a) => b.counts[a.key]));
        const visTotal = visible.reduce((s, a) => s + b.counts[a.key], 0);
        return (
          <div
            key={b.win.window_number}
            className="rounded-lg border p-3"
            style={{
              borderColor: pal.figBorder,
              backgroundColor: pal.legendBg,
            }}
          >
            <div className="mb-2 flex items-baseline justify-between">
              <span
                className="text-sm font-semibold"
                style={{ color: pal.figText }}
              >
                Finestra #{b.win.window_number}
              </span>
              <span
                className="font-mono text-xs"
                style={{ color: pal.legendLabel }}
              >
                {hm(b.win.started_at)} → {hm(b.win.ended_at)}
              </span>
            </div>
            <div className="space-y-1">
              {visible.map((a) => {
                const c = b.counts[a.key];
                const pct = (c / maxInWin) * 100;
                const dim = focus != null && focus !== a.key;
                return (
                  <div
                    key={a.key}
                    className="flex items-center gap-2 rounded transition"
                    style={{
                      opacity: dim ? 0.3 : 1,
                      backgroundColor:
                        focus === a.key ? a.color + "1a" : "transparent",
                    }}
                    onMouseEnter={() => setFocus(a.key)}
                    onMouseLeave={() => setFocus(null)}
                    title={`${a.label}: ${c}${visTotal ? ` (${((c / visTotal) * 100).toFixed(0)}% della finestra)` : ""}`}
                  >
                    <span
                      className="w-24 shrink-0 truncate text-xs"
                      style={{ color: pal.legendText }}
                    >
                      {a.emoji} {a.short}
                    </span>
                    <div
                      className="relative h-3.5 flex-1 overflow-hidden rounded-sm"
                      style={{ backgroundColor: pal.bandB }}
                    >
                      <div
                        className="h-full rounded-sm transition-all"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: a.color,
                          opacity: c === 0 ? 0 : 1,
                        }}
                      />
                    </div>
                    <span
                      className="w-7 shrink-0 text-right font-mono text-xs tabular-nums"
                      style={{ color: c === 0 ? pal.legendLabel : pal.figText }}
                    >
                      {c}
                    </span>
                  </div>
                );
              })}
            </div>
            <div
              className="mt-2 flex items-center justify-between border-t pt-2 text-xs"
              style={{ borderColor: pal.headerBorder }}
            >
              <span style={{ color: pal.legendLabel }}>Totale azioni</span>
              <span
                className="font-mono font-bold tabular-nums"
                style={{ color: accent }}
              >
                {visTotal}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
