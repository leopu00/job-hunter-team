"use client";

import { useMemo, useState } from "react";

type Props = {
  scores: number[];
  title: string;
  emptyLabel: string;
  maxScore?: number;
  binStep?: number;
  decimals?: number;
  // Etichetta opzionale del filtro attivo (es. tipo selezionato sulla
  // donut). Mostrata nell'header come chip colorato.
  accentLabel?: string;
  accentColor?: string;
  // Range selezionati (multi). Una barra è evidenziata se il suo
  // (lo,hi) coincide con uno dei range selezionati. Click toggle.
  selectedRanges?: Array<{ lo: number; hi: number }>;
  onToggleRange?: (r: { lo: number; hi: number }) => void;
  // Posizioni del dataset corrente senza score numerico: appaiono
  // come barra speciale in cima ("—"). Selezionabile come una
  // barra normale (filtra "solo senza score" lato mappa).
  unscoredCount?: number;
  unscoredSelected?: boolean;
  onToggleUnscored?: () => void;
};

const W = 480;
// Layout: a sinistra range label; barre right-anchored al centro;
// count a destra DOPO la barra (subito prima del bordo container).
const COUNT_W = 28;
const RANGE_W = 64;
const GAP = 6;
const PAD_LEFT = RANGE_W + GAP; // 70
const PAD_RIGHT = COUNT_W + GAP; // 34
const PAD_TOP = 12;
const PAD_BOTTOM = 8;
const ROW_H = 24;
const LABEL_FONT = 13;

