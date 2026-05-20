"use client";

import { useState } from "react";
import type {
  PositionTypeCount,
  PositionType,
} from "@/lib/position-classifier";

type Props = {
  data: PositionTypeCount[];
  labels: Record<string, string>; // type key -> localized label
  title: string;
  emptyLabel: string;
};

const SIZE = 130;
const RADIUS = 52;
const INNER = 30; // donut hole
const CX = SIZE / 2;
const CY = SIZE / 2;

function arc(startAngle: number, endAngle: number): string {
  // Avoid degenerate arcs when a single slice covers 100%
  const span = endAngle - startAngle;
  if (span >= 2 * Math.PI - 1e-6) {
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

export default function PositionTypesPie({
  data,
  labels,
  title,
  emptyLabel,
}: Props) {
  const [hovered, setHovered] = useState<PositionType | null>(null);
  const total = data.reduce((a, d) => a + d.count, 0);
  const focused = hovered != null ? data.find((d) => d.type === hovered) : null;
  const focusedPct =
    focused && total > 0 ? Math.round((focused.count / total) * 100) : null;

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
        <div className="flex items-center gap-4">
          <svg
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="shrink-0"
            aria-label={title}
            role="img"
            onMouseLeave={() => setHovered(null)}
          >
            {(() => {
              let acc = -Math.PI / 2; // start at top
              return data.map((d) => {
                const span = (d.count / total) * 2 * Math.PI;
                const path = arc(acc, acc + span);
                acc += span;
                const isHover = hovered === d.type;
                const dimmed = hovered != null && !isHover;
                return (
                  <path
                    key={d.type}
                    d={path}
                    fill={d.color}
                    opacity={isHover ? 1 : dimmed ? 0.32 : 0.88}
                    stroke="var(--color-card)"
                    strokeWidth={isHover ? 1.5 : 1}
                    onMouseEnter={() => setHovered(d.type)}
                    style={{
                      cursor: "pointer",
                      transition: "opacity 0.15s ease, stroke-width 0.15s ease",
                    }}
                  >
                    <title>
                      {(labels[d.type] ?? d.type)} — {d.count} (
                      {Math.round((d.count / total) * 100)}%)
                    </title>
                  </path>
                );
              });
            })()}

            {/* Center label: mostra la slice hovered (count + pct).
                Quando nessuna e' hovered, mostra il totale. */}
            <text
              x={CX}
              y={CY - 4}
              textAnchor="middle"
              fontSize={focused ? 11 : 9}
              fill={focused ? focused.color : "var(--color-dim)"}
              fontWeight={700}
              style={{ pointerEvents: "none", fontFamily: "inherit" }}
            >
              {focused
                ? (labels[focused.type] ?? focused.type)
                : "totale"}
            </text>
            <text
              x={CX}
              y={CY + 11}
              textAnchor="middle"
              fontSize={13}
              fill="var(--color-bright)"
              fontWeight={700}
              style={{ pointerEvents: "none", fontFamily: "inherit" }}
            >
              {focused ? `${focused.count}` : `${total}`}
            </text>
            {focusedPct != null && (
              <text
                x={CX}
                y={CY + 22}
                textAnchor="middle"
                fontSize={9}
                fill="var(--color-muted)"
                style={{ pointerEvents: "none", fontFamily: "inherit" }}
              >
                {focusedPct}%
              </text>
            )}
          </svg>

          <ul
            className="flex-1 space-y-1.5 min-w-0"
            onMouseLeave={() => setHovered(null)}
          >
            {data.map((d) => {
              const pct = Math.round((d.count / total) * 100);
              const isHover = hovered === d.type;
              const dimmed = hovered != null && !isHover;
              return (
                <li
                  key={d.type}
                  onMouseEnter={() => setHovered(d.type)}
                  className="flex items-center gap-2 text-[10.5px] leading-tight rounded px-1 -mx-1 py-0.5"
                  style={{
                    cursor: "pointer",
                    background: isHover ? "var(--color-row)" : "transparent",
                    opacity: dimmed ? 0.45 : 1,
                    transition: "background 0.15s ease, opacity 0.15s ease",
                  }}
                >
                  <span
                    className="inline-block w-2 h-2 rounded-sm shrink-0"
                    style={{ background: d.color }}
                    aria-hidden
                  />
                  <span
                    className="flex-1 min-w-0"
                    style={{
                      color: isHover
                        ? "var(--color-bright)"
                        : "var(--color-muted)",
                    }}
                    title={labels[d.type] ?? d.type}
                  >
                    {labels[d.type] ?? d.type}
                  </span>
                  <span className="tabular-nums text-[var(--color-bright)] font-semibold shrink-0">
                    {d.count}
                  </span>
                  <span className="tabular-nums text-[var(--color-dim)] w-8 text-right shrink-0">
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
