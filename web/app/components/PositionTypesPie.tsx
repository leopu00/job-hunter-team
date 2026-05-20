"use client";

import type { PositionTypeCount } from "@/lib/position-classifier";

type Props = {
  data: PositionTypeCount[];
  labels: Record<string, string>; // type key -> localized label
  title: string;
  emptyLabel: string;
};

const SIZE = 160;
const RADIUS = 64;
const INNER = 38; // donut hole
const CX = SIZE / 2;
const CY = SIZE / 2;

function arc(startAngle: number, endAngle: number): string {
  // Avoid degenerate arcs when a single slice covers 100%
  const span = endAngle - startAngle;
  if (span >= 2 * Math.PI - 1e-6) {
    // full ring as two half-arcs
    const xR = CX + RADIUS;
    const xL = CX - RADIUS;
    const yC = CY;
    const xRi = CX + INNER;
    const xLi = CX - INNER;
    return [
      `M ${xR} ${yC}`,
      `A ${RADIUS} ${RADIUS} 0 1 1 ${xL} ${yC}`,
      `A ${RADIUS} ${RADIUS} 0 1 1 ${xR} ${yC}`,
      `M ${xRi} ${yC}`,
      `A ${INNER} ${INNER} 0 1 0 ${xLi} ${yC}`,
      `A ${INNER} ${INNER} 0 1 0 ${xRi} ${yC}`,
      "Z",
    ].join(" ");
  }
  const x1 = CX + RADIUS * Math.cos(startAngle);
  const y1 = CY + RADIUS * Math.sin(startAngle);
  const x2 = CX + RADIUS * Math.cos(endAngle);
  const y2 = CY + RADIUS * Math.sin(endAngle);
  const xi2 = CX + INNER * Math.cos(endAngle);
  const yi2 = CY + INNER * Math.sin(endAngle);
  const xi1 = CX + INNER * Math.cos(startAngle);
  const yi1 = CY + INNER * Math.sin(startAngle);
  const large = span > Math.PI ? 1 : 0;
  return [
    `M ${x1} ${y1}`,
    `A ${RADIUS} ${RADIUS} 0 ${large} 1 ${x2} ${y2}`,
    `L ${xi2} ${yi2}`,
    `A ${INNER} ${INNER} 0 ${large} 0 ${xi1} ${yi1}`,
    "Z",
  ].join(" ");
}

export default function PositionTypesPie({ data, labels, title, emptyLabel }: Props) {
  const total = data.reduce((a, d) => a + d.count, 0);

  return (
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 transition-colors duration-200 hover:border-[var(--color-border-glow)]">
      <div className="flex items-center justify-between mb-4">
        <span className="section-label">{title}</span>
        {total > 0 && (
          <span className="text-[11px] font-semibold text-[var(--color-muted)]">
            {total}
          </span>
        )}
      </div>

      {total === 0 ? (
        <p className="text-[11px] text-[var(--color-dim)]">{emptyLabel}</p>
      ) : (
        <div className="flex items-center gap-5">
          <svg
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="shrink-0"
            aria-label={title}
            role="img"
          >
            {(() => {
              let acc = -Math.PI / 2; // start at top
              return data.map((d) => {
                const span = (d.count / total) * 2 * Math.PI;
                const path = arc(acc, acc + span);
                acc += span;
                return (
                  <path
                    key={d.type}
                    d={path}
                    fill={d.color}
                    opacity={0.88}
                    stroke="var(--color-card)"
                    strokeWidth={1}
                  />
                );
              });
            })()}
          </svg>

          <ul className="flex-1 space-y-1.5 min-w-0">
            {data.map((d) => {
              const pct = Math.round((d.count / total) * 100);
              return (
                <li
                  key={d.type}
                  className="flex items-center gap-2 text-[10.5px]"
                >
                  <span
                    className="inline-block w-2 h-2 rounded-sm shrink-0"
                    style={{ background: d.color }}
                    aria-hidden
                  />
                  <span
                    className="flex-1 truncate text-[var(--color-muted)]"
                    title={labels[d.type] ?? d.type}
                  >
                    {labels[d.type] ?? d.type}
                  </span>
                  <span className="tabular-nums text-[var(--color-bright)] font-semibold">
                    {d.count}
                  </span>
                  <span className="tabular-nums text-[var(--color-dim)] w-8 text-right">
                    {pct}%
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
