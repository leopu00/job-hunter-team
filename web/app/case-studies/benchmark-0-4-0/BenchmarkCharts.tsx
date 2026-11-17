"use client";

// The charts of the benchmark page: every round over time, the rounds compared, the Scout bench, the builds and the agents.
// Plain SVG and HTML, no chart library: the colours come from the page's theme variables, every number is in a tooltip.
// The series live in web/data/benchmark/benchmark-0-4-0.json; a chart whose data is not there yet says so instead of guessing.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Locale } from "@/i18n/config";
import { CHART_COPY, type ChartCopy } from "./chartsCopy";

// ---- data shapes (all optional in the JSON: the page grows as the rounds are read) ----

export type TimelinePoint = {
  m: number; // minutes from the start of the round
  cost?: number | null; // cumulative spend in $
  found?: number | null; // positions inserted so far
  scored?: number | null; // positions with a score so far
  relevant?: number | null; // pertinent positions so far
  best?: number | null; // best score so far
  median?: number | null; // median score so far
};

export type ChartRound = {
  id: string;
  label: string; // "Linux · Bricklayer · 16/11"
  group: "round" | "bench";
  os: string;
  service: string;
  buildNo: number | null;
  minutes: number | null;
  cost: number | null;
  found: number | null;
  scored: number | null;
  relevant: number | null;
  bestScore: number | null;
  ceiling: number | null; // the spending ceiling set for the round, $
  brake: { m: number; kind: string }[]; // brake and stop events, minutes from the start
  timeline: TimelinePoint[];
  scores: { m: number; best: number }[]; // best score so far, from the positions with a score and a time
  agents: Record<string, number> | null; // $ per agent role
};

export type BenchProfile = {
  id: string;
  label: string;
  relevance: { P?: number; A?: number; X?: number } | null;
  discarded: Record<string, number> | null; // role, area, duplicate, …
  bySource: Record<string, number> | null;
};

export type BuildPoint = {
  n: number;
  targets: Record<string, number> | null; // pass / fail / pending / blocked
  defects: { found: number; closed: number } | null;
  fromCurrent: boolean; // targets counted from the current table, not from a snapshot taken at that build
};

export type ChartsProps = {
  locale: Locale;
  rounds: ChartRound[];
  bench: BenchProfile[];
  builds: BuildPoint[];
  labels: {
    services: Record<string, string>;
    os: Record<string, string>;
    targetStatus: Record<string, string>;
  };
};

// ---- colours: theme variables, so light and dark both read ----

const C = {
  cost: "var(--color-orange)",
  found: "var(--color-blue)",
  scored: "var(--color-purple)",
  relevant: "var(--color-green)",
  best: "var(--color-yellow)",
  median: "var(--color-base)",
  ceiling: "var(--color-red)",
  brake: "var(--color-red)",
};
const SERVICE_COLOR: Record<string, string> = {
  claude: "#D97757",
  openai: "#10A37F",
  glm: "#4D6BFE",
  kimi: "#8B5CF6",
  "openai-glm": "#0EA5A4",
};
const OS_COLOR: Record<string, string> = {
  linux: "#F59E0B",
  macos: "#94A3B8",
  windows: "#3B82F6",
};
const STATUS_COLOR: Record<string, string> = {
  pass: "#22C55E",
  fail: "#EF4444",
  pending: "#F59E0B",
  blocked: "#A855F7",
};
const REL_COLOR: Record<string, string> = { P: "#22C55E", A: "#F59E0B", X: "#EF4444" };
const PALETTE = ["#4D9FFF", "#FF8C42", "#A855F7", "#22C55E", "#F5C518", "#EF4444", "#0EA5A4", "#EC4899", "#94A3B8"];
const AGENT_COLOR: Record<string, string> = {
  captain: "#F59E0B",
  scout: "#4D9FFF",
  analyst: "#A855F7",
  scorer: "#22C55E",
  writer: "#EC4899",
  critic: "#EF4444",
  sentinel: "#94A3B8",
  assistant: "#0EA5A4",
  doctor: "#FF8C42",
  maintainer: "#84CC16",
  mentor: "#F5C518",
};
const colorOf = (key: string, i: number, map?: Record<string, string>) => map?.[key] ?? PALETTE[i % PALETTE.length];

