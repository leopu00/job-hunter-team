"use client";

import { useState } from "react";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import type { RoleFamilyCount } from "@/lib/position-classifier";

const T: Record<
  Locale,
  {
    selected: string;
    total: string;
    type: string;
    avgScoreRange: string;
    avgScoreScoredOnly: string;
  }
> = {
  it: {
    selected: "selezionate",
    total: "totale",
    type: "tipo",
    avgScoreRange: "Score medio (0-100)",
    avgScoreScoredOnly: "Score medio (0-100, solo posizioni scorate)",
  },
  en: {
    selected: "selected",
    total: "total",
    type: "type",
    avgScoreRange: "Average score (0-100)",
    avgScoreScoredOnly: "Average score (0-100, scored positions only)",
  },
  es: {
    selected: "seleccionadas",
    total: "total",
    type: "tipo",
    avgScoreRange: "Score medio (0-100)",
    avgScoreScoredOnly: "Score medio (0-100, solo posiciones puntuadas)",
  },
  fr: {
    selected: "sélectionnées",
    total: "total",
    type: "type",
    avgScoreRange: "Score moyen (0-100)",
    avgScoreScoredOnly: "Score moyen (0-100, postes notés uniquement)",
  },
  de: {
    selected: "ausgewählt",
    total: "Gesamt",
    type: "Typ",
    avgScoreRange: "Durchschnitts-Score (0-100)",
    avgScoreScoredOnly: "Durchschnitts-Score (0-100, nur bewertete Stellen)",
  },
  hu: {
    selected: "kiválasztva",
    total: "összesen",
    type: "típus",
    avgScoreRange: "Átlagos score (0-100)",
    avgScoreScoredOnly: "Átlagos score (0-100, csak pontozott pozíciók)",
  },
  pt: {
    selected: "selecionadas",
    total: "total",
    type: "tipo",
    avgScoreRange: "Score médio (0-100)",
    avgScoreScoredOnly: "Score médio (0-100, apenas posições pontuadas)",
  },
};

// Etichetta colonna "score medio" della legenda (è la media, non lo score di
// una singola posizione). Compatta per stare nella colonna stretta.
const AVG_LABEL: Record<string, string> = {
  it: "media score",
  en: "avg score",
  hu: "átl. pont",
  es: "media score",
  de: "Ø score",
  fr: "score moy",
  pt: "média score",
};

