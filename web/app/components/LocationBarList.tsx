"use client";

import { useState } from "react";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

const MORE: Record<Locale, (n: number) => string> = {
  it: (n) => `+${n} altri`,
  en: (n) => `+${n} more`,
  es: (n) => `+${n} más`,
  fr: (n) => `+${n} autres`,
  de: (n) => `+${n} weitere`,
  hu: (n) => `+${n} további`,
  pt: (n) => `+${n} mais`,
};

export type LocationBarItem = {
  // Chiave univoca (es. country, oppure "Country|City").
  key: string;
  label: string;
  // Contesto secondario in dim accanto al label (es. il paese per una città).
  sublabel?: string;
  count: number;
  // Riga "spenta" — es. senza paese / senza città. Resa in corsivo/dim.
  muted?: boolean;
  // false = riga non filtrabile (es. aggregato "senza città" che non è una
  // singola chiave). Default true quando onToggle è presente.
  selectable?: boolean;
};

type Props = {
  // Già ordinati per rilevanza (count desc), muted in fondo.
  items: LocationBarItem[];
  title: string;
  emptyLabel: string;
  // Numero mostrato nell'header (es. quanti paesi/città distinti).
  headerCount?: number;
  // Quante righe mostrare prima di collassare il resto in "+N altri".
  maxRows?: number;
  // Cross-filtering: chiavi attualmente selezionate + callback toggle.
  selectedKeys?: string[];
  onToggle?: (key: string) => void;
};

// La lista scorre dentro la card. Il tetto max-h serve sotto lg: lì l'altezza
// della card non è imposta da nessuno (la griglia della dashboard usa
// auto-rows-[260px] solo da lg in su), quindi con maxRows=100 le righe si
// srotolavano tutte a schermo invece di scrollare nella loro box. Da lg in su
// comanda di nuovo il parent. overscroll-contain: su iOS lo scroll di fine
// lista non trascina la pagina.
const LIST_CLASS =
  "flex-1 min-h-0 max-h-[300px] lg:max-h-none overflow-y-auto overscroll-y-contain space-y-1.5 pr-1";

export default function LocationBarList({
  items,
  title,
  emptyLabel,
  headerCount,
  maxRows = 12,
  selectedKeys = [],
  onToggle,
}: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const more = MORE[useLocale()];

  const total = items.reduce((a, d) => a + d.count, 0);
  const hasSelection = selectedKeys.length > 0;

  const visible = items.slice(0, maxRows);
  const rest = items.slice(maxRows);
  const restCount = rest.reduce((a, d) => a + d.count, 0);

  return (
    <div className="h-full flex flex-col bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 transition-colors duration-200 hover:border-[var(--color-border-glow)]">
      <div className="flex items-center justify-between mb-4">
        <span className="section-label">{title}</span>
        {total > 0 && headerCount != null && (
          <span className="text-[11px] font-semibold text-[var(--color-muted)]">
            {headerCount}
          </span>
        )}
      </div>

      {total === 0 ? (
        <div className="flex-1 flex items-center text-[10px] text-[var(--color-dim)] italic py-2">
          {emptyLabel}
        </div>
      ) : (
        <ul className={LIST_CLASS} onMouseLeave={() => setHovered(null)}>
          {visible.map((d) => {
            const pct = total > 0 ? Math.round((d.count / total) * 100) : 0;
            const isHover = hovered === d.key;
            const isSelected = selectedKeys.includes(d.key);
            const canSelect = onToggle != null && (d.selectable ?? true);
            // Le righe selezionate restano attive; l'hover o una selezione su
            // altre righe attenua le non-attive.
            const dimmed =
              (hovered != null && !isHover && !isSelected) ||
              (hovered == null && hasSelection && !isSelected);
            return (
              <li
                key={d.key}
                onMouseEnter={() => setHovered(d.key)}
                onClick={canSelect ? () => onToggle?.(d.key) : undefined}
                className="grid grid-cols-[1fr_2.5rem_2.25rem] gap-3 items-center text-[10.5px] leading-tight rounded px-1 -mx-1 py-0.5"
                style={{
                  cursor: canSelect ? "pointer" : "default",
                  background: isSelected
                    ? "rgba(255,255,255,0.06)"
                    : isHover && canSelect
                      ? "var(--color-row)"
                      : "transparent",
                  opacity: dimmed ? 0.4 : 1,
                  transition: "background 0.15s ease, opacity 0.15s ease",
                }}
              >
                <span className="truncate flex items-baseline gap-1.5 min-w-0">
                  <span
                    className="truncate"
                    style={{
                      color: d.muted
                        ? "var(--color-dim)"
                        : isSelected || isHover
                          ? "var(--color-bright)"
                          : "var(--color-muted)",
                      fontStyle: d.muted ? "italic" : "normal",
                      fontWeight: isSelected ? 600 : 400,
                    }}
                    title={d.sublabel ? `${d.label} · ${d.sublabel}` : d.label}
                  >
                    {d.label}
                  </span>
                  {d.sublabel && (
                    <span className="shrink-0 text-[9px] text-[var(--color-dim)] truncate">
                      {d.sublabel}
                    </span>
                  )}
                </span>
                <span className="tabular-nums text-[var(--color-bright)] font-semibold text-right">
                  {d.count}
                </span>
                <span className="tabular-nums text-[var(--color-dim)] text-right">
                  {pct}%
                </span>
              </li>
            );
          })}
          {rest.length > 0 && (
            <li className="grid grid-cols-[1fr_2.5rem_2.25rem] gap-3 items-center text-[10.5px] leading-tight px-1 -mx-1 py-0.5">
              <span className="truncate italic text-[var(--color-dim)]">
                {more(rest.length)}
              </span>
              <span className="tabular-nums text-[var(--color-muted)] font-semibold text-right">
                {restCount}
              </span>
              <span className="tabular-nums text-[var(--color-dim)] text-right">
                {total > 0 ? Math.round((restCount / total) * 100) : 0}%
              </span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