function colorForFraction(frac: number): string {
  if (frac >= 0.75) return "var(--color-green)";
  if (frac >= 0.6) return "#7fffb2";
  if (frac >= 0.45) return "var(--color-yellow)";
  if (frac >= 0.3) return "var(--color-orange)";
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

export default function ScoreDistributionHorizontal({
  scores,
  title,
  emptyLabel,
  maxScore = 100,
  binStep = 5,
  decimals = 0,
  accentLabel,
  accentColor,
  selectedRanges = [],
  onToggleRange,
  unscoredCount = 0,
  unscoredSelected = false,
  onToggleUnscored,
}: Props) {
  const hasRangeSelection = selectedRanges.length > 0 || unscoredSelected;
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
        n: 0,
        firstBin: 0,
        activeStep: binStep,
      };
    }
    // Binning adattivo: se i dati si concentrano in poche fasce,
    // restringiamo lo step finche' si ottengono almeno TARGET_MIN
    // bin con count > 0 (oppure si raggiunge MIN_STEP).
    // TARGET_MIN scala col campione: per n piccolo (es. tipo
    // selezionato con 15 score) non vale la pena dimezzare lo step
    // perche' si ottengono tante barre da 1 occorrenza, rumore puro.
    // Soglia: max 8, ma anche al massimo n/2 (ogni barra rappresenta
    // mediamente >= 2 score).
    const TARGET_MIN = Math.max(1, Math.min(8, Math.floor(n / 2)));
    const MIN_STEP = decimals === 0 ? 1 : Math.pow(10, -decimals);
    const stepCandidates: number[] = [];
    {
      let s = binStep;
      stepCandidates.push(s);
      while (stepCandidates.length < 5) {
        const next =
          decimals === 0 ? Math.max(MIN_STEP, Math.floor(s / 2)) : s / 2;
        if (next === s || next < MIN_STEP) break;
        stepCandidates.push(next);
        s = next;
      }
    }
    let chosen = {
      step: stepCandidates[0],
      bins: [] as number[],
      visible: 0,
    };
    for (const step of stepCandidates) {
      const BINS_TRY = Math.max(1, Math.round(maxScore / step));
      const tryBins = new Array(BINS_TRY).fill(0);
      for (const v of arr) {
        const idx = Math.min(BINS_TRY - 1, Math.floor(v / step));
        tryBins[idx] += 1;
      }
      const visible = tryBins.filter((c) => c > 0).length;
      chosen = { step, bins: tryBins, visible };
      if (visible >= TARGET_MIN) break;
    }
    const activeStep = chosen.step;
    const bins = chosen.bins;
    const BINS_LEN = bins.length;
    let firstBin = 0;
    while (firstBin < BINS_LEN && bins[firstBin] === 0) firstBin++;
    let lastBin = BINS_LEN - 1;
    while (lastBin > firstBin && bins[lastBin] === 0) lastBin--;
    firstBin = Math.max(0, firstBin - 1);
    lastBin = Math.min(BINS_LEN - 1, lastBin + 1);
    const sum = arr.reduce((a, b) => a + b, 0);
    const round = (v: number) =>
      decimals > 0
        ? Math.round(v * 10 ** decimals) / 10 ** decimals
        : Math.round(v);
    return {
      bins: bins.slice(firstBin, lastBin + 1),
      max: Math.max(...bins),
      avg: round(sum / n),
      median: round(percentile(arr, 0.5)),
      p25: round(percentile(arr, 0.25)),
      p75: round(percentile(arr, 0.75)),
      n,
      firstBin,
      activeStep,
    };
  }, [scores, binStep, maxScore, decimals]);

  // Nascondi bin a zero: mantieni solo quelli con almeno una occorrenza.
  const visibleBins = stats.bins
    .map((count, i) => ({ count, i }))
    .filter((b) => b.count > 0);
  const hasUnscored = unscoredCount > 0;
  const rows = visibleBins.length + (hasUnscored ? 1 : 0);
  const H = PAD_TOP + PAD_BOTTOM + rows * ROW_H;
  const chartW = W - PAD_LEFT - PAD_RIGHT;
  // Scala barre: includi unscored nel max per coerenza visiva.
  const barMax = Math.max(1, stats.max, unscoredCount);
  const formatVal = (v: number) =>
    decimals > 0 ? v.toFixed(decimals) : Math.round(v).toString();

  return (
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 transition-colors duration-200 hover:border-[var(--color-border-glow)]">
      {accentLabel && (
        <div className="flex items-center justify-end mb-3">
          <span
            className="text-[10px] font-semibold tracking-[0.14em] uppercase px-2 py-0.5 rounded-full border"
            style={{
              color: accentColor ?? "var(--color-bright)",
              borderColor: accentColor ?? "var(--color-border)",
              background: `${accentColor ?? "var(--color-bright)"}1a`,
            }}
          >
            {accentLabel}
          </span>
        </div>
      )}

      {stats.n === 0 && !hasUnscored ? (
        <div className="text-[11px] text-[var(--color-dim)] py-6 text-center">
          {emptyLabel}
        </div>
      ) : (
        <svg
          width="100%"
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={title}
          style={{ overflow: "visible" }}
          onMouseLeave={() => setHover(null)}
        >
          {/* Riga speciale "senza score" — in fondo (ultima riga).
              I bin score occupano rowIdx 0..visibleBins.length-1
              (alto-score in cima). Unscored = rowIdx visibleBins.length. */}
          {hasUnscored && (() => {
            const y = PAD_TOP + visibleBins.length * ROW_H;
            const barH = ROW_H - 4;
            const w = (unscoredCount / barMax) * chartW;
            const isHover = hover === -1;
            const isSelected = unscoredSelected;
            const active = isHover || isSelected;
            const dimmed =
              (hover != null && !isHover && !isSelected) ||
              (hover == null && hasRangeSelection && !isSelected);
            return (
              <g
                onMouseEnter={() => setHover(-1)}
                onClick={() => onToggleUnscored?.()}
                style={{ cursor: onToggleUnscored ? "pointer" : "default" }}
              >
                <text
                  x={PAD_LEFT + chartW + GAP}
                  y={y + barH / 2 + 3}
                  fontSize={LABEL_FONT}
                  textAnchor="start"
                  fill={
                    isSelected ? "var(--color-bright)" : "var(--color-muted)"
                  }
                  fontWeight={isSelected ? 700 : 400}
                  style={{ fontFamily: "inherit" }}
                >
                  {unscoredCount}
                </text>
                <rect
                  x={PAD_LEFT}
                  y={y}
                  width={chartW}
                  height={barH}
                  fill="var(--color-border)"
                  opacity={0.25}
                />
                <rect
                  x={PAD_LEFT + chartW - Math.max(0, w)}
                  y={y}
                  width={Math.max(0, w)}
                  height={barH}
                  fill="var(--color-muted)"
                  opacity={active ? 1 : dimmed ? 0.32 : 0.7}
                  stroke={isSelected ? "var(--color-bright)" : "none"}
                  strokeWidth={isSelected ? 1.5 : 0}
                  style={{
                    transition: "opacity 0.12s, stroke-width 0.12s",
                  }}
                />
                <text
                  x={RANGE_W - 4}
                  y={y + barH / 2 + 3}
                  fontSize={LABEL_FONT}
                  textAnchor="end"
                  fill={
                    isSelected ? "var(--color-bright)" : "var(--color-dim)"
                  }
                  fontWeight={isSelected ? 700 : 400}
                  fontStyle="italic"
                  style={{ fontFamily: "inherit" }}
                >
                  no score
                </text>
              </g>
            );
          })()}

          {visibleBins.map(({ count, i }, visIdx) => {
            const lo = (stats.firstBin + i) * stats.activeStep;
            const hi = Math.min(
              maxScore,
              (stats.firstBin + i + 1) * stats.activeStep -
                (decimals > 0 ? 10 ** -decimals : 1),
            );
            // Ruotato 180°: bin con score più alto in cima.
            // Unscored (se presente) occupa l'ultima riga: i bin
            // restano nelle righe 0..visibleBins.length-1.
            const rowIdx = visibleBins.length - 1 - visIdx;
            const y = PAD_TOP + rowIdx * ROW_H;
            const barH = ROW_H - 4;
            const w = (count / barMax) * chartW;
            const score = lo + stats.activeStep / 2;
            const isHover = hover === i;
            const isSelected = selectedRanges.some(
              (r) => r.lo === lo && r.hi === hi,
            );
            const active = isHover || isSelected;
            const dimmed =
              (hover != null && !isHover && !isSelected) ||
              (hover == null && hasRangeSelection && !isSelected);
            const pct = stats.n > 0 ? Math.round((count / stats.n) * 100) : 0;
            return (
              <g
                key={i}
                onMouseEnter={() => setHover(i)}
                onClick={() => onToggleRange?.({ lo, hi })}
                style={{ cursor: onToggleRange ? "pointer" : "default" }}
              >
                <text
                  x={PAD_LEFT + chartW + GAP}
                  y={y + barH / 2 + 3}
                  fontSize={LABEL_FONT}
                  textAnchor="start"
                  fill={
                    isSelected ? "var(--color-bright)" : "var(--color-muted)"
                  }
                  fontWeight={isSelected ? 700 : 400}
                  style={{ fontFamily: "inherit" }}
                >
                  {count}
                  {isHover ? ` · ${pct}%` : ""}
                </text>
                <rect
                  x={PAD_LEFT}
                  y={y}
                  width={chartW}
                  height={barH}
                  fill="var(--color-border)"
                  opacity={0.25}
                />
                <rect
                  x={PAD_LEFT + chartW - Math.max(0, w)}
                  y={y}
                  width={Math.max(0, w)}
                  height={barH}
                  fill={colorForFraction(score / maxScore)}
                  opacity={active ? 1 : dimmed ? 0.32 : 0.85}
                  stroke={isSelected ? "var(--color-bright)" : "none"}
                  strokeWidth={isSelected ? 1.5 : 0}
                  style={{
                    transition: "opacity 0.12s, stroke-width 0.12s",
                  }}
                />
                <text
                  x={RANGE_W - 4}
                  y={y + barH / 2 + 3}
                  fontSize={LABEL_FONT}
                  textAnchor="end"
                  fill={
                    isSelected ? "var(--color-bright)" : "var(--color-dim)"
                  }
                  fontWeight={isSelected ? 700 : 400}
                  style={{ fontFamily: "inherit" }}
                >
                  {formatVal(lo)}–{formatVal(hi)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
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