type Props = {
  data: RoleFamilyCount[];
  // Override opzionale family-name -> label localizzata. Se assente,
  // il nome family viene mostrato cosi' com'e' (e' il valore della colonna
  // positions.role_family, gia' leggibile dall'utente).
  labels?: Record<string, string>;
  title: string;
  emptyLabel: string;
  size?: number; // px reso. viewBox scala tutta la geometria interna.
  // Cross-filtering: family attualmente selezionate + callback toggle.
  // Vuoto/assente = grafico non interattivo (comportamento storico).
  selectedTypes?: string[];
  onToggleType?: (family: string) => void;
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
  size = SIZE,
  selectedTypes = [],
  onToggleType,
}: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const locale = useLocale();
  const t = T[locale];
  const avgLabel = AVG_LABEL[locale] ?? AVG_LABEL.en;
  const labelFor = (family: string) => labels?.[family] ?? family;
  const total = data.reduce((a, d) => a + d.count, 0);
  // Per la barra proporzionale di ogni riga (riempie lo spazio orizzontale
  // della legenda, prima vuoto): larghezza relativa al tipo più numeroso.
  const maxCount = data.reduce((m, d) => Math.max(m, d.count), 0) || 1;
  const hasSelection = selectedTypes.length > 0;
  // Centro: hover prevale; altrimenti se UNA sola family selezionata la mostro.
  const focusedFamily =
    hovered ?? (selectedTypes.length === 1 ? selectedTypes[0] : null);
  const focused =
    focusedFamily != null ? data.find((d) => d.family === focusedFamily) : null;
  const focusedPct =
    focused && total > 0 ? Math.round((focused.count / total) * 100) : null;

  // Centro del donut: con UNA family in focus (hover o singola selezione)
  // mostra quella; con PIÙ family selezionate mostra la somma dei selezionati
  // ("selezionate" + N) invece del totale; senza selezione mostra il totale.
  const selectedCount = data
    .filter((d) => selectedTypes.includes(d.family))
    .reduce((a, d) => a + d.count, 0);
  const showSelected = !focused && selectedTypes.length > 1;
  const centerLabel = focused
    ? labelFor(focused.family)
    : showSelected
      ? t.selected
      : t.total;
  const centerValue = focused
    ? focused.count
    : showSelected
      ? selectedCount
      : total;
  const centerPct = focused
    ? focusedPct
    : showSelected && total > 0
      ? Math.round((selectedCount / total) * 100)
      : null;

  return (
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 transition-colors duration-200 hover:border-[var(--color-border-glow)]">
      <div className="flex items-center justify-between mb-4">
        <span className="section-label">{title}</span>
        {total > 0 && (
          <span className="text-[11px] font-semibold text-[var(--color-muted)]">
            {selectedTypes.length >= 1 ? selectedCount : total}
          </span>
        )}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
        <div
          className="relative shrink-0 self-center sm:self-auto"
          style={{ width: size, maxWidth: "100%", aspectRatio: "1 / 1" }}
        >
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            aria-label={title}
            role="img"
            onMouseLeave={() => setHovered(null)}
          >
            <circle
              cx={CX}
              cy={CY}
              r={(RADIUS + INNER) / 2}
              fill="none"
              stroke="var(--color-border)"
              strokeWidth={RADIUS - INNER}
              opacity={total === 0 ? 0.5 : 0}
            />
            {(() => {
              let acc = -Math.PI / 2; // start at top
              return data.map((d) => {
                const span = (d.count / total) * 2 * Math.PI;
                const path = arc(acc, acc + span);
                acc += span;
                const isHover = hovered === d.family;
                const isSelected = selectedTypes.includes(d.family);
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
                    stroke="var(--color-card)"
                    strokeWidth={active ? 1.5 : 1}
                    onMouseEnter={() => setHovered(d.family)}
                    onClick={() => onToggleType?.(d.family)}
                    style={{
                      cursor: onToggleType ? "pointer" : "default",
                      transition: "opacity 0.15s ease, stroke-width 0.15s ease",
                    }}
                  >
                    <title>{`${labelFor(d.family)} — ${d.count} (${Math.round((d.count / total) * 100)}%)`}</title>
                  </path>
                );
              });
            })()}
          </svg>

          {/* Etichetta centrale come overlay HTML: vincolata alla larghezza del
            foro del donut (wrapping su 2 righe + ellissi), così i nomi lunghi
            non escono dal donut. Sfondo scuro del foro = sempre leggibile,
            anche se il colore family coincide con una fetta. pointer-events
            disabilitati per non rubare l'hover alle fette sotto. */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-1">
            <div
              className="font-bold leading-tight line-clamp-2"
              style={{
                // ~diametro del foro relativo al donut (scala col responsive)
                maxWidth: `${((INNER * 2) / SIZE) * 100}%`,
                fontSize: 14,
                color: focused ? focused.color : "var(--color-dim)",
              }}
              title={centerLabel}
            >
              {centerLabel}
            </div>
            <div
              className="font-bold leading-none text-[var(--color-bright)]"
              style={{ fontSize: 32, marginTop: 4 }}
            >
              {centerValue}
            </div>
            {centerPct != null && (
              <div
                className="text-[var(--color-muted)]"
                style={{ fontSize: 13, marginTop: 2 }}
              >
                {centerPct}%
              </div>
            )}
          </div>
        </div>

        <ul
          className="space-y-3 min-w-0 flex-1"
          onMouseLeave={() => setHovered(null)}
        >
          {/* Header: didascalia colonne. Colonna 'tipo' a larghezza limitata +
                colonna barra flessibile (1fr) che riempie lo spazio prima vuoto. */}
          <li
            className="grid grid-cols-[minmax(90px,14rem)_1fr_2.5rem_2.5rem_4rem] gap-3 items-center text-[9px] font-semibold tracking-[0.14em] uppercase text-[var(--color-dim)] pb-1.5 border-b border-[var(--color-border)]"
            aria-hidden
          >
            <span>{t.type}</span>
            <span />
            <span>n</span>
            <span>%</span>
            <span className="text-center leading-tight" title={t.avgScoreRange}>
              {avgLabel}
            </span>
          </li>
          {data.map((d) => {
            const pct = Math.round((d.count / total) * 100);
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
                className="grid grid-cols-[minmax(90px,14rem)_1fr_2.5rem_2.5rem_4rem] gap-3 items-center text-[11.5px] leading-tight rounded px-1 -mx-1 py-1"
                style={{
                  cursor: onToggleType ? "pointer" : "default",
                  background: isSelected
                    ? "rgba(255,255,255,0.06)"
                    : isHover
                      ? "var(--color-row)"
                      : "transparent",
                  opacity: dimmed ? 0.45 : 1,
                  transition: "background 0.15s ease, opacity 0.15s ease",
                }}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className="inline-block w-2 h-2 rounded-sm shrink-0"
                    style={{ background: d.color }}
                    aria-hidden
                  />
                  <span
                    className="truncate"
                    style={{
                      color:
                        isHover || isSelected
                          ? "var(--color-bright)"
                          : "var(--color-muted)",
                      fontWeight: isSelected ? 600 : 400,
                    }}
                    title={labelFor(d.family)}
                  >
                    {labelFor(d.family)}
                  </span>
                </span>
                {/* Barra proporzionale: riempie lo spazio orizzontale prima
                    vuoto e dà un colpo d'occhio sulla distribuzione. */}
                <span
                  className="block h-2 rounded-full overflow-hidden"
                  style={{ background: "var(--color-border)" }}
                  aria-hidden
                >
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${(d.count / maxCount) * 100}%`,
                      background: d.color,
                      opacity: dimmed ? 0.4 : 0.85,
                    }}
                  />
                </span>
                <span className="tabular-nums text-[var(--color-bright)] font-semibold">
                  {d.count}
                </span>
                <span className="tabular-nums text-[var(--color-dim)]">
                  {pct}%
                </span>
                <span
                  className="tabular-nums text-center"
                  title={t.avgScoreScoredOnly}
                  style={{
                    color:
                      d.avgScore == null
                        ? "var(--color-dim)"
                        : d.avgScore >= 75
                          ? "var(--color-green)"
                          : d.avgScore >= 55
                            ? "var(--color-yellow)"
                            : "var(--color-red)",
                  }}
                >
                  {d.avgScore == null ? "—" : `${Math.round(d.avgScore)}`}
                </span>
              </li>
            );
          })}
          {data.length === 0 && (
            <li className="text-[10px] text-[var(--color-dim)] italic py-2">
              {emptyLabel}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
