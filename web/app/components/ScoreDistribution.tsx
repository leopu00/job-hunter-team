"use client";

import { useMemo, useState } from "react";

type Props = {
  scores: number[];
  title: string;
  emptyLabel: string;
  thresholdReady?: number; // default 70: soglia "ready" che marchi con riga
};

const BINS = 20; // bin da 5 score (0-4, 5-9, ..., 95-100)
const BIN_SIZE = 100 / BINS;

const W = 480;
const H = 200;
const PAD_LEFT = 28;
const PAD_RIGHT = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 22;

function colorForScore(score: number): string {
  if (score >= 75) return "var(--color-green)";
  if (score >= 60) return "#7fffb2";
  if (score >= 45) return "var(--color-yellow)";
  if (score >= 30) return "var(--color-orange)";
  return "var(--color-red)";
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return Math.round(sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]));
}

export default function ScoreDistribution({
  scores,
  title,
  emptyLabel,
  thresholdReady = 70,
}: Props) {
  const [hover, setHover] = useState<number | null>(null);

  const stats = useMemo(() => {
    const arr = [...scores].sort((a, b) => a - b);
    const n = arr.length;
    if (n === 0) {
      return {
        bins: [] as number[],
        max: 0,
        avg: 0,
        median: 0,
        p25: 0,
        p75: 0,
        min: 0,
        topVal: 0,
        n: 0,
        domainLo: 0,
        domainHi: 100,
        firstBin: 0,
      };
    }
    const bins = new Array(BINS).fill(0);
    for (const s of arr) {
      const i = Math.min(BINS - 1, Math.floor(s / BIN_SIZE));
      bins[i] += 1;
    }
    // Auto-scale: trova primo/ultimo bin non-vuoto, padda di 1 bin per
    // respiro visuale. Cosi' se i score stanno [40..95] il chart copre
    // [35..100] invece di [0..100] con mezzo vuoto a sinistra.
    let firstBin = 0;
    while (firstBin < BINS && bins[firstBin] === 0) firstBin++;
    let lastBin = BINS - 1;
    while (lastBin > firstBin && bins[lastBin] === 0) lastBin--;
    firstBin = Math.max(0, firstBin - 1);
    lastBin = Math.min(BINS - 1, lastBin + 1);
    const domainLo = firstBin * BIN_SIZE;
    const domainHi = Math.min(100, (lastBin + 1) * BIN_SIZE);
    const sum = arr.reduce((a, b) => a + b, 0);
    return {
      bins: bins.slice(firstBin, lastBin + 1),
      max: Math.max(...bins),
      avg: Math.round(sum / n),
      median: percentile(arr, 0.5),
      p25: percentile(arr, 0.25),
      p75: percentile(arr, 0.75),
      min: arr[0],
      topVal: arr[n - 1],
      n,
      domainLo,
      domainHi,
      firstBin,
    };
  }, [scores]);

  if (stats.n === 0) {
    return (
      <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5">
        <div className="section-label mb-3">{title}</div>
        <p className="text-[11px] text-[var(--color-dim)]">{emptyLabel}</p>
      </div>
    );
  }

  const chartW = W - PAD_LEFT - PAD_RIGHT;
  const chartH = H - PAD_TOP - PAD_BOTTOM;
  const barW = chartW / stats.bins.length;
  const domainSpan = stats.domainHi - stats.domainLo || 1;

  // X position from score (mappato sul dominio dinamico)
  const sx = (score: number) =>
    PAD_LEFT + ((score - stats.domainLo) / domainSpan) * chartW;
  const by = (count: number) =>
    PAD_TOP + chartH - (count / Math.max(1, stats.max)) * chartH;

  // Tick adattivi a step di 10 o 5 in base allo span
  const tickStep = domainSpan <= 30 ? 5 : 10;
  const xTicks: number[] = [];
  const tickStart = Math.ceil(stats.domainLo / tickStep) * tickStep;
  for (let v = tickStart; v <= stats.domainHi; v += tickStep) xTicks.push(v);

  const hoveredBin = hover != null ? hover : null;
  const hoveredCount = hoveredBin != null ? stats.bins[hoveredBin] : 0;
  const hoveredLo =
    hoveredBin != null
      ? Math.round((stats.firstBin + hoveredBin) * BIN_SIZE)
      : 0;
  const hoveredHi =
    hoveredBin != null
      ? Math.min(
          100,
          Math.round((stats.firstBin + hoveredBin + 1) * BIN_SIZE) - 1,
        )
      : 0;
  const hoveredPct =
    hoveredCount && stats.n > 0
      ? Math.round((hoveredCount / stats.n) * 100)
      : 0;

  return (
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 transition-colors duration-200 hover:border-[var(--color-border-glow)]">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <span className="section-label">{title}</span>
        <div className="flex items-center gap-3 text-[10px] text-[var(--color-muted)] tabular-nums">
          <Stat label="avg" value={stats.avg} color={colorForScore(stats.avg)} />
          <Stat label="med" value={stats.median} />
          <Stat
            label="p25–p75"
            value={`${stats.p25}–${stats.p75}`}
          />
          <Stat label="n" value={stats.n} />
        </div>
      </div>

      <svg
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={title}
        style={{ overflow: "visible" }}
        onMouseLeave={() => setHover(null)}
      >
        {/* Griglia orizzontale 4 linee */}
        {[0.25, 0.5, 0.75, 1].map((t) => (
          <line
            key={t}
            x1={PAD_LEFT}
            x2={PAD_LEFT + chartW}
            y1={PAD_TOP + chartH * (1 - t)}
            y2={PAD_TOP + chartH * (1 - t)}
            stroke="var(--color-border)"
            strokeWidth={1}
            strokeDasharray="2 4"
            opacity={0.5}
          />
        ))}

        {/* Asse X — tick dinamici sul dominio */}
        {xTicks.map((v) => (
          <g key={v}>
            <line
              x1={sx(v)}
              x2={sx(v)}
              y1={PAD_TOP + chartH}
              y2={PAD_TOP + chartH + 3}
              stroke="var(--color-dim)"
            />
            <text
              x={sx(v)}
              y={PAD_TOP + chartH + 14}
              fontSize={9}
              textAnchor="middle"
              fill="var(--color-dim)"
              style={{ fontFamily: "inherit" }}
            >
              {v}
            </text>
          </g>
        ))}

        {/* Bars */}
        {stats.bins.map((count, i) => {
          const x = PAD_LEFT + i * barW;
          const y = by(count);
          const h = PAD_TOP + chartH - y;
          const isHover = hover === i;
          const score = (stats.firstBin + i) * BIN_SIZE + BIN_SIZE / 2;
          return (
            <rect
              key={i}
              x={x + 0.5}
              y={y}
              width={Math.max(1, barW - 1)}
              height={h}
              fill={colorForScore(score)}
              opacity={hover == null ? 0.85 : isHover ? 1 : 0.35}
              onMouseEnter={() => setHover(i)}
              style={{ cursor: "pointer", transition: "opacity 0.12s" }}
            />
          );
        })}

        {/* Linea verticale: media */}
        <g>
          <line
            x1={sx(stats.avg)}
            x2={sx(stats.avg)}
            y1={PAD_TOP}
            y2={PAD_TOP + chartH}
            stroke="var(--color-bright)"
            strokeWidth={1.5}
            strokeDasharray="3 3"
          />
          <text
            x={sx(stats.avg)}
            y={PAD_TOP - 2}
            fontSize={9}
            textAnchor="middle"
            fill="var(--color-bright)"
            fontWeight={700}
            style={{ fontFamily: "inherit" }}
          >
            avg {stats.avg}
          </text>
        </g>

        {/* Linea verticale: soglia ready */}
        {thresholdReady != null && (
          <g>
            <line
              x1={sx(thresholdReady)}
              x2={sx(thresholdReady)}
              y1={PAD_TOP}
              y2={PAD_TOP + chartH}
              stroke="var(--color-green)"
              strokeWidth={1}
              strokeDasharray="2 5"
              opacity={0.6}
            />
            <text
              x={sx(thresholdReady) + 3}
              y={PAD_TOP + 8}
              fontSize={8}
              fill="var(--color-green)"
              opacity={0.8}
              style={{ fontFamily: "inherit" }}
            >
              ready ≥{thresholdReady}
            </text>
          </g>
        )}

        {/* Hover tooltip */}
        {hoveredBin != null && hoveredCount > 0 && (
          <g style={{ pointerEvents: "none" }}>
            <rect
              x={Math.min(W - 110, Math.max(0, sx(hoveredLo) - 50))}
              y={Math.max(0, by(hoveredCount) - 38)}
              width={108}
              height={32}
              rx={4}
              fill="var(--color-panel)"
              stroke="var(--color-border)"
            />
            <text
              x={Math.min(W - 110, Math.max(0, sx(hoveredLo) - 50)) + 8}
              y={Math.max(0, by(hoveredCount) - 24)}
              fontSize={10}
              fill="var(--color-bright)"
              fontWeight={700}
              style={{ fontFamily: "inherit" }}
            >
              {hoveredLo}–{hoveredHi}
            </text>
            <text
              x={Math.min(W - 110, Math.max(0, sx(hoveredLo) - 50)) + 8}
              y={Math.max(0, by(hoveredCount) - 11)}
              fontSize={9}
              fill="var(--color-muted)"
              style={{ fontFamily: "inherit" }}
            >
              {hoveredCount} pos · {hoveredPct}%
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color?: string;
}) {
  return (
    <span>
      <span className="text-[var(--color-dim)]">{label}</span>{" "}
      <span
        className="font-semibold"
        style={{ color: color ?? "var(--color-bright)" }}
      >
        {value}
      </span>
    </span>
  );
}