// ---- small building blocks ----

function Panel({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] p-4 sm:p-5 space-y-3 min-w-0">
      <div className="space-y-1">
        <h3 className="text-[13px] font-bold">{title}</h3>
        {lead && <p className="text-[11px] text-[var(--color-muted)]">{lead}</p>}
      </div>
      {children}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--color-muted)]">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block w-4"
            style={{ borderTop: `${it.dashed ? "2px dashed" : "3px solid"} ${it.color}` }}
          />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

function Chips<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
            o.value === value
              ? "border-[var(--color-blue)] bg-[color-mix(in_srgb,var(--color-blue)_18%,transparent)] text-[var(--color-white)] font-semibold"
              : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-white)]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Missing({ text }: { text: string }) {
  return (
    <p className="text-[12px] text-[var(--color-muted)] border border-dashed border-[var(--color-border)] px-3 py-6 text-center">
      {text}
    </p>
  );
}

function Tip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  // Kept inside the chart box: flips to the left of the pointer on the right half.
  const left = x > width / 2;
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 rounded border border-[var(--color-border-glow)] bg-[var(--color-deep)] px-2.5 py-1.5 text-[11px] shadow-lg tabular-nums whitespace-nowrap"
      style={{
        top: Math.max(0, y - 8),
        left: left ? undefined : x + 12,
        right: left ? width - x + 12 : undefined,
      }}
    >
      {children}
    </div>
  );
}

const niceMax = (v: number) => {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
};
const ticks = (max: number, n?: number) => {
  const k = n ?? (Number.isInteger(max / 4) ? 4 : 5);
  return Array.from({ length: k + 1 }, (_, i) => (max / k) * i);
};

// ---- line chart over minutes ----

type LineSeries = { key: string; label: string; color: string; points: { x: number; y: number }[]; dashed?: boolean };

