"use client";

import { useState } from "react";
import type {
  PositionTypeCount,
  PositionType,
} from "@/lib/position-classifier";

type Props = {
  data: PositionTypeCount[];
  labels: Record<string, string>;
  emptyLabel: string;
  size?: number;
  // Multi-selezione: tipi attualmente attivi. Vuoto = nessun filtro.
  selectedTypes?: PositionType[];
  onToggleType?: (t: PositionType) => void;
};

const SIZE = 130;
const RADIUS = 52;
const INNER = 30;
const CX = SIZE / 2;
const CY = SIZE / 2;

function arc(startAngle: number, endAngle: number): string {
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

export default function PositionTypesDonut({
  data,
  labels,
  emptyLabel,
  size = SIZE,
  selectedTypes = [],
  onToggleType,
}: Props) {
  const [hovered, setHovered] = useState<PositionType | null>(null);
  const total = data.reduce((a, d) => a + d.count, 0);
  const hasSelection = selectedTypes.length > 0;
  // Centro: hover prevale; altrimenti se UNA sola fetta selezionata
  // mostro quella; se più di una mostro count aggregato.
  const focusedType =
    hovered ?? (selectedTypes.length === 1 ? selectedTypes[0] : null);
  const focused =
    focusedType != null ? data.find((d) => d.type === focusedType) : null;
  const focusedPct =
    focused && total > 0 ? Math.round((focused.count / total) * 100) : null;
  // Quando ci sono selezioni multiple, totale = somma counts selezionati
  const aggregatedCount =
    selectedTypes.length > 1
      ? data
          .filter((d) => selectedTypes.includes(d.type))
          .reduce((a, d) => a + d.count, 0)
      : null;

  if (total === 0) {
    return (
      <div
        className="text-[11px] text-[var(--color-dim)] text-center"
        style={{ width: size, height: size, display: "grid", placeItems: "center" }}
      >
        {emptyLabel}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
      }}
      onMouseLeave={() => setHovered(null)}
    >
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label="Position types"
      style={{ flexShrink: 0 }}
    >
      {(() => {
        let acc = -Math.PI / 2;
        return data.map((d) => {
          const span = (d.count / total) * 2 * Math.PI;
          const path = arc(acc, acc + span);
          acc += span;
          const isHover = hovered === d.type;
          const isSelected = selectedTypes.includes(d.type);
          // Dimming: se ci sono selezioni (e niente hover) le fette
          // NON selezionate sono attenuate. L'hover override temporaneo.
          const active = isHover || (hovered == null && isSelected);
          const dimmed =
            (hovered != null && !isHover) ||
            (hovered == null && hasSelection && !isSelected);
          return (
            <path
              key={d.type}
              d={path}
              fill={d.color}
              opacity={active ? 1 : dimmed ? 0.32 : 0.88}
              stroke="var(--color-deep)"
              strokeWidth={active ? 2 : 1}
              onMouseEnter={() => setHovered(d.type)}
              onClick={() => onToggleType?.(d.type)}
              style={{
                cursor: "pointer",
                transition: "opacity 0.15s ease, stroke-width 0.15s ease",
              }}
            >
              <title>{`${labels[d.type] ?? d.type} — ${d.count} (${Math.round((d.count / total) * 100)}%)`}</title>
            </path>
          );
        });
      })()}

      {/* Center label */}
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
          ? labels[focused.type] ?? focused.type
          : aggregatedCount != null
            ? `${selectedTypes.length} tipi`
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
        {focused ? `${focused.count}` : aggregatedCount ?? total}
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

    {/* Legenda: una riga per categoria con pallino, nome, %.
        Click toggle stessa selezione delle fette; hover evidenzia
        la fetta corrispondente. */}
    <ul
      className="flex flex-col gap-1 min-w-0"
      style={{ fontSize: 11, lineHeight: 1.2 }}
    >
      {data.map((d) => {
        const isHover = hovered === d.type;
        const isSelected = selectedTypes.includes(d.type);
        const dimmed =
          (hovered != null && !isHover) ||
          (hovered == null && hasSelection && !isSelected);
        const pct = total > 0 ? Math.round((d.count / total) * 100) : 0;
        return (
          <li
            key={d.type}
            onMouseEnter={() => setHovered(d.type)}
            onClick={() => onToggleType?.(d.type)}
            className="flex items-center gap-2 px-2 py-0.5 rounded transition-opacity"
            style={{
              cursor: onToggleType ? "pointer" : "default",
              opacity: dimmed ? 0.45 : 1,
              background: isSelected
                ? "rgba(255,255,255,0.06)"
                : "transparent",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: d.color,
                flexShrink: 0,
              }}
            />
            <span
              className="truncate"
              style={{
                color: isSelected
                  ? "var(--color-bright)"
                  : "var(--color-base)",
                fontWeight: isSelected ? 600 : 400,
              }}
              title={labels[d.type] ?? d.type}
            >
              {labels[d.type] ?? d.type}
            </span>
            <span
              className="tabular-nums"
              style={{
                marginLeft: "auto",
                color: "var(--color-muted)",
                fontWeight: 600,
              }}
            >
              {pct}%
            </span>
          </li>
        );
      })}
    </ul>
    </div>
  );
}
