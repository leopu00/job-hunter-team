"use client";

// The charts of the benchmark page: every round over time, the rounds compared, the Scout bench, the builds and the agents.
// Plain SVG and HTML, no chart library: the colours come from the page's theme variables, every number is in a tooltip.
// The series live in web/data/benchmark/benchmark-0-4-0.json; a chart whose data is not there yet says so instead of guessing.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Locale } from "@/i18n/config";
import { CHART_COPY, type ChartCopy } from "./chartsCopy";
import { OsIcon } from "../../setup-guide/OsIcons";

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
  scorePoints: { m: number; s: number }[]; // every score with the minute it was given
  scoreValues: number[]; // every score of the round, for the distribution
  scoresMissing?: string | null; // why there are none: dbGone, checking
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
  defects: { found: number | null; closed: number | null } | null;
  fromCurrent: boolean; // targets counted from the current table, not from a snapshot taken at that build
};

export type BetaDay = {
  day: string;
  hours: { h: number; positions: number | null; atLeast70: number | null }[];
  codex: { t: number; usedPct: number }[]; // t = hour of the day, decimal
  experiments: { t: number; label: string }[];
} | null;

export type ChartsProps = {
  locale: Locale;
  rounds: ChartRound[];
  bench: BenchProfile[];
  builds: BuildPoint[];
  beta: BetaDay;
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
const REL_COLOR: Record<string, string> = {
  P: "#22C55E",
  A: "#F59E0B",
  X: "#EF4444",
};
const PALETTE = [
  "#4D9FFF",
  "#FF8C42",
  "#A855F7",
  "#22C55E",
  "#F5C518",
  "#EF4444",
  "#0EA5A4",
  "#EC4899",
  "#94A3B8",
];
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
// Events that stop or hold the team are red, those that let it work again green, the rest (setup, start, notices) blue.
const EVENT_STOP = new Set([
  "pace",
  "dailyHalt",
  "periodHalt",
  "periodOver",
  "periodEnd",
  "benchStop",
  "stop",
  "ceiling",
  "diskLow",
  "machineStopped",
  "creditGone",
  "creditExhausted",
  "inputHeld",
  "pause",
  "teamIdle",
]);
const EVENT_GO = new Set([
  "resume",
  "resumeScouts",
  "cleared",
  "restart",
  "switch",
  "teamStart",
  "ready",
  "goalReached",
  "queueStart",
  "scoutStart",
  "setupClosed",
  "teamRestart",
  "newPeriod",
]);
const OS_NAME: Record<string, string> = {
  windows: "Windows",
  linux: "Linux",
  macos: "macOS",
};
const colorOf = (key: string, i: number, map?: Record<string, string>) =>
  map?.[key] ?? PALETTE[i % PALETTE.length];

// ---- small building blocks ----

function Panel({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] p-4 sm:p-5 space-y-3 min-w-0">
      <div className="space-y-1">
        <h3 className="text-[13px] font-bold">{title}</h3>
        {lead && (
          <p className="text-[11px] text-[var(--color-muted)]">{lead}</p>
        )}
      </div>
      {children}
    </div>
  );
}

function Legend({
  items,
}: {
  items: { label: string; color: string; dashed?: boolean }[];
}) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--color-muted)]">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block w-4"
            style={{
              borderTop: `${it.dashed ? "2px dashed" : "3px solid"} ${it.color}`,
            }}
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
    <div
      role="radiogroup"
      aria-label={label}
      className="flex flex-wrap gap-1.5"
    >
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