function LineChart({
  series,
  xMax,
  yFormat,
  xLabel,
  refY,
  refX,
  height = 220,
  yMaxHint = 0,
}: {
  series: LineSeries[];
  xMax: number;
  yFormat: (v: number) => string;
  xLabel: string;
  refY?: { y: number; label: string; color: string } | null;
  refX?: { x: number; label: string; color: string }[];
  height?: number;
  yMaxHint?: number;
}) {
  // Drawn at the real width of the box, so the text stays 11 px on a phone too.
  const ref = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = W < 420 ? Math.round(height * 0.9) : height;
  const pad = { l: 52, r: 14, t: 12, b: 30 };
  const [hover, setHover] = useState<{ x: number; px: number; py: number; w: number } | null>(null);
  const all = series.flatMap((s) => s.points.map((p) => p.y));
  const yMax = niceMax(Math.max(yMaxHint, refY?.y ?? 0, ...all, 0) * 1.05);
  const xM = Math.max(5, Math.ceil(xMax / 5) * 5);
  const sx = (x: number) => pad.l + (x / xM) * (W - pad.l - pad.r);
  const sy = (y: number) => H - pad.b - (y / yMax) * (H - pad.t - pad.b);
  const xs = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.x)))).sort((a, b) => a - b);

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || xs.length === 0) return;
    const rel = ((e.clientX - box.left) / box.width) * W;
    const xv = ((rel - pad.l) / (W - pad.l - pad.r)) * xM;
    let best = xs[0];
    for (const x of xs) if (Math.abs(x - xv) < Math.abs(best - xv)) best = x;
    setHover({ x: best, px: (sx(best) / W) * box.width, py: e.clientY - box.top, w: box.width });
  };
  const valueAt = (s: LineSeries, x: number) => {
    // last known value at or before x (the series are cumulative)
    let v: number | null = null;
    for (const p of s.points) if (p.x <= x) v = p.y;
    return v;
  };

  return (
    <div
      ref={ref}
      className="relative select-none touch-pan-y"
      onPointerMove={onMove}
      onPointerDown={onMove}
      onPointerLeave={() => setHover(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" role="img" aria-label={series.map((s) => s.label).join(", ")}>
        {ticks(yMax).map((v) => (
          <g key={`y${v}`}>
            <line x1={pad.l} x2={W - pad.r} y1={sy(v)} y2={sy(v)} stroke="var(--color-border)" strokeWidth={1} />
            <text x={pad.l - 6} y={sy(v) + 4} textAnchor="end" fontSize={11} fill="var(--color-muted)">
              {yFormat(v)}
            </text>
          </g>
        ))}
        {ticks(xM, xM / 5 <= (W < 420 ? 6 : 8) ? xM / 5 : xM % 10 === 0 && xM / 10 <= 8 ? xM / 10 : W < 420 ? 4 : 6).map((v) => (
          <text key={`x${v}`} x={sx(v)} y={H - pad.b + 16} textAnchor="middle" fontSize={11} fill="var(--color-muted)">
            {Math.round(v)}
          </text>
        ))}
        <text x={W - pad.r} y={H - 2} textAnchor="end" fontSize={10} fill="var(--color-dim)">
          {xLabel}
        </text>
        {refY && (
          <g>
            <line x1={pad.l} x2={W - pad.r} y1={sy(refY.y)} y2={sy(refY.y)} stroke={refY.color} strokeWidth={1.5} strokeDasharray="6 4" />
            <text x={W - pad.r} y={sy(refY.y) - 4} textAnchor="end" fontSize={11} fill={refY.color}>
              {refY.label}
            </text>
          </g>
        )}
        {(refX ?? []).map((m, i) => (
          <g key={`b${i}`}>
            <line x1={sx(m.x)} x2={sx(m.x)} y1={pad.t} y2={H - pad.b} stroke={m.color} strokeWidth={1.5} strokeDasharray="3 3" />
            <circle cx={sx(m.x)} cy={pad.t + 7 + (i % 2) * 15} r={7} fill={m.color} />
            <text x={sx(m.x)} y={pad.t + 11 + (i % 2) * 15} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--color-card)">
              {i + 1}
            </text>
          </g>
        ))}
        {series.map((s) => (
          <g key={s.key}>
            <polyline
              fill="none"
              stroke={s.color}
              strokeWidth={2.25}
              strokeDasharray={s.dashed ? "5 4" : undefined}
              strokeLinejoin="round"
              points={s.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ")}
            />
            {s.points.length <= 40 &&
              s.points.map((p) => <circle key={p.x} cx={sx(p.x)} cy={sy(p.y)} r={2.6} fill={s.color} />)}
          </g>
        ))}
        {hover && (
          <line x1={sx(hover.x)} x2={sx(hover.x)} y1={pad.t} y2={H - pad.b} stroke="var(--color-dim)" strokeWidth={1} />
        )}
      </svg>
      {hover && (
        <Tip x={hover.px} y={hover.py} width={hover.w}>
          <div className="font-semibold mb-0.5">{`${hover.x} min`}</div>
          {(refX ?? [])
            .map((m, i) => ({ ...m, i }))
            .filter((m) => m.x <= hover.x)
            .slice(-1)
            .map((m) => (
              <div key="ev" style={{ color: m.color }}>{`${m.i + 1} · ${m.label}`}</div>
            ))}
          {series.map((s) => {
            const v = valueAt(s, hover.x);
            return (
              <div key={s.key} className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: s.color }} />
                <span className="text-[var(--color-muted)]">{s.label}</span>
                <span className="ml-auto pl-3 font-semibold">{v == null ? "—" : yFormat(v)}</span>
              </div>
            );
          })}
        </Tip>
      )}
    </div>
  );
}

// ---- horizontal bars (stacked or single), HTML so they wrap well on a phone ----

type BarRow = { key: string; label: ReactNode; segments: { key: string; label: string; value: number; color: string }[]; note?: string };

