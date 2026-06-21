"use client";

import { useState } from "react";
import { formatMoneyCompact } from "@/lib/exchange-rates";

type Props = {
  // Valori SEMPRE in EUR (il binning è in EUR così la forma non dipende dalla
  // valuta visualizzata; converte solo le etichette via `convert`).
  data: number[];
  title: string;
  emptyLabel: string;
  // Larghezza fascia in EUR (default 20k).
  bandStep?: number;
  // EUR → valuta di visualizzazione (valore pieno) + simbolo per le etichette.
  convert: (eur: number) => number;
  symbol: string;
  // Cross-filter: estremi inferiori (EUR) delle fasce selezionate + toggle.
  selectedBands?: number[];
  onToggleBand?: (lo: number) => void;
  // Contenuto extra nell'header (es. selettore valuta).
  headerExtra?: React.ReactNode;
  accent?: string;
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi
    ? sorted[lo]
    : sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
}

export default function SalaryBars({
  data,
  title,
  emptyLabel,
  bandStep = 20000,
  convert,
  symbol,
  selectedBands = [],
  onToggleBand,
  headerExtra,
  accent = "var(--color-green)",
}: Props) {
  const [hovered, setHovered] = useState<number | null>(null);

  const n = data.length;
  const hasSelection = selectedBands.length > 0;

  // Conteggio per fascia.
  const counts = new Map<number, number>();
  for (const v of data) {
    const lo = Math.floor(v / bandStep) * bandStep;
    counts.set(lo, (counts.get(lo) ?? 0) + 1);
  }
  const los = Array.from(counts.keys()).sort((a, b) => a - b);
  // Fasce continue da prima a ultima non vuota (incluse eventuali vuote).
  const bands: { lo: number; count: number }[] = [];
  if (los.length > 0) {
    for (let lo = los[0]; lo <= los[los.length - 1]; lo += bandStep)
      bands.push({ lo, count: counts.get(lo) ?? 0 });
  }
  const maxCount = bands.reduce((m, b) => Math.max(m, b.count), 0);

  const sorted = [...data].sort((a, b) => a - b);
  const avg = n > 0 ? sorted.reduce((s, v) => s + v, 0) / n : 0;
  const med = percentile(sorted, 0.5);
  const fmt = (eur: number) => formatMoneyCompact(convert(eur));
  const bandLabel = (lo: number) => `${symbol}${fmt(lo)}–${fmt(lo + bandStep)}`;

  return (
    <div className="h-full flex flex-col bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 transition-colors duration-200 hover:border-[var(--color-border-glow)]">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <span className="section-label flex items-center gap-3">
          {title}
          {headerExtra}
        </span>
        {n > 0 && (
          <div className="flex items-center gap-3 text-[10px] text-[var(--color-muted)] tabular-nums">
            <span>
              <span className="text-[var(--color-dim)]">avg</span>{" "}
              <span className="font-semibold" style={{ color: accent }}>
                {symbol}
                {fmt(avg)}
              </span>
            </span>
            <span>
              <span className="text-[var(--color-dim)]">med</span>{" "}
              <span className="font-semibold text-[var(--color-bright)]">
                {symbol}
                {fmt(med)}
              </span>
            </span>
            <span>
              <span className="text-[var(--color-dim)]">n</span>{" "}
              <span className="font-semibold text-[var(--color-bright)]">
                {n}
              </span>
            </span>
          </div>
        )}
      </div>

      {n === 0 ? (
        <div className="flex items-center justify-center text-[11px] text-[var(--color-dim)] italic h-[120px]">
          {emptyLabel}
        </div>
      ) : (
        <ul
          className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5 pr-1"
          onMouseLeave={() => setHovered(null)}
        >
          {bands.map((b) => {
            const pct = n > 0 ? Math.round((b.count / n) * 100) : 0;
            const barPct = maxCount > 0 ? (b.count / maxCount) * 100 : 0;
            const isHover = hovered === b.lo;
            const isSelected = selectedBands.includes(b.lo);
            const dimmed =
              (hovered != null && !isHover && !isSelected) ||
              (hovered == null && hasSelection && !isSelected);
            return (
              <li
                key={b.lo}
                onMouseEnter={() => setHovered(b.lo)}
                onClick={onToggleBand ? () => onToggleBand(b.lo) : undefined}
                className="grid grid-cols-[6.5rem_1fr_2rem_2.25rem] gap-3 items-center text-[10.5px] leading-tight rounded px-1 -mx-1 py-0.5"
                style={{
                  cursor: onToggleBand ? "pointer" : "default",
                  background: isSelected
                    ? "rgba(255,255,255,0.06)"
                    : isHover && onToggleBand
                      ? "var(--color-row)"
                      : "transparent",
                  opacity: dimmed ? 0.4 : 1,
                  transition: "background 0.15s ease, opacity 0.15s ease",
                }}
              >
                <span
                  className="tabular-nums truncate"
                  style={{
                    color:
                      isSelected || isHover
                        ? "var(--color-bright)"
                        : "var(--color-muted)",
                    fontWeight: isSelected ? 600 : 400,
                  }}
                >
                  {bandLabel(b.lo)}
                </span>
                <span className="h-2 rounded-full bg-[var(--color-border)] overflow-hidden">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${barPct}%`,
                      background: accent,
                      opacity: 0.85,
                      transition: "width 0.3s ease",
                    }}
                  />
                </span>
                <span className="tabular-nums text-[var(--color-bright)] font-semibold text-right">
                  {b.count}
                </span>
                <span className="tabular-nums text-[var(--color-dim)] text-right">
                  {pct}%
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