function Tip({
  x,
  y,
  width,
  children,
}: {
  x: number;
  y: number;
  width: number;
  children: ReactNode;
}) {
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

type LineSeries = {
  key: string;
  label: string;
  color: string;
  points: { x: number; y: number }[];
  dashed?: boolean;
  dots?: boolean;
};

function LineChart({
  series,
  xMax,
  yFormat,
  xLabel,
  refY,
  refX,
  height = 220,
  yMaxHint = 0,
  xFormat = (v: number) => `${v} min`,
  xTick = (v: number) => String(Math.round(v)),
  xStep,
  band = null,
}: {
  series: LineSeries[];
  xMax: number;
  yFormat: (v: number) => string;
  xLabel: string;
  refY?: { y: number; label: string; color: string } | null;
  refX?: { x: number; label: string; color: string }[];
  height?: number;
  yMaxHint?: number;
  xFormat?: (v: number) => string;
  xTick?: (v: number) => string;
  xStep?: number;
  band?: { from: number; to: number; label: string } | null;
}) {
  // Drawn at the real width of the box, so the text stays 11 px on a phone too.
  const ref = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) =>
      setW(Math.max(280, Math.round(e.contentRect.width))),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = W < 420 ? Math.round(height * 0.9) : height;
  const pad = { l: 52, r: 14, t: 12, b: 30 };
  const [hover, setHover] = useState<{
    x: number;
    px: number;
    py: number;
    w: number;
  } | null>(null);
  const all = series.flatMap((s) => s.points.map((p) => p.y));
  const yMax = niceMax(
    Math.max(yMaxHint, (refY?.y ?? 0) * 1.05, ...all.map((v) => v * 1.05), 0),
  );
  // A round step (1, 2, 5, 10, 15, 20, 30, 60 minutes) with at most 8 ticks, 6 on a phone.
  const maxTicks = W < 420 ? 6 : 8;
  const step =
    xStep ??
    [1, 2, 5, 10, 15, 20, 30, 60, 120].find(
      (st) => Math.ceil(xMax / st) <= maxTicks,
    ) ??
    240;
  const xM = Math.max(step, Math.ceil(xMax / step) * step);
  const sx = (x: number) => pad.l + (x / xM) * (W - pad.l - pad.r);
  const sy = (y: number) => H - pad.b - (y / yMax) * (H - pad.t - pad.b);
  const xs = Array.from(
    new Set(series.flatMap((s) => s.points.map((p) => p.x))),
  ).sort((a, b) => a - b);

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || xs.length === 0) return;
    const rel = ((e.clientX - box.left) / box.width) * W;
    const xv = ((rel - pad.l) / (W - pad.l - pad.r)) * xM;
    let best = xs[0];
    for (const x of xs) if (Math.abs(x - xv) < Math.abs(best - xv)) best = x;
    setHover({
      x: best,
      px: (sx(best) / W) * box.width,
      py: e.clientY - box.top,
      w: box.width,
    });
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
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto block"
        role="img"
        aria-label={series.map((s) => s.label).join(", ")}
      >
        {ticks(yMax).map((v) => (
          <g key={`y${v}`}>
            <line
              x1={pad.l}
              x2={W - pad.r}
              y1={sy(v)}
              y2={sy(v)}
              stroke="var(--color-border)"
              strokeWidth={1}
            />
            <text
              x={pad.l - 6}
              y={sy(v) + 4}
              textAnchor="end"
              fontSize={11}
              fill="var(--color-muted)"
            >
              {yFormat(v)}
            </text>
          </g>
        ))}
        {ticks(xM, Math.round(xM / step)).map((v) => (
          <text
            key={`x${v}`}
            x={sx(v)}
            y={H - pad.b + 16}
            textAnchor="middle"
            fontSize={11}
            fill="var(--color-muted)"
          >
            {xTick(v)}
          </text>
        ))}
        <text
          x={W - pad.r}
          y={H - 2}
          textAnchor="end"
          fontSize={10}
          fill="var(--color-dim)"
        >
          {xLabel}
        </text>
        {band && (
          <g>
            <rect
              x={pad.l}
              width={W - pad.l - pad.r}
              y={sy(Math.min(band.to, yMax))}
              height={sy(band.from) - sy(Math.min(band.to, yMax))}
              fill="var(--color-green)"
              opacity={0.1}
            />
            <text
              x={pad.l + 4}
              y={sy(Math.min(band.to, yMax)) + 12}
              fontSize={10}
              fill="var(--color-muted)"
            >
              {band.label}
            </text>
          </g>
        )}
        {refY && (
          <g>
            <line
              x1={pad.l}
              x2={W - pad.r}
              y1={sy(refY.y)}
              y2={sy(refY.y)}
              stroke={refY.color}
              strokeWidth={1.5}
              strokeDasharray="6 4"
            />
            <text
              x={W - pad.r}
              y={sy(refY.y) - 4}
              textAnchor="end"
              fontSize={11}
              fill={refY.color}
            >
              {refY.label}
            </text>
          </g>
        )}
        {(refX ?? []).map((m0, i) => {
          const m = { ...m0, x: Math.min(Math.max(m0.x, 0), xM) }; // an event before the start sits on the axis; its minute is in the list
          return (
            <g key={`b${i}`}>
              <line
                x1={sx(m.x)}
                x2={sx(m.x)}
                y1={pad.t}
                y2={H - pad.b}
                stroke={m.color}
                strokeWidth={1.5}
                strokeDasharray="3 3"
              />
              <circle
                cx={sx(m.x)}
                cy={pad.t + 7 + (i % 3) * 15}
                r={7}
                fill={m.color}
              />
              <text
                x={sx(m.x)}
                y={pad.t + 11 + (i % 3) * 15}
                textAnchor="middle"
                fontSize={10}
                fontWeight={700}
                fill="var(--color-card)"
              >
                {i + 1}
              </text>
            </g>
          );
        })}
        {series.map((s) => (
          <g key={s.key}>
            {!s.dots && (
              <polyline
                fill="none"
                stroke={s.color}
                strokeWidth={2.25}
                strokeDasharray={s.dashed ? "5 4" : undefined}
                strokeLinejoin="round"
                points={s.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ")}
              />
            )}
            {(s.dots || s.points.length <= 40) &&
              s.points.map((p, i) => (
                <circle
                  key={`${p.x}-${i}`}
                  cx={sx(p.x)}
                  cy={sy(p.y)}
                  r={s.dots ? 4 : 2.6}
                  fill={s.color}
                  opacity={s.dots ? 0.75 : 1}
                />
              ))}
          </g>
        ))}
        {hover && (
          <line
            x1={sx(hover.x)}
            x2={sx(hover.x)}
            y1={pad.t}
            y2={H - pad.b}
            stroke="var(--color-dim)"
            strokeWidth={1}
          />
        )}
      </svg>
      {hover && (
        <Tip x={hover.px} y={hover.py} width={hover.w}>
          <div className="font-semibold mb-0.5">{xFormat(hover.x)}</div>
          {(refX ?? [])
            .map((m, i) => ({ ...m, i }))
            .filter((m) => m.x <= hover.x)
            .slice(-1)
            .map((m) => (
              <div
                key="ev"
                style={{ color: m.color }}
              >{`${m.i + 1} · ${m.label}`}</div>
            ))}
          {series.map((s) => {
            const v = valueAt(s, hover.x);
            return (
              <div key={s.key} className="flex items-center gap-1.5">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: s.color }}
                />
                <span className="text-[var(--color-muted)]">{s.label}</span>
                <span className="ml-auto pl-3 font-semibold">
                  {v == null ? "—" : yFormat(v)}
                </span>
              </div>
            );
          })}
        </Tip>
      )}
    </div>
  );
}