function HBars({
  rows,
  format,
  emptyLabel,
  stacked = true,
  compact = false,
}: {
  rows: BarRow[];
  format: (v: number) => string;
  emptyLabel: string;
  stacked?: boolean;
  compact?: boolean; // label and number above the bar: for the narrow panels
}) {
  const [tip, setTip] = useState<{ row: string; x: number; y: number; w: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const totals = rows.map((r) => r.segments.reduce((a, s) => a + s.value, 0));
  const max = Math.max(...(stacked ? totals : rows.flatMap((r) => r.segments.map((s) => s.value))), 0) || 1;
  const show = (row: string, e: React.PointerEvent) => {
    const box = ref.current?.getBoundingClientRect();
    if (box) setTip({ row, x: e.clientX - box.left, y: e.clientY - box.top, w: box.width });
  };
  const tipRow = rows.find((r) => r.key === tip?.row);
  return (
    <div ref={ref} className="relative space-y-2" onPointerLeave={() => setTip(null)}>
      {rows.map((r, i) => {
        const total = totals[i];
        const has = r.segments.some((s) => s.value > 0);
        const value = has ? format(stacked ? total : r.segments[0]?.value ?? 0) : "—";
        const bar = (
          <div className={`min-w-0 ${stacked ? "flex h-4" : "space-y-0.5"}`}>
            {has ? (
              r.segments.map((s) =>
                stacked ? (
                  <span
                    key={s.key}
                    className="block h-full first:rounded-l-sm last:rounded-r-sm"
                    style={{ width: `${(s.value / max) * 100}%`, background: s.color }}
                  />
                ) : (
                  <span
                    key={s.key}
                    className="block h-2.5 rounded-r-sm"
                    style={{ width: `${(s.value / max) * 100}%`, background: s.color, minWidth: s.value > 0 ? 2 : 0 }}
                  />
                ),
              )
            ) : (
              <span className="text-[11px] text-[var(--color-dim)]">{emptyLabel}</span>
            )}
          </div>
        );
        if (compact)
          return (
            <div key={r.key} className="space-y-1 text-[12px]" onPointerMove={(e) => show(r.key, e)} onPointerDown={(e) => show(r.key, e)}>
              <div className="flex justify-between gap-2">
                <span className="truncate">{r.label}</span>
                <span className="tabular-nums font-semibold">{value}</span>
              </div>
              {bar}
            </div>
          );
        return (
          <div
            key={r.key}
            className="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[minmax(160px,280px)_1fr_auto] items-center gap-x-3 gap-y-1 text-[12px]"
            onPointerMove={(e) => show(r.key, e)}
            onPointerDown={(e) => show(r.key, e)}
          >
            <span className="truncate">{r.label}</span>
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex-1 min-w-0">{bar}</div>
              <span className="sm:hidden tabular-nums font-semibold">{has ? value : ""}</span>
            </div>
            <span className="hidden sm:block text-right tabular-nums font-semibold min-w-[64px]">
              {value}
            </span>
          </div>
        );
      })}
      {tip && tipRow && tipRow.segments.some((s) => s.value > 0) && (
        <Tip x={tip.x} y={tip.y} width={tip.w}>
          <div className="font-semibold mb-0.5">{tipRow.label}</div>
          {tipRow.segments.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: s.color }} />
              <span className="text-[var(--color-muted)]">{s.label}</span>
              <span className="ml-auto pl-3 font-semibold">{format(s.value)}</span>
            </div>
          ))}
          {tipRow.note && <div className="text-[var(--color-dim)] mt-0.5">{tipRow.note}</div>}
        </Tip>
      )}
    </div>
  );
}

// ---- the sections ----

