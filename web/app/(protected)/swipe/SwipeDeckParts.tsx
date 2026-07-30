"use client";

// Le foglie presentazionali di `SwipeDeck.tsx`: nessuno stato, nessun hook,
// nessuna dipendenza dal mazzo — solo props in, JSX out. Stavano già fuori
// dalla funzione `SwipeDeck`, ma in coda allo stesso file, dove allungavano
// la strada per arrivare al componente vero.
//
// Il gesto di swipe e i suoi effetti restano in `SwipeDeck.tsx`: quelli
// dipendono dal timing dei rerender e non si verificano coi test.

import { IconChevronRight } from "./icons";

// Sezione collassabile della schermata filtri: header con label,
// valore/selezione corrente a destra (viola quando il filtro è attivo)
// e chevron che ruota. Solo gli slider partono aperti.
export function FilterSection({
  label,
  meta,
  metaActive = false,
  open,
  onToggle,
  children,
}: {
  label: string;
  meta?: string;
  metaActive?: boolean;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b" style={{ borderColor: "var(--color-border)" }}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between py-3"
        style={{ background: "none", border: "none", cursor: "pointer" }}
        aria-expanded={open}
      >
        <span className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)]">
          {label}
        </span>
        <span className="flex items-center gap-2">
          {meta && (
            <span
              className="text-[11px] font-semibold tabular-nums"
              style={{
                color: metaActive
                  ? "var(--color-purple)"
                  : "var(--color-muted)",
              }}
            >
              {meta}
            </span>
          )}
          <span
            style={{
              color: "var(--color-dim)",
              display: "inline-flex",
              transform: open ? "rotate(90deg)" : "none",
              transition: "transform 0.15s ease",
            }}
            aria-hidden="true"
          >
            <IconChevronRight size={14} />
          </span>
        </span>
      </button>
      {open && <div className="pb-4">{children}</div>}
    </div>
  );
}

// Slider a DOPPIO cursore su una traccia sola (l'HTML nativo non ce l'ha:
// due <input type=range> sovrapposti con traccia trasparente e pointer-events
// solo sui pomelli) + istogramma della distribuzione sopra la traccia, con i
// bin dentro il range selezionato evidenziati (stile filtro-prezzo Airbnb).
export function DualRange({
  min,
  max,
  step,
  lo,
  hi,
  onChange,
  histo,
}: {
  min: number;
  max: number;
  step: number;
  lo: number;
  hi: number;
  onChange: (lo: number, hi: number) => void;
  histo?: number[];
}) {
  const pct = (v: number) => ((v - min) / (max - min)) * 100;
  const maxBin = histo && histo.length ? Math.max(...histo, 1) : 1;
  return (
    <div>
      {histo && (
        <div className="mb-1 flex h-10 items-end gap-[2px] px-1">
          {histo.map((n, i) => {
            const bLo = min + i * ((max - min) / histo.length);
            const bHi = bLo + (max - min) / histo.length;
            const inRange = bHi > lo && bLo < hi;
            return (
              <div
                key={i}
                className="flex-1 rounded-sm"
                style={{
                  height: `${Math.max((n / maxBin) * 100, n > 0 ? 8 : 2)}%`,
                  background: inRange
                    ? "var(--color-purple)"
                    : "var(--color-border)",
                  opacity: inRange ? 0.9 : 0.7,
                }}
              />
            );
          })}
        </div>
      )}
      <div className="relative h-9">
        <div
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full"
          style={{ left: 12, right: 12, background: "var(--color-border)" }}
        />
        {/* Il centro del pomello viaggia tra 12px e (100% - 12px), non da
            bordo a bordo: il riempimento segue la STESSA geometria, sennò
            sborda oltre i pomelli. */}
        <div
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full"
          style={{
            left: `calc((100% - 24px) * ${pct(lo) / 100} + 12px)`,
            right: `calc((100% - 24px) * ${(100 - pct(hi)) / 100} + 12px)`,
            background: "var(--color-purple)",
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={lo}
          aria-label="min"
          onChange={(e) => onChange(Math.min(Number(e.target.value), hi), hi)}
          className="jht-dualrange absolute inset-0 h-full w-full"
          // Se entrambi i pomelli sono a fondo scala destro, il min deve
          // stare sopra per restare afferrabile.
          style={{ zIndex: lo > min + (max - min) / 2 ? 5 : 3 }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={hi}
          aria-label="max"
          onChange={(e) => onChange(lo, Math.max(Number(e.target.value), lo))}
          className="jht-dualrange absolute inset-0 h-full w-full"
          style={{ zIndex: 4 }}
        />
      </div>
      <style>{`
        .jht-dualrange {
          -webkit-appearance: none;
          appearance: none;
          background: transparent;
          pointer-events: none;
          margin: 0;
          border: none;
          outline: none;
        }
        .jht-dualrange::-webkit-slider-runnable-track {
          -webkit-appearance: none;
          background: transparent;
        }
        .jht-dualrange::-webkit-slider-thumb {
          -webkit-appearance: none;
          pointer-events: auto;
          width: 24px;
          height: 24px;
          margin-top: 6px;
          border-radius: 9999px;
          background: #fff;
          border: 1px solid var(--color-border);
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
          cursor: pointer;
        }
        .jht-dualrange::-moz-range-track {
          background: transparent;
        }
        .jht-dualrange::-moz-range-thumb {
          pointer-events: auto;
          width: 22px;
          height: 22px;
          border-radius: 9999px;
          background: #fff;
          border: 1px solid var(--color-border);
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}

export function Chip({
  children,
  color,
}: {
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <span
      className="px-2 py-0.5 rounded-full border"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-row)",
        color: color ?? "var(--color-base)",
      }}
    >
      {children}
    </span>
  );
}