// ---- horizontal bars (stacked or single), HTML so they wrap well on a phone ----

type BarRow = {
  key: string;
  label: ReactNode;
  segments: { key: string; label: string; value: number; color: string }[];
  note?: string;
  sub?: string;
  dim?: boolean;
};

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
  const [tip, setTip] = useState<{
    row: string;
    x: number;
    y: number;
    w: number;
  } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const totals = rows.map((r) => r.segments.reduce((a, s) => a + s.value, 0));
  // the scale follows the rows that count: a sample too small does not stretch it (its bar stops at the edge)
  const counted = rows.filter((r) => !r.dim);
  const max =
    Math.max(
      ...(stacked
        ? totals
        : (counted.length ? counted : rows).flatMap((r) =>
            r.segments.map((s) => s.value),
          )),
      0,
    ) || 1;
  const show = (row: string, e: React.PointerEvent) => {
    const box = ref.current?.getBoundingClientRect();
    if (box)
      setTip({
        row,
        x: e.clientX - box.left,
        y: e.clientY - box.top,
        w: box.width,
      });
  };
  const tipRow = rows.find((r) => r.key === tip?.row);
  return (
    <div
      ref={ref}
      className="relative space-y-2"
      onPointerLeave={() => setTip(null)}
    >
      {rows.map((r, i) => {
        const total = totals[i];
        const has = r.segments.some((s) => s.value > 0);
        const value = has
          ? format(stacked ? total : (r.segments[0]?.value ?? 0))
          : "—";
        const bar = (
          <div className={`min-w-0 ${stacked ? "flex h-4" : "space-y-0.5"}`}>
            {has ? (
              r.segments.map((s) =>
                stacked ? (
                  <span
                    key={s.key}
                    className="block h-full first:rounded-l-sm last:rounded-r-sm"
                    style={{
                      width: `${(s.value / max) * 100}%`,
                      background: s.color,
                    }}
                  />
                ) : (
                  <span
                    key={s.key}
                    className="block h-2.5 rounded-r-sm"
                    style={{
                      width: `${Math.min(100, (s.value / max) * 100)}%`,
                      // a sample too small: hatched and faded, so it does not read like the others
                      background: r.dim
                        ? `repeating-linear-gradient(45deg, ${s.color} 0 3px, transparent 3px 6px)`
                        : s.color,
                      opacity: r.dim ? 0.6 : 1,
                      minWidth: s.value > 0 ? 2 : 0,
                    }}
                  />
                ),
              )
            ) : (
              <span className="text-[11px] text-[var(--color-dim)]">
                {emptyLabel}
              </span>
            )}
          </div>
        );
        if (compact)
          return (
            <div
              key={r.key}
              className="space-y-1 text-[12px]"
              onPointerMove={(e) => show(r.key, e)}
              onPointerDown={(e) => show(r.key, e)}
            >
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
            <span className="min-w-0">
              <span
                className={`block truncate ${r.dim ? "text-[var(--color-muted)]" : ""}`}
              >
                {r.label}
              </span>
              {r.sub && (
                <span className="block text-[10px] text-[var(--color-dim)]">
                  {r.sub}
                </span>
              )}
            </span>
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex-1 min-w-0">{bar}</div>
              <span className="sm:hidden tabular-nums font-semibold">
                {has ? value : ""}
              </span>
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
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: s.color }}
              />
              <span className="text-[var(--color-muted)]">{s.label}</span>
              <span className="ml-auto pl-3 font-semibold">
                {format(s.value)}
              </span>
            </div>
          ))}
          {tipRow.note && (
            <div className="text-[var(--color-dim)] mt-0.5">{tipRow.note}</div>
          )}
        </Tip>
      )}
    </div>
  );
}

// ---- the sections ----

