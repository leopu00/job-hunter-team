"use client";

import { useState } from "react";
import { useLocale } from "@/lib/use-locale";
import { SIZE, CX, CY, arc } from "@/lib/donut-geometry";
import type { Locale } from "@/i18n/config";
import type { RoleFamilyCount } from "@/lib/position-classifier";

const T: Record<
  Locale,
  { ariaLabel: string; types: (n: number) => string; total: string }
> = {
  it: {
    ariaLabel: "Tipi di posizione",
    types: (n) => `${n} tipi`,
    total: "totale",
  },
  en: {
    ariaLabel: "Position types",
    types: (n) => `${n} types`,
    total: "total",
  },
  es: {
    ariaLabel: "Tipos de posición",
    types: (n) => `${n} tipos`,
    total: "total",
  },
  fr: {
    ariaLabel: "Types de poste",
    types: (n) => `${n} types`,
    total: "total",
  },
  de: {
    ariaLabel: "Stellentypen",
    types: (n) => `${n} Typen`,
    total: "Gesamt",
  },
  hu: {
    ariaLabel: "Pozíciótípusok",
    types: (n) => `${n} típus`,
    total: "összesen",
  },
  pt: {
    ariaLabel: "Tipos de posição",
    types: (n) => `${n} tipos`,
    total: "total",
  },
};

type Props = {
  data: RoleFamilyCount[];
  labels: Record<string, string>;
  emptyLabel: string;
  size?: number;
  // Multi-selezione: family attualmente attive. Vuoto = nessun filtro.
  // Post-dev2 refactor: family viene da positions.role_family (data-driven).
  selectedTypes?: string[];
  onToggleType?: (t: string) => void;
};

export default function PositionTypesDonut({
  data,
  labels,
  emptyLabel,
  size = SIZE,
  selectedTypes = [],
  onToggleType,
}: Props) {
  const t = T[useLocale()];
  const [hovered, setHovered] = useState<string | null>(null);
  const total = data.reduce((a, d) => a + d.count, 0);
  const hasSelection = selectedTypes.length > 0;
  // Centro: hover prevale; altrimenti se UNA sola fetta selezionata
  // mostro quella; se più di una mostro count aggregato.
  const focusedType =
    hovered ?? (selectedTypes.length === 1 ? selectedTypes[0] : null);
  const focused =
    focusedType != null ? data.find((d) => d.family === focusedType) : null;
  const focusedPct =
    focused && total > 0 ? Math.round((focused.count / total) * 100) : null;
  // Quando ci sono selezioni multiple, totale = somma counts selezionati
  const aggregatedCount =
    selectedTypes.length > 1
      ? data
          .filter((d) => selectedTypes.includes(d.family))
          .reduce((a, d) => a + d.count, 0)
      : null;

  if (total === 0) {
    return (
      <div
        className="text-[11px] text-[var(--color-dim)] text-center"
        style={{
          width: size,
          height: size,
          display: "grid",
          placeItems: "center",
        }}
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
        // width 100% + minWidth 0: il widget è vincolato alla larghezza
        // del contenitore (card /map) → la legenda non sfora, le label
        // lunghe troncano e la % resta dentro al bordo.
        width: "100%",
        minWidth: 0,
      }}
      onMouseLeave={() => setHovered(null)}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={t.ariaLabel}
        style={{ flexShrink: 0 }}
      >
        {(() => {
          let acc = -Math.PI / 2;
          return data.map((d) => {
            const span = (d.count / total) * 2 * Math.PI;
            const path = arc(acc, acc + span);
            acc += span;
            const isHover = hovered === d.family;
            const isSelected = selectedTypes.includes(d.family);
            // Le fette selezionate restano sempre evidenziate (anche
            // durante hover su altre). L'hover attenua solo le fette
            // né selezionate né hovered.
            const active = isHover || isSelected;
            const dimmed =
              (hovered != null && !isHover && !isSelected) ||
              (hovered == null && hasSelection && !isSelected);
            return (
              <path
                key={d.family}
                d={path}
                fill={d.color}
                opacity={active ? 1 : dimmed ? 0.32 : 0.88}
                stroke="var(--color-deep)"
                strokeWidth={active ? 2 : 1}
                onMouseEnter={() => setHovered(d.family)}
                onClick={() => onToggleType?.(d.family)}
                style={{
                  cursor: "pointer",
                  transition: "opacity 0.15s ease, stroke-width 0.15s ease",
                }}
              >
                <title>{`${labels[d.family] ?? d.family} — ${d.count} (${Math.round((d.count / total) * 100)}%)`}</title>
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
            ? (labels[focused.family] ?? focused.family)
            : aggregatedCount != null
              ? t.types(selectedTypes.length)
              : t.total}
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
          {focused ? `${focused.count}` : (aggregatedCount ?? total)}
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
        className="flex flex-col gap-1 min-w-0 flex-1"
        style={{ fontSize: 11, lineHeight: 1.2 }}
      >
        {data.map((d) => {
          const isHover = hovered === d.family;
          const isSelected = selectedTypes.includes(d.family);
          const dimmed =
            (hovered != null && !isHover && !isSelected) ||
            (hovered == null && hasSelection && !isSelected);
          return (
            <li
              key={d.family}
              onMouseEnter={() => setHovered(d.family)}
              onClick={() => onToggleType?.(d.family)}
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
                title={labels[d.family] ?? d.family}
              >
                {labels[d.family] ?? d.family}
              </span>
              <span
                className="tabular-nums"
                style={{
                  marginLeft: "auto",
                  color: "var(--color-muted)",
                  fontWeight: 600,
                }}
              >
                {d.count}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