function RoundTimelines({ rounds, t, money }: { rounds: ChartRound[]; t: ChartCopy; money: (v: number) => string }) {
  const usable = rounds.filter((r) => r.minutes != null || r.timeline.length > 0);
  // Opens on the latest round that has a real minute-by-minute series.
  const withSeries = usable.filter((x) => x.group === "round" && x.timeline.length >= 2);
  const [sel, setSel] = useState(withSeries[withSeries.length - 1]?.id ?? usable[0]?.id ?? "");
  const r = usable.find((x) => x.id === sel) ?? usable[0];
  if (!r) return <Missing text={t.noData} />;
  const real = r.timeline.length >= 2;
  const xMax = Math.max(r.minutes ?? 0, ...r.timeline.map((p) => p.m), ...r.brake.map((b) => b.m), 1);
  const pick = (k: keyof TimelinePoint) =>
    r.timeline.filter((p) => p[k] != null).map((p) => ({ x: p.m, y: p[k] as number }));
  // Without a timeline only the two ends are known: drawn dashed and called an average pace, never a curve.
  const ends = (v: number | null) =>
    v == null || r.minutes == null ? [] : [{ x: 0, y: 0 }, { x: r.minutes, y: v }];
  const costS: LineSeries[] = real
    ? [{ key: "cost", label: t.spend, color: C.cost, points: pick("cost") }]
    : [{ key: "cost", label: t.avgPace, color: C.cost, points: ends(r.cost), dashed: true }];
  const posS: LineSeries[] = real
    ? [
        { key: "found", label: t.found, color: C.found, points: pick("found") },
        { key: "scored", label: t.scored, color: C.scored, points: pick("scored") },
        { key: "relevant", label: t.relevant, color: C.relevant, points: pick("relevant") },
      ].filter((s) => s.points.length > 0)
    : [
        { key: "found", label: t.found, color: C.found, points: ends(r.found), dashed: true },
        { key: "scored", label: t.scored, color: C.scored, points: ends(r.scored), dashed: true },
        { key: "relevant", label: t.relevant, color: C.relevant, points: ends(r.relevant), dashed: true },
      ].filter((s) => s.points.length > 0);
  const scoreS: LineSeries[] = [
    { key: "best", label: t.bestScore, color: C.best, points: r.scores.length ? r.scores.map((p) => ({ x: p.m, y: p.best })) : pick("best") },
    { key: "median", label: t.medianScore, color: C.median, points: pick("median") },
  ].filter((s) => s.points.length > 0);
  const refY = r.ceiling != null ? { y: r.ceiling, label: `${t.ceiling} ${money(r.ceiling)}`, color: C.ceiling } : null;
  const refX = r.brake.map((b) => ({
    x: b.m,
    label: t.brakeKinds[b.kind] ?? b.kind,
    color: b.kind.startsWith("resume") ? "var(--color-green)" : C.brake,
  }));
  const groups: { id: string; label: string; items: ChartRound[] }[] = [
    { id: "round", label: t.rounds, items: usable.filter((x) => x.group === "round") },
    { id: "bench", label: t.benchRounds, items: usable.filter((x) => x.group === "bench") },
  ].filter((g) => g.items.length > 0);
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.id} className="space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-[var(--color-dim)]">{g.label}</div>
          <Chips
            label={g.label}
            value={sel}
            onChange={setSel}
            options={g.items.map((x) => ({ value: x.id, label: `${x.group === "round" ? `${x.id} · ` : ""}${x.label}${x.timeline.length >= 2 ? " ◆" : ""}` }))}
          />
        </div>
      ))}
      <p className="text-[10px] text-[var(--color-dim)]">{t.seriesMark}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] tabular-nums">
        <span className="font-semibold">{r.label}</span>
        <span>{`${t.minutes}: ${r.minutes ?? "—"}`}</span>
        <span>{`${t.spend}: ${r.cost == null ? "—" : money(r.cost)}`}</span>
        <span>{`${t.found}/${t.scored}/${t.relevant}: ${r.found ?? "—"}/${r.scored ?? "—"}/${r.relevant ?? "—"}`}</span>
        <span>{`${t.bestScore}: ${r.bestScore ?? "—"}`}</span>
      </div>
      {!real && <p className="text-[11px] text-[var(--color-yellow)]">{t.onlyTotals}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t.spendOverTime}>
          <Legend
            items={[
              ...costS.map((s) => ({ label: s.label, color: s.color, dashed: s.dashed })),
              ...(refY ? [{ label: t.ceiling, color: C.ceiling, dashed: true }] : []),
              ...(refX.length ? [{ label: t.brake, color: C.brake, dashed: true }] : []),
            ]}
          />
          {costS[0].points.length > 0 ? (
            <LineChart series={costS} xMax={xMax} yFormat={money} xLabel={t.minutesAxis} refY={refY} refX={refX} />
          ) : (
            <Missing text={t.noData} />
          )}
          {r.ceiling == null && <p className="text-[11px] text-[var(--color-dim)]">{t.noCeiling}</p>}
          {refX.length > 0 && (
            <ol className="text-[11px] text-[var(--color-muted)] space-y-0.5 tabular-nums">
              {refX.map((m, i) => (
                <li key={i} className="flex gap-2">
                  <span className="font-bold" style={{ color: m.color }}>{i + 1}</span>
                  <span>{`${m.x.toFixed(1)} min`}</span>
                  <span>{m.label}</span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
        <Panel title={t.positionsOverTime}>
          <Legend items={posS.map((s) => ({ label: s.label, color: s.color, dashed: s.dashed }))} />
          {posS.length > 0 ? (
            <LineChart series={posS} xMax={xMax} yFormat={(v) => String(Math.round(v))} xLabel={t.minutesAxis} refX={refX} />
          ) : (
            <Missing text={t.noData} />
          )}
        </Panel>
        <Panel title={t.scoresOverTime}>
          <Legend items={scoreS.map((s) => ({ label: s.label, color: s.color }))} />
          {scoreS.length > 0 ? (
            <LineChart series={scoreS} xMax={xMax} yFormat={(v) => String(Math.round(v))} xLabel={t.minutesAxis} yMaxHint={100} refX={refX} />
          ) : (
            <Missing text={r.bestScore != null ? `${t.scoresOnlyFinal} ${r.bestScore}.` : t.noData} />
          )}
        </Panel>
        <Panel title={t.ratePerMinute}>
          {r.cost != null && r.minutes ? (
            <HBars
              format={money}
              emptyLabel={t.noData}
              stacked={false}
              rows={[
                {
                  key: "rate",
                  label: t.dollarsPerMinute,
                  segments: [{ key: "rate", label: t.dollarsPerMinute, value: r.cost / r.minutes, color: C.cost }],
                },
              ]}
            />
          ) : (
            <Missing text={t.noData} />
          )}
          <p className="text-[11px] text-[var(--color-dim)]">{t.rateHint}</p>
        </Panel>
      </div>
    </div>
  );
}

type Metric = "perFound" | "perRelevant" | "perHour" | "perMinute";
type GroupBy = "round" | "service" | "os" | "build";

function Comparison({ rounds, t, money, labels }: { rounds: ChartRound[]; t: ChartCopy; money: (v: number) => string; labels: ChartsProps["labels"] }) {
  const [metric, setMetric] = useState<Metric>("perFound");
  const [by, setBy] = useState<GroupBy>("round");
  const metricOf = (cost: number, minutes: number, found: number, relevant: number): number | null => {
    if (metric === "perFound") return found > 0 ? cost / found : null;
    if (metric === "perRelevant") return relevant > 0 ? cost / relevant : null;
    if (metric === "perHour") return minutes > 0 ? (found / minutes) * 60 : null;
    return minutes > 0 ? cost / minutes : null;
  };
  const fmt = metric === "perHour" ? (v: number) => v.toFixed(1) : money;
  const rows: BarRow[] = useMemo(() => {
    const valid = rounds.filter((r) => r.cost != null && r.minutes != null && r.found != null);
    if (by === "round") {
      return valid.map((r) => {
        const v = metricOf(r.cost!, r.minutes!, r.found!, r.relevant ?? 0);
        return {
          key: r.id,
          label: r.group === "round" ? `${r.id} · ${r.label}` : `${t.bench} · ${r.label}`,
          note: `${labels.services[r.service] ?? r.service} · ${money(r.cost!)} · ${r.minutes} min · ${r.found}/${r.relevant ?? "—"}`,
          segments: [{ key: "v", label: t.metrics[metric], value: v ?? 0, color: SERVICE_COLOR[r.service] ?? C.found }],
        };
      });
    }
    const keyOf = (r: ChartRound) => (by === "service" ? r.service : by === "os" ? r.os : r.buildNo == null ? "?" : String(r.buildNo));
    const groups = new Map<string, ChartRound[]>();
    for (const r of valid) groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), r]);
    const ordered = Array.from(groups.entries()).sort(([a], [b]) => (by === "build" ? Number(a) - Number(b) : a.localeCompare(b)));
    return ordered.map(([k, list], i) => {
      // Pooled: total spend over total positions, so a long round weighs more than a short one.
      const sum = (f: (r: ChartRound) => number) => list.reduce((a, r) => a + f(r), 0);
      const v = metricOf(sum((r) => r.cost!), sum((r) => r.minutes!), sum((r) => r.found!), sum((r) => r.relevant ?? 0));
      const name =
        by === "service" ? labels.services[k] ?? k : by === "os" ? labels.os[k] ?? k : k === "?" ? t.buildUnknown : `${t.build} ${k}`;
      const color = by === "service" ? SERVICE_COLOR[k] : by === "os" ? OS_COLOR[k] : PALETTE[i % PALETTE.length];
      return {
        key: k,
        label: name,
        note: `${list.length} ${t.roundsCount}: ${list.map((r) => r.id).join(", ")}`,
        segments: [{ key: "v", label: t.metrics[metric], value: v ?? 0, color: color ?? C.found }],
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rounds, metric, by]);
  return (
    <div className="space-y-3">
      <Chips label={t.metric} value={metric} onChange={setMetric} options={(Object.keys(t.metrics) as Metric[]).map((m) => ({ value: m, label: t.metrics[m] }))} />
      <Chips
        label={t.groupBy}
        value={by}
        onChange={setBy}
        options={(["round", "service", "os", "build"] as GroupBy[]).map((g) => ({ value: g, label: t.groups[g] }))}
      />
      {by === "round" && (
        <Legend
          items={Array.from(new Set(rounds.map((r) => r.service))).map((s) => ({ label: labels.services[s] ?? s, color: SERVICE_COLOR[s] ?? C.found }))}
        />
      )}
      <HBars rows={rows} format={fmt} emptyLabel={t.notComputable} stacked={false} />
      <p className="text-[11px] text-[var(--color-dim)]">{t.comparisonHint}</p>
    </div>
  );
}

function Bench({ bench, t }: { bench: BenchProfile[]; t: ChartCopy }) {
  if (bench.length === 0) return <Missing text={t.benchMissing} />;
  const n = (v: number) => String(v);
  const keysOf = (pick: (b: BenchProfile) => Record<string, number> | null) =>
    Array.from(new Set(bench.flatMap((b) => Object.keys(pick(b) ?? {}))));
  const rowsFor = (pick: (b: BenchProfile) => Record<string, number> | null, names: Record<string, string>, colors?: Record<string, string>) => {
    const keys = keysOf(pick);
    return {
      keys,
      rows: bench.map((b) => ({
        key: b.id,
        label: b.label,
        segments: keys.map((k, i) => ({ key: k, label: names[k] ?? k, value: pick(b)?.[k] ?? 0, color: colorOf(k, i, colors) })),
      })),
    };
  };
  const rel = rowsFor((b) => (b.relevance as Record<string, number> | null) ?? null, t.relevance, REL_COLOR);
  const dis = rowsFor((b) => b.discarded, t.discardReasons);
  const src = rowsFor((b) => b.bySource, {});
  const legendOf = (keys: string[], names: Record<string, string>, colors?: Record<string, string>) =>
    keys.map((k, i) => ({ label: names[k] ?? k, color: colorOf(k, i, colors) }));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel title={t.benchRelevance} lead={t.benchRelevanceLead}>
        <Legend items={legendOf(rel.keys, t.relevance, REL_COLOR)} />
        <HBars rows={rel.rows} format={n} emptyLabel={t.noData} compact />
      </Panel>
      <Panel title={t.benchDiscarded}>
        <Legend items={legendOf(dis.keys, t.discardReasons)} />
        <HBars rows={dis.rows} format={n} emptyLabel={t.noData} compact />
      </Panel>
      <Panel title={t.benchSources}>
        <Legend items={legendOf(src.keys, {})} />
        <HBars rows={src.rows} format={n} emptyLabel={t.noData} compact />
      </Panel>
    </div>
  );
}

function Builds({ builds, t, labels }: { builds: BuildPoint[]; t: ChartCopy; labels: ChartsProps["labels"] }) {
  const statuses = ["pass", "fail", "blocked", "pending"];
  const tRows: BarRow[] = builds.map((b) => ({
    key: String(b.n),
    label: `${t.build} ${b.n}`,
    note: b.fromCurrent ? t.buildsFromCurrent : undefined,
    segments: statuses.map((s) => ({ key: s, label: labels.targetStatus[s] ?? s, value: b.targets?.[s] ?? 0, color: STATUS_COLOR[s] })),
  }));
  const dRows: BarRow[] = builds.map((b) => ({
    key: String(b.n),
    label: `${t.build} ${b.n}`,
    segments: [
      { key: "found", label: t.defectsFound, value: b.defects?.found ?? 0, color: "#EF4444" },
      { key: "closed", label: t.defectsClosed, value: b.defects?.closed ?? 0, color: "#22C55E" },
    ],
  }));
  const anyDefects = builds.some((b) => b.defects != null);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title={t.buildsTargets} lead={builds.some((b) => b.fromCurrent) ? t.buildsFromCurrent : undefined}>
        <Legend items={statuses.map((s) => ({ label: labels.targetStatus[s] ?? s, color: STATUS_COLOR[s] }))} />
        <HBars rows={tRows} format={(v) => String(v)} emptyLabel={t.noRoundOnBuild} compact />
      </Panel>
      <Panel title={t.buildsDefects}>
        {anyDefects ? (
          <>
            <Legend items={[{ label: t.defectsFound, color: "#EF4444" }, { label: t.defectsClosed, color: "#22C55E" }]} />
            <HBars rows={dRows} format={(v) => String(v)} emptyLabel={t.noData} stacked={false} compact />
          </>
        ) : (
          <Missing text={t.defectsMissing} />
        )}
      </Panel>
    </div>
  );
}

function Agents({ rounds, t, money }: { rounds: ChartRound[]; t: ChartCopy; money: (v: number) => string }) {
  const withAgents = rounds.filter((r) => r.agents && Object.keys(r.agents).length > 0);
  if (withAgents.length === 0) return <Missing text={t.agentsMissing} />;
  const keys = Array.from(new Set(withAgents.flatMap((r) => Object.keys(r.agents!))));
  const rows: BarRow[] = withAgents.map((r) => ({
    key: r.id,
    label: r.group === "round" ? `${r.id} · ${r.label}` : `${t.bench} · ${r.label}`,
    segments: keys.map((k, i) => ({ key: k, label: t.agents[k] ?? k, value: r.agents![k] ?? 0, color: colorOf(k, i, AGENT_COLOR) })),
  }));
  return (
    <div className="space-y-3">
      <Legend items={keys.map((k, i) => ({ label: t.agents[k] ?? k, color: colorOf(k, i, AGENT_COLOR) }))} />
      <HBars rows={rows} format={money} emptyLabel={t.noData} />
    </div>
  );
}

export default function BenchmarkCharts(props: ChartsProps) {
  const t = CHART_COPY[props.locale] ?? CHART_COPY.en;
  const nf = new Intl.NumberFormat(props.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (v: number) => `${nf.format(v)} $`;
  const all = [...props.rounds];
  return (
    <section className="space-y-6" id="charts">
      <div className="space-y-1">
        <h2 className="section-label">{t.title}</h2>
        <p className="text-[12px] text-[var(--color-muted)] max-w-3xl">{t.lead}</p>
      </div>
      <Panel title={`1 · ${t.s1}`} lead={t.s1Lead}>
        <RoundTimelines rounds={all} t={t} money={money} />
      </Panel>
      <Panel title={`2 · ${t.s2}`} lead={t.s2Lead}>
        <Comparison rounds={all} t={t} money={money} labels={props.labels} />
      </Panel>
      <Panel title={`3 · ${t.s3}`} lead={t.s3Lead}>
        <Bench bench={props.bench} t={t} />
      </Panel>
      <Panel title={`4 · ${t.s4}`}>
        <Builds builds={props.builds} t={t} labels={props.labels} />
      </Panel>
      <Panel title={`5 · ${t.s5}`} lead={t.s5Lead}>
        <Agents rounds={all} t={t} money={money} />
      </Panel>
    </section>
  );
}