function RoundTimelines({
  rounds,
  t,
  money,
  fixed = false,
}: {
  rounds: ChartRound[];
  t: ChartCopy;
  money: (v: number) => string;
  fixed?: boolean;
}) {
  const usable = rounds.filter(
    (r) => r.minutes != null || r.timeline.length > 0,
  );
  // Opens on the latest round that has a real minute-by-minute series.
  const withSeries = usable.filter(
    (x) => x.group === "round" && x.timeline.length >= 2,
  );
  const [sel, setSel] = useState(
    withSeries[withSeries.length - 1]?.id ?? usable[0]?.id ?? "",
  );
  const r = usable.find((x) => x.id === sel) ?? usable[0];
  if (!r) return <Missing text={t.noData} />;
  const real = r.timeline.length >= 2;
  const xMax = Math.max(
    r.minutes ?? 0,
    ...r.timeline.map((p) => p.m),
    ...r.brake.map((b) => b.m),
    1,
  );
  const pick = (k: keyof TimelinePoint) =>
    r.timeline
      .filter((p) => p[k] != null)
      .map((p) => ({ x: p.m, y: p[k] as number }));
  // Without a timeline only the two ends are known: drawn dashed and called an average pace, never a curve.
  const ends = (v: number | null) =>
    v == null || r.minutes == null
      ? []
      : [
          { x: 0, y: 0 },
          { x: r.minutes, y: v },
        ];
  const costS: LineSeries[] = real
    ? [{ key: "cost", label: t.spend, color: C.cost, points: pick("cost") }]
    : [
        {
          key: "cost",
          label: t.avgPace,
          color: C.cost,
          points: ends(r.cost),
          dashed: true,
        },
      ];
  const posS: LineSeries[] = real
    ? [
        { key: "found", label: t.found, color: C.found, points: pick("found") },
        {
          key: "scored",
          label: t.scored,
          color: C.scored,
          points: pick("scored"),
        },
        {
          key: "relevant",
          label: t.relevant,
          color: C.relevant,
          points: pick("relevant"),
        },
      ].filter((s) => s.points.length > 0)
    : [
        {
          key: "found",
          label: t.found,
          color: C.found,
          points: ends(r.found),
          dashed: true,
        },
        {
          key: "scored",
          label: t.scored,
          color: C.scored,
          points: ends(r.scored),
          dashed: true,
        },
        {
          key: "relevant",
          label: t.relevant,
          color: C.relevant,
          points: ends(r.relevant),
          dashed: true,
        },
      ].filter((s) => s.points.length > 0);
  // every score as a dot at the minute it was given, and the best one so far as a line
  const pts = r.scorePoints.filter((p) => p.m >= 0).sort((a, b) => a.m - b.m);
  let top = 0;
  const bestLine = pts.map((p) => ({ x: p.m, y: (top = Math.max(top, p.s)) }));
  const scoreS: LineSeries[] = pts.length
    ? [
        {
          key: "pts",
          label: t.eachScore,
          color: C.scored,
          points: pts.map((p) => ({ x: p.m, y: p.s })),
          dots: true,
        },
        { key: "best", label: t.bestScore, color: C.best, points: bestLine },
      ]
    : [];
  const BANDS: [number, number][] = [
    [0, 49],
    [50, 69],
    [70, 84],
    [85, 100],
  ];
  const dist = BANDS.map(
    ([a, b]) => r.scoreValues.filter((v) => v >= a && v <= b).length,
  );
  const refY =
    r.ceiling != null
      ? {
          y: r.ceiling,
          label: `${t.ceiling} ${money(r.ceiling)}`,
          color: C.ceiling,
        }
      : null;
  const refX = r.brake.map((b) => ({
    x: b.m,
    label: t.brakeKinds[b.kind] ?? b.kind,
    color: EVENT_GO.has(b.kind)
      ? "var(--color-green)"
      : EVENT_STOP.has(b.kind)
        ? C.brake
        : "var(--color-blue)",
  }));
  return (
    <div className="space-y-4">
      {/* on the page of one test there is nothing to choose; on the benchmark page the tests sit in a column per system */}
      {!fixed && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ...(["windows", "linux", "macos"] as const).map((os) => ({
              key: os,
              head: (
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-flex [&>svg]:w-[15px] [&>svg]:h-[15px]">
                    <OsIcon os={os} />
                  </span>
                  {OS_NAME[os]}
                </span>
              ),
              items: usable.filter((x) => x.group === "round" && x.os === os),
            })),
            {
              key: "bench",
              head: <span>🔍 {t.benchRounds}</span>,
              items: usable.filter((x) => x.group === "bench"),
            },
          ]
            .filter((g) => g.items.length > 0)
            .map((g) => (
              <div
                key={g.key}
                className="border border-[var(--color-border)] bg-[var(--color-deep)]"
              >
                <div className="px-3 py-1.5 text-[12px] font-semibold border-b border-[var(--color-border)]">
                  {g.head}
                </div>
                <ul
                  role="radiogroup"
                  aria-label={typeof g.key === "string" ? g.key : ""}
                >
                  {g.items.map((x) => {
                    const on = x.id === sel;
                    // «Office clerk, part time · 17/11»: the system is the column, so it is not repeated
                    const short = x.label.split(" · ").slice(1).join(" · ");
                    return (
                      <li key={x.id}>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => setSel(x.id)}
                          className={`w-full text-left px-3 py-1.5 text-[12px] flex justify-between gap-2 border-l-2 ${
                            on
                              ? "border-[var(--color-blue)] bg-[color-mix(in_srgb,var(--color-blue)_14%,transparent)] text-[var(--color-white)] font-semibold"
                              : "border-transparent text-[var(--color-base)] hover:bg-[var(--color-row)]"
                          }`}
                        >
                          <span className="truncate">{short}</span>
                          {x.buildNo != null && (
                            <span className="shrink-0 text-[10px] text-[var(--color-dim)] tabular-nums">{`${t.build} ${x.buildNo}`}</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
        </div>
      )}
      {!fixed && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] tabular-nums">
          <span className="font-semibold">{r.label}</span>
          <span>{`${t.minutes}: ${r.minutes ?? "—"}`}</span>
          <span>{`${t.spend}: ${r.cost == null ? "—" : money(r.cost)}`}</span>
          <span>{`${t.found}/${t.scored}/${t.relevant}: ${r.found ?? "—"}/${r.scored ?? "—"}/${r.relevant ?? "—"}`}</span>
          <span>{`${t.bestScore}: ${r.bestScore ?? "—"}`}</span>
        </div>
      )}
      {!real && (
        <p className="text-[11px] text-[var(--color-yellow)]">{t.onlyTotals}</p>
      )}
      {r.scoreValues.length === 0 && (
        <p className="text-[11px] text-[var(--color-dim)]">
          {r.bestScore != null ? `${t.bestScore}: ${r.bestScore} · ` : ""}
          {r.scoresMissing === "dbGone"
            ? t.scoresDbGone
            : r.scoresMissing === "checking"
              ? t.scoresChecking
              : !r.found
                ? t.scoresNoPositions
                : t.scoresNotRecorded}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t.spendOverTime}>
          <Legend
            items={[
              ...costS.map((s) => ({
                label: s.label,
                color: s.color,
                dashed: s.dashed,
              })),
              ...(refY
                ? [{ label: t.ceiling, color: C.ceiling, dashed: true }]
                : []),
              ...(refX.length
                ? [
                    { label: t.brake, color: C.brake, dashed: true },
                    {
                      label: t.events,
                      color: "var(--color-blue)",
                      dashed: true,
                    },
                  ]
                : []),
            ]}
          />
          {costS[0].points.length > 0 ? (
            <LineChart
              series={costS}
              xMax={xMax}
              yFormat={money}
              xLabel={t.minutesAxis}
              refY={refY}
              refX={refX}
            />
          ) : (
            <Missing text={t.noData} />
          )}
          {r.ceiling == null && (
            <p className="text-[11px] text-[var(--color-dim)]">{t.noCeiling}</p>
          )}
          {refX.length > 0 && (
            <ol className="text-[11px] text-[var(--color-muted)] space-y-0.5 tabular-nums">
              {refX.map((m, i) => (
                <li key={i} className="flex gap-2">
                  <span className="font-bold" style={{ color: m.color }}>
                    {i + 1}
                  </span>
                  <span>{`${m.x.toFixed(1)} min`}</span>
                  <span>{m.label}</span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
        <Panel title={t.positionsOverTime}>
          <Legend
            items={posS.map((s) => ({
              label: s.label,
              color: s.color,
              dashed: s.dashed,
            }))}
          />
          {posS.length > 0 ? (
            <LineChart
              series={posS}
              xMax={xMax}
              yFormat={(v) => String(Math.round(v))}
              xLabel={t.minutesAxis}
              refX={refX}
            />
          ) : (
            <Missing text={t.noData} />
          )}
        </Panel>
        {scoreS.length > 0 && (
          <Panel title={t.scoresOverTime}>
            <Legend
              items={scoreS.map((s) => ({ label: s.label, color: s.color }))}
            />
            <LineChart
              series={scoreS}
              xMax={xMax}
              yFormat={(v) => String(Math.round(v))}
              xLabel={t.minutesAxis}
              yMaxHint={100}
              refX={refX}
              band={{ from: 70, to: 100, label: "≥ 70" }}
            />
          </Panel>
        )}
        {r.scoreValues.length > 0 && (
          <Panel
            title={t.scoreDistribution}
            lead={`${r.scoreValues.length} ${t.scoresCount}`}
          >
            <HBars
              format={(v) => String(v)}
              emptyLabel="0"
              stacked={false}
              compact
              rows={BANDS.map(([a, b], k) => ({
                key: `${a}`,
                label: `${a}–${b}`,
                segments: [
                  {
                    key: "n",
                    label: t.scoresCount,
                    value: dist[k],
                    color:
                      a >= 70 ? "var(--color-green)" : "var(--color-muted)",
                  },
                ],
              }))}
            />
          </Panel>
        )}
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
                  segments: [
                    {
                      key: "rate",
                      label: t.dollarsPerMinute,
                      value: r.cost / r.minutes,
                      color: C.cost,
                    },
                  ],
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

function Comparison({
  rounds,
  t,
  money,
  labels,
}: {
  rounds: ChartRound[];
  t: ChartCopy;
  money: (v: number) => string;
  labels: ChartsProps["labels"];
}) {
  const [metric, setMetric] = useState<Metric>("perFound");
  const [by, setBy] = useState<GroupBy>("round");
  const metricOf = (
    cost: number,
    minutes: number,
    found: number,
    relevant: number,
  ): number | null => {
    if (metric === "perFound") return found > 0 ? cost / found : null;
    if (metric === "perRelevant") return relevant > 0 ? cost / relevant : null;
    if (metric === "perHour")
      return minutes > 0 ? (found / minutes) * 60 : null;
    return minutes > 0 ? cost / minutes : null;
  };
  const fmt = metric === "perHour" ? (v: number) => v.toFixed(1) : money;
  const rows: BarRow[] = useMemo(() => {
    const valid = rounds.filter(
      (r) => r.cost != null && r.minutes != null && r.found != null,
    );
    if (by === "round") {
      return valid.map((r) => {
        const v = metricOf(r.cost!, r.minutes!, r.found!, r.relevant ?? 0);
        return {
          key: r.id,
          label: r.group === "round" ? r.label : `${t.bench} · ${r.label}`,
          note: `${labels.services[r.service] ?? r.service} · ${money(r.cost!)} · ${r.minutes} min · ${r.found}/${r.relevant ?? "—"}`,
          segments: [
            {
              key: "v",
              label: t.metrics[metric],
              value: v ?? 0,
              color: SERVICE_COLOR[r.service] ?? C.found,
            },
          ],
        };
      });
    }
    const keyOf = (r: ChartRound) =>
      by === "service"
        ? r.service
        : by === "os"
          ? r.os
          : r.buildNo == null
            ? "?"
            : String(r.buildNo);
    const groups = new Map<string, ChartRound[]>();
    for (const r of valid)
      groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), r]);
    const ordered = Array.from(groups.entries()).sort(([a], [b]) =>
      by === "build" ? Number(a) - Number(b) : a.localeCompare(b),
    );
    return ordered.map(([k, list], i) => {
      // Pooled: total spend over total positions, so a long round weighs more than a short one.
      const sum = (f: (r: ChartRound) => number) =>
        list.reduce((a, r) => a + f(r), 0);
      const v = metricOf(
        sum((r) => r.cost!),
        sum((r) => r.minutes!),
        sum((r) => r.found!),
        sum((r) => r.relevant ?? 0),
      );
      const name =
        by === "service"
          ? (labels.services[k] ?? k)
          : by === "os"
            ? (labels.os[k] ?? k)
            : k === "?"
              ? t.buildUnknown
              : `${t.build} ${k}`;
      const color =
        by === "service"
          ? SERVICE_COLOR[k]
          : by === "os"
            ? OS_COLOR[k]
            : PALETTE[i % PALETTE.length];
      const found = sum((r) => r.found!);
      const small = list.length < 2 || found < 10;
      return {
        key: k,
        label: name,
        sub: `${(list.length === 1 ? t.oneRound : t.manyRounds).replace("{n}", String(list.length))} · ${(found === 1 ? t.onePosition : t.manyPositions).replace("{n}", String(found))}${small ? ` · ${t.tooSmall}` : ""}`,
        dim: small,
        segments: [
          {
            key: "v",
            label: t.metrics[metric],
            value: v ?? 0,
            color: color ?? C.found,
          },
        ],
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rounds, metric, by]);
  return (
    <div className="space-y-3">
      <Chips
        label={t.metric}
        value={metric}
        onChange={setMetric}
        options={(Object.keys(t.metrics) as Metric[]).map((m) => ({
          value: m,
          label: t.metrics[m],
        }))}
      />
      <Chips
        label={t.groupBy}
        value={by}
        onChange={setBy}
        options={(["round", "service", "os", "build"] as GroupBy[]).map(
          (g) => ({ value: g, label: t.groups[g] }),
        )}
      />
      {by === "round" && (
        <Legend
          items={Array.from(new Set(rounds.map((r) => r.service))).map((s) => ({
            label: labels.services[s] ?? s,
            color: SERVICE_COLOR[s] ?? C.found,
          }))}
        />
      )}
      <HBars
        rows={rows}
        format={fmt}
        emptyLabel={t.notComputable}
        stacked={false}
      />
      <p className="text-[11px] text-[var(--color-dim)]">{t.comparisonHint}</p>
      {by !== "round" && (
        <p className="text-[11px] text-[var(--color-dim)]">{t.tooSmallHint}</p>
      )}
    </div>
  );
}

function Bench({ bench, t }: { bench: BenchProfile[]; t: ChartCopy }) {
  if (bench.length === 0) return <Missing text={t.benchMissing} />;
  const n = (v: number) => String(v);
  const keysOf = (pick: (b: BenchProfile) => Record<string, number> | null) =>
    Array.from(new Set(bench.flatMap((b) => Object.keys(pick(b) ?? {}))));
  const rowsFor = (
    pick: (b: BenchProfile) => Record<string, number> | null,
    names: Record<string, string>,
    colors?: Record<string, string>,
  ) => {
    const keys = keysOf(pick);
    return {
      keys,
      rows: bench.map((b) => ({
        key: b.id,
        label: b.label,
        segments: keys.map((k, i) => ({
          key: k,
          label: names[k] ?? k,
          value: pick(b)?.[k] ?? 0,
          color: colorOf(k, i, colors),
        })),
      })),
    };
  };
  const rel = rowsFor(
    (b) => (b.relevance as Record<string, number> | null) ?? null,
    t.relevance,
    REL_COLOR,
  );
  const dis = rowsFor((b) => b.discarded, t.discardReasons);
  const src = rowsFor((b) => b.bySource, {});
  const legendOf = (
    keys: string[],
    names: Record<string, string>,
    colors?: Record<string, string>,
  ) =>
    keys.map((k, i) => ({
      label: names[k] ?? k,
      color: colorOf(k, i, colors),
    }));
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

function Builds({
  builds,
  t,
  labels,
}: {
  builds: BuildPoint[];
  t: ChartCopy;
  labels: ChartsProps["labels"];
}) {
  const statuses = ["pass", "fail", "blocked", "pending"];
  const tRows: BarRow[] = builds.map((b) => ({
    key: String(b.n),
    label: `${t.build} ${b.n}`,
    note: b.fromCurrent ? t.buildsFromCurrent : undefined,
    segments: statuses.map((s) => ({
      key: s,
      label: labels.targetStatus[s] ?? s,
      value: b.targets?.[s] ?? 0,
      color: STATUS_COLOR[s],
    })),
  }));
  const anyFound = builds.some((b) => b.defects?.found != null);
  const dRows: BarRow[] = builds.map((b) => ({
    key: String(b.n),
    label: `${t.build} ${b.n}`,
    segments: [
      ...(anyFound
        ? [
            {
              key: "found",
              label: t.defectsFound,
              value: b.defects?.found ?? 0,
              color: "#EF4444",
            },
          ]
        : []),
      {
        key: "closed",
        label: t.defectsClosed,
        value: b.defects?.closed ?? 0,
        color: "#22C55E",
      },
    ],
  }));
  const anyDefects = builds.some((b) => b.defects != null);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel
        title={t.buildsTargets}
        lead={
          builds.some((b) => b.fromCurrent) ? t.buildsFromCurrent : undefined
        }
      >
        <Legend
          items={statuses.map((s) => ({
            label: labels.targetStatus[s] ?? s,
            color: STATUS_COLOR[s],
          }))}
        />
        <HBars
          rows={tRows}
          format={(v) => String(v)}
          emptyLabel={t.noRoundOnBuild}
          compact
        />
      </Panel>
      <Panel title={t.buildsDefects}>
        {anyDefects ? (
          <>
            <Legend
              items={[
                ...(anyFound
                  ? [{ label: t.defectsFound, color: "#EF4444" }]
                  : []),
                { label: t.defectsClosed, color: "#22C55E" },
              ]}
            />
            <HBars
              rows={dRows}
              format={(v) => String(v)}
              emptyLabel={t.noData}
              stacked={false}
              compact
            />
            <p className="text-[11px] text-[var(--color-dim)]">
              {anyFound
                ? t.defectsHint
                : `${t.defectsHint} ${t.defectsFoundMissing}`}
            </p>
          </>
        ) : (
          <Missing text={t.defectsMissing} />
        )}
      </Panel>
    </div>
  );
}

function Agents({
  rounds,
  t,
  money,
}: {
  rounds: ChartRound[];
  t: ChartCopy;
  money: (v: number) => string;
}) {
  const withAgents = rounds.filter(
    (r) => r.agents && Object.keys(r.agents).length > 0,
  );
  if (withAgents.length === 0) return <Missing text={t.agentsMissing} />;
  const keys = Array.from(
    new Set(withAgents.flatMap((r) => Object.keys(r.agents!))),
  );
  const rows: BarRow[] = withAgents.map((r) => ({
    key: r.id,
    label: r.group === "round" ? r.label : `${t.bench} · ${r.label}`,
    segments: keys.map((k, i) => ({
      key: k,
      label: t.agents[k] ?? k,
      value: r.agents![k] ?? 0,
      color: colorOf(k, i, AGENT_COLOR),
    })),
  }));
  return (
    <div className="space-y-3">
      <Legend
        items={keys.map((k, i) => ({
          label: t.agents[k] ?? k,
          color: colorOf(k, i, AGENT_COLOR),
        }))}
      />
      <HBars rows={rows} format={money} emptyLabel={t.noData} />
    </div>
  );
}

// ---- vertical grouped bars, one group per hour ----

function VBars({
  groups,
  series,
}: {
  groups: { key: string; label: string; values: (number | null)[] }[];
  series: { label: string; color: string }[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  const [tip, setTip] = useState<{
    i: number;
    x: number;
    y: number;
    w: number;
  } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) =>
      setW(Math.max(280, Math.round(e.contentRect.width))),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 220;
  const pad = { l: 36, r: 8, t: 10, b: 26 };
  const max = niceMax(
    Math.max(1, ...groups.flatMap((g) => g.values.map((v) => v ?? 0))) * 1.05,
  );
  const gw = (W - pad.l - pad.r) / Math.max(groups.length, 1);
  const bw = Math.max(3, (gw * 0.75) / series.length);
  const sy = (v: number) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  return (
    <div
      ref={ref}
      className="relative select-none touch-pan-y"
      onPointerLeave={() => setTip(null)}
      onPointerMove={(e) => {
        const box = ref.current?.getBoundingClientRect();
        if (!box) return;
        const i = Math.floor((e.clientX - box.left - pad.l) / gw);
        if (i >= 0 && i < groups.length)
          setTip({
            i,
            x: e.clientX - box.left,
            y: e.clientY - box.top,
            w: box.width,
          });
      }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto block"
        role="img"
        aria-label={series.map((s) => s.label).join(", ")}
      >
        {ticks(max).map((v) => (
          <g key={v}>
            <line
              x1={pad.l}
              x2={W - pad.r}
              y1={sy(v)}
              y2={sy(v)}
              stroke="var(--color-border)"
            />
            <text
              x={pad.l - 6}
              y={sy(v) + 4}
              textAnchor="end"
              fontSize={11}
              fill="var(--color-muted)"
            >
              {Math.round(v)}
            </text>
          </g>
        ))}
        {groups.map((g, i) => (
          <g key={g.key}>
            {g.values.map((v, j) =>
              v == null ? null : (
                <rect
                  key={j}
                  x={pad.l + i * gw + (gw - bw * series.length) / 2 + j * bw}
                  y={sy(v)}
                  width={bw - 1}
                  height={H - pad.b - sy(v)}
                  fill={series[j].color}
                  opacity={tip && tip.i !== i ? 0.55 : 1}
                />
              ),
            )}
            {(groups.length <= 12 || i % 2 === 0) && (
              <text
                x={pad.l + i * gw + gw / 2}
                y={H - pad.b + 16}
                textAnchor="middle"
                fontSize={11}
                fill="var(--color-muted)"
              >
                {g.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      {tip && (
        <Tip x={tip.x} y={tip.y} width={tip.w}>
          <div className="font-semibold mb-0.5">{groups[tip.i].label}</div>
          {series.map((s, j) => (
            <div key={s.label} className="flex items-center gap-1.5">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: s.color }}
              />
              <span className="text-[var(--color-muted)]">{s.label}</span>
              <span className="ml-auto pl-3 font-semibold">
                {groups[tip.i].values[j] ?? "—"}
              </span>
            </div>
          ))}
        </Tip>
      )}
    </div>
  );
}

function Beta({ beta, t }: { beta: BetaDay; t: ChartCopy }) {
  if (!beta) return <Missing text={t.betaMissing} />;
  const hh = (v: number) =>
    `${String(Math.floor(v)).padStart(2, "0")}:${String(Math.round((v % 1) * 60)).padStart(2, "0")}`;
  const start = Math.floor(
    Math.min(
      ...beta.hours.map((h) => h.h),
      ...beta.codex.map((c) => c.t),
      ...beta.experiments.map((e) => e.t),
    ),
  );
  const marks = beta.experiments.map((e) => ({
    x: e.t - start,
    label: e.label,
    color: "var(--color-purple)",
  }));
  const xMax = Math.max(
    ...beta.codex.map((c) => c.t - start),
    ...marks.map((m) => m.x),
    1,
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title={t.betaPositions}>
        <Legend
          items={[
            { label: t.found, color: C.found },
            { label: t.atLeast70, color: C.relevant },
          ]}
        />
        <VBars
          series={[
            { label: t.found, color: C.found },
            { label: t.atLeast70, color: C.relevant },
          ]}
          groups={beta.hours.map((h) => ({
            key: String(h.h),
            label: `${String(h.h).padStart(2, "0")}`,
            values: [h.positions, h.atLeast70],
          }))}
        />
        <p className="text-[11px] text-[var(--color-dim)]">{t.betaHoursHint}</p>
      </Panel>
      <Panel title={t.betaCodex}>
        <Legend
          items={[
            { label: t.betaCodexUsed, color: C.cost },
            {
              label: t.betaExperiments,
              color: "var(--color-purple)",
              dashed: true,
            },
          ]}
        />
        {beta.codex.length > 0 ? (
          <LineChart
            series={[
              {
                key: "codex",
                label: t.betaCodexUsed,
                color: C.cost,
                points: beta.codex.map((c) => ({
                  x: c.t - start,
                  y: c.usedPct,
                })),
              },
            ]}
            xMax={xMax}
            yFormat={(v) => `${Math.round(v)}%`}
            xLabel={t.betaHour}
            yMaxHint={100}
            refX={marks}
            xFormat={(v) => hh(v + start)}
            xTick={(v) => String(Math.round(v + start)).padStart(2, "0")}
            xStep={1}
          />
        ) : (
          <Missing text={t.noData} />
        )}
        {marks.length > 0 && (
          <ol className="text-[11px] text-[var(--color-muted)] space-y-0.5 tabular-nums">
            {beta.experiments.map((e, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-bold text-[var(--color-purple)]">
                  {i + 1}
                </span>
                <span>{hh(e.t)}</span>
                <span>{e.label}</span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}

const beta = (b: BetaDay, t: ChartCopy) =>
  b ? `${t.s6Lead} ${b.day}.` : t.s6Lead;

export default function BenchmarkCharts(props: ChartsProps) {
  const t = CHART_COPY[props.locale] ?? CHART_COPY.en;
  const nf = new Intl.NumberFormat(props.locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const money = (v: number) => `${nf.format(v)} $`;
  const all = [...props.rounds];
  return (
    <section className="space-y-6" id="charts">
      <div className="space-y-1">
        <h2 className="section-label">{t.title}</h2>
        <p className="text-[12px] text-[var(--color-muted)] max-w-3xl">
          {t.lead}
        </p>
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
      <Panel title={`6 · ${t.s6}`} lead={beta(props.beta, t)}>
        <Beta beta={props.beta} t={t} />
      </Panel>
    </section>
  );
}

/** The charts of one test, for its own page: spend, positions and scores over time with the ceiling and the events of the
 *  brake, and the spend of each role where the sampler recorded it. */
export function RoundDetailCharts({
  locale,
  round,
}: {
  locale: Locale;
  round: ChartRound;
}) {
  const t = CHART_COPY[locale] ?? CHART_COPY.en;
  const nf = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const money = (v: number) => `${nf.format(v)} $`;
  return (
    <div className="space-y-4">
      <RoundTimelines rounds={[round]} t={t} money={money} fixed />
      {round.agents && Object.keys(round.agents).length > 0 && (
        <Panel title={t.s5} lead={t.s5Lead}>
          <Agents rounds={[round]} t={t} money={money} />
        </Panel>
      )}
    </div>
  );
}
