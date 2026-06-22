"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

export type Bin = { lo: number; hi: number; count: number };
export type Range = { lo: number; hi: number };

const T: Record<
  Locale,
  {
    noValue: string;
    noData: string;
    histogramAria: string;
    clickAnother: string;
    lowerLimit: string;
    upperLimit: string;
    rangeStart: string;
    rangeEnd: string;
    resetRange: string;
    reset: string;
  }
> = {
  it: {
    noValue: "senza valore",
    noData: "Nessun dato",
    histogramAria: "Istogramma: clicca una barra e poi un'altra per il range",
    clickAnother: "Clicca un'altra barra per chiudere il range…",
    lowerLimit: "Limite inferiore",
    upperLimit: "Limite superiore",
    rangeStart: "Inizio range",
    rangeEnd: "Fine range",
    resetRange: "Azzera range",
    reset: "Azzera",
  },
  en: {
    noValue: "no value",
    noData: "No data",
    histogramAria: "Histogram: click a bar and then another to set the range",
    clickAnother: "Click another bar to close the range…",
    lowerLimit: "Lower limit",
    upperLimit: "Upper limit",
    rangeStart: "Range start",
    rangeEnd: "Range end",
    resetRange: "Reset range",
    reset: "Reset",
  },
  es: {
    noValue: "sin valor",
    noData: "Sin datos",
    histogramAria:
      "Histograma: haz clic en una barra y luego en otra para el rango",
    clickAnother: "Haz clic en otra barra para cerrar el rango…",
    lowerLimit: "Límite inferior",
    upperLimit: "Límite superior",
    rangeStart: "Inicio del rango",
    rangeEnd: "Fin del rango",
    resetRange: "Restablecer rango",
    reset: "Restablecer",
  },
  fr: {
    noValue: "sans valeur",
    noData: "Aucune donnée",
    histogramAria:
      "Histogramme : cliquez sur une barre puis sur une autre pour la plage",
    clickAnother: "Cliquez sur une autre barre pour fermer la plage…",
    lowerLimit: "Limite inférieure",
    upperLimit: "Limite supérieure",
    rangeStart: "Début de la plage",
    rangeEnd: "Fin de la plage",
    resetRange: "Réinitialiser la plage",
    reset: "Réinitialiser",
  },
  de: {
    noValue: "ohne Wert",
    noData: "Keine Daten",
    histogramAria:
      "Histogramm: Klicke auf einen Balken und dann auf einen anderen für den Bereich",
    clickAnother:
      "Klicke auf einen anderen Balken, um den Bereich zu schließen…",
    lowerLimit: "Untere Grenze",
    upperLimit: "Obere Grenze",
    rangeStart: "Bereichsanfang",
    rangeEnd: "Bereichsende",
    resetRange: "Bereich zurücksetzen",
    reset: "Zurücksetzen",
  },
  hu: {
    noValue: "érték nélkül",
    noData: "Nincs adat",
    histogramAria:
      "Hisztogram: kattints egy oszlopra, majd egy másikra a tartományhoz",
    clickAnother: "Kattints egy másik oszlopra a tartomány lezárásához…",
    lowerLimit: "Alsó határ",
    upperLimit: "Felső határ",
    rangeStart: "Tartomány eleje",
    rangeEnd: "Tartomány vége",
    resetRange: "Tartomány törlése",
    reset: "Törlés",
  },
  pt: {
    noValue: "sem valor",
    noData: "Sem dados",
    histogramAria:
      "Histograma: clica numa barra e depois noutra para o intervalo",
    clickAnother: "Clica noutra barra para fechar o intervalo…",
    lowerLimit: "Limite inferior",
    upperLimit: "Limite superior",
    rangeStart: "Início do intervalo",
    rangeEnd: "Fim do intervalo",
    resetRange: "Limpar intervalo",
    reset: "Limpar",
  },
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

/**
 * Costruisce i bin di un istogramma facendo AUTO-FIT al range realmente
 * presente nei dati: niente code vuote a sinistra/destra. Es. se i valori
 * stanno tra 4.2 e 9.1 con step 0.5, i bin partono da 4.0 e finiscono a 9.0.
 */
export function buildBins(values: number[], step: number): Bin[] {
  const present = values.filter(
    (v) => typeof v === "number" && !Number.isNaN(v),
  );
  if (!present.length) return [];
  const lo = Math.min(...present);
  const hi = Math.max(...present);
  const start = Math.floor(lo / step) * step;
  const end = Math.floor(hi / step) * step; // lo dell'ultimo bin
  const bins: Bin[] = [];
  for (let b = start; b <= end + 1e-6; b = r3(b + step)) {
    const binLo = r3(b);
    const binHi = r3(b + step);
    const isLast = b >= end - 1e-6;
    const count = present.filter(
      (v) =>
        v >= binLo - 1e-6 && (isLast ? v <= binHi + 1e-6 : v < binHi - 1e-6),
    ).length;
    bins.push({ lo: binLo, hi: binHi, count });
  }
  return bins;
}

/**
 * Istogramma a barre con selezione di un range contiguo. Tre modi (sinergici):
 *  1. click su una barra, poi un'altra → range tra le due (anchor a 2 click)
 *  2. slider orizzontale a due maniglie sotto le barre (calibra lo/hi col mouse)
 *  3. due input numerici per un valore preciso
 */
export default function RangeHistogram({
  bins,
  value,
  onChange,
  decimals = 0,
  unscoredCount = 0,
  unscoredSelected = false,
  onToggleUnscored,
  unscoredLabel,
}: {
  bins: Bin[];
  value: Range | null;
  onChange: (range: Range | null) => void;
  decimals?: number;
  unscoredCount?: number;
  unscoredSelected?: boolean;
  onToggleUnscored?: () => void;
  unscoredLabel?: string;
}) {
  const t = T[useLocale()];
  const [anchor, setAnchor] = useState<number | null>(null);
  const [loStr, setLoStr] = useState("");
  const [hiStr, setHiStr] = useState("");

  // Drag dello slider: maniglia attiva + valore provvisorio per feedback live.
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragThumb, setDragThumb] = useState<null | "lo" | "hi">(null);
  const pendingRef = useRef<Range | null>(null);
  const [pending, setPendingState] = useState<Range | null>(null);
  const setPending = (r: Range | null) => {
    pendingRef.current = r;
    setPendingState(r);
  };

  const fmt = (n: number) => (decimals > 0 ? n.toFixed(decimals) : String(n));
  const snap = (n: number) =>
    decimals > 0 ? Math.round(n * 10) / 10 : Math.round(n);

  const domainMin = bins.length ? bins[0].lo : 0;
  // hi inclusivo: per gli interi (score) il bin 90-95 copre fino a 94.
  const domainMax = bins.length
    ? decimals > 0
      ? bins[bins.length - 1].hi
      : bins[bins.length - 1].hi - 1
    : 0;

  // Sincronizza gli input col valore applicato (URL).
  useEffect(() => {
    setLoStr(value ? fmt(value.lo) : "");
    setHiStr(value ? fmt(value.hi) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.lo, value?.hi]);

  // Drag globale dello slider (move + up ovunque, non solo sulla maniglia).
  useEffect(() => {
    if (!dragThumb) return;
    const valueFromX = (clientX: number) => {
      const el = trackRef.current;
      if (!el) return domainMin;
      const rect = el.getBoundingClientRect();
      const ratio = rect.width ? (clientX - rect.left) / rect.width : 0;
      return clamp(
        snap(domainMin + ratio * (domainMax - domainMin)),
        domainMin,
        domainMax,
      );
    };
    const move = (e: PointerEvent) => {
      const v = valueFromX(e.clientX);
      const base = pendingRef.current ??
        value ?? { lo: domainMin, hi: domainMax };
      const next =
        dragThumb === "lo"
          ? { lo: Math.min(v, base.hi), hi: base.hi }
          : { lo: base.lo, hi: Math.max(v, base.lo) };
      setPending(next);
    };
    const up = () => {
      const r = pendingRef.current;
      setDragThumb(null);
      setPending(null);
      if (r) {
        if (r.lo <= domainMin && r.hi >= domainMax) onChange(null);
        else onChange({ lo: r3(r.lo), hi: r3(r.hi) });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragThumb, value?.lo, value?.hi, domainMin, domainMax]);

  if (!bins.length) {
    return (
      <div
        className="text-[11px] py-3 text-center"
        style={{ color: "var(--color-dim)" }}
      >
        {t.noData}
      </div>
    );
  }

  const maxCount = Math.max(...bins.map((b) => b.count), 1);
  const H = 56;
  const display = pending ?? value;
  const span = domainMax - domainMin || 1;
  const pct = (v: number) => clamp(((v - domainMin) / span) * 100, 0, 100);

  // Un bin è evidenziato se il suo centro ricade nel range visualizzato.
  const inSel = (i: number): boolean => {
    if (anchor === i) return true;
    if (!display) return false;
    const c = (bins[i].lo + bins[i].hi) / 2;
    return c >= display.lo - 1e-6 && c <= display.hi + 1e-6;
  };

  // Click su barra: 1° = ancora (seleziona quel bin); 2° = chiude il range.
  function clickBar(i: number) {
    if (anchor == null) {
      setAnchor(i);
      commitBins(i, i);
    } else {
      const a = Math.min(anchor, i);
      const b = Math.max(anchor, i);
      setAnchor(null);
      commitBins(a, b);
    }
  }
  function commitBins(a: number, b: number) {
    const lo = bins[a].lo;
    const hi = decimals > 0 ? bins[b].hi : bins[b].hi - 1;
    onChange({ lo: r3(lo), hi: r3(hi) });
  }

  function startThumb(which: "lo" | "hi") {
    return (e: React.PointerEvent) => {
      e.preventDefault();
      setAnchor(null);
      setPending(value ?? { lo: domainMin, hi: domainMax });
      setDragThumb(which);
    };
  }

  function commitInputs(nextLo: string, nextHi: string) {
    const lo = parseFloat(nextLo);
    const hi = parseFloat(nextHi);
    const hasLo = nextLo.trim() !== "" && !Number.isNaN(lo);
    const hasHi = nextHi.trim() !== "" && !Number.isNaN(hi);
    if (!hasLo && !hasHi) {
      onChange(null);
      return;
    }
    let a = clamp(hasLo ? lo : domainMin, domainMin, domainMax);
    let b = clamp(hasHi ? hi : domainMax, domainMin, domainMax);
    if (a > b) [a, b] = [b, a];
    onChange({ lo: r3(a), hi: r3(b) });
  }

  const sliderLo = display ? display.lo : domainMin;
  const sliderHi = display ? display.hi : domainMax;

  return (
    <div className="select-none">
      {/* Barre cliccabili */}
      <div
        className="flex items-end gap-[2px]"
        style={{ height: H }}
        role="group"
        aria-label={t.histogramAria}
      >
        {bins.map((b, i) => {
          const active = inSel(i);
          const h = b.count > 0 ? Math.max(3, (b.count / maxCount) * H) : 1;
          return (
            <button
              key={`${b.lo}-${b.hi}`}
              type="button"
              onClick={() => clickBar(i)}
              title={`${fmt(b.lo)}–${decimals > 0 ? fmt(b.hi) : fmt(b.hi - 1)} · ${b.count}`}
              className="flex-1 flex flex-col justify-end items-stretch cursor-pointer"
              style={{ height: H }}
              aria-pressed={active}
            >
              <div
                className="rounded-t-sm transition-colors"
                style={{
                  height: h,
                  background: active
                    ? "var(--color-green)"
                    : "var(--color-border-glow)",
                  opacity: active ? 1 : 0.65,
                }}
              />
            </button>
          );
        })}
      </div>

      {anchor != null && (
        <div
          className="text-[9px] mt-1"
          style={{ color: "var(--color-green)" }}
        >
          {t.clickAnother}
        </div>
      )}

      {/* Slider a due maniglie */}
      <div className="px-1.5 mt-3">
        <div
          ref={trackRef}
          className="relative h-1.5 rounded-full"
          style={{ background: "var(--color-border)" }}
        >
          <div
            className="absolute h-1.5 rounded-full top-0"
            style={{
              left: `${pct(sliderLo)}%`,
              width: `${pct(sliderHi) - pct(sliderLo)}%`,
              background: "var(--color-green)",
              opacity: display ? 1 : 0.35,
            }}
          />
          <Thumb
            posPct={pct(sliderLo)}
            onPointerDown={startThumb("lo")}
            label={t.lowerLimit}
          />
          <Thumb
            posPct={pct(sliderHi)}
            onPointerDown={startThumb("hi")}
            label={t.upperLimit}
          />
        </div>
      </div>

      {/* Asse min/max */}
      <div
        className="flex justify-between mt-1.5 text-[9px] tabular-nums"
        style={{ color: "var(--color-dim)" }}
      >
        <span>{fmt(domainMin)}</span>
        <span>{fmt(domainMax)}</span>
      </div>

      {/* Input numerici precisi */}
      <div className="flex items-center gap-1.5 mt-2">
        <NumInput
          ariaLabel={t.rangeStart}
          placeholder={fmt(domainMin)}
          value={loStr}
          decimals={decimals}
          onChange={setLoStr}
          onCommit={() => commitInputs(loStr, hiStr)}
        />
        <span className="text-[10px]" style={{ color: "var(--color-dim)" }}>
          –
        </span>
        <NumInput
          ariaLabel={t.rangeEnd}
          placeholder={fmt(domainMax)}
          value={hiStr}
          decimals={decimals}
          onChange={setHiStr}
          onCommit={() => commitInputs(loStr, hiStr)}
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              setAnchor(null);
              onChange(null);
            }}
            aria-label={t.resetRange}
            title={t.reset}
            className="ml-auto text-[10px] font-semibold cursor-pointer leading-none"
            style={{ color: "var(--color-green)" }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Fascia "senza valore" */}
      {onToggleUnscored && unscoredCount > 0 && (
        <button
          type="button"
          onClick={onToggleUnscored}
          className="mt-2 w-full flex items-center justify-between px-2 py-1 rounded cursor-pointer hover:bg-[rgba(255,255,255,0.04)] transition-colors"
          style={{
            background: unscoredSelected
              ? "rgba(0,232,122,0.08)"
              : "transparent",
          }}
          aria-pressed={unscoredSelected}
        >
          <span
            className="text-[10.5px] italic"
            style={{
              color: unscoredSelected
                ? "var(--color-bright)"
                : "var(--color-muted)",
            }}
          >
            {unscoredLabel ?? t.noValue}
          </span>
          <span
            className="text-[10.5px] font-semibold tabular-nums"
            style={{
              color: unscoredSelected
                ? "var(--color-bright)"
                : "var(--color-dim)",
            }}
          >
            {unscoredCount}
          </span>
        </button>
      )}
    </div>
  );
}

function Thumb({
  posPct,
  onPointerDown,
  label,
}: {
  posPct: number;
  onPointerDown: (e: React.PointerEvent) => void;
  label: string;
}) {
  return (
    <div
      role="slider"
      aria-label={label}
      aria-valuenow={Math.round(posPct)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      className="absolute top-1/2 w-3.5 h-3.5 rounded-full cursor-ew-resize touch-none -translate-x-1/2 -translate-y-1/2"
      style={{
        left: `${posPct}%`,
        background: "var(--color-green)",
        border: "2px solid var(--color-void)",
        boxShadow: "0 0 0 1px var(--color-green)",
      }}
    />
  );
}

function NumInput({
  ariaLabel,
  placeholder,
  value,
  decimals,
  onChange,
  onCommit,
}: {
  ariaLabel: string;
  placeholder: string;
  value: string;
  decimals: number;
  onChange: (v: string) => void;
  onCommit: () => void;
}) {
  return (
    <input
      type="number"
      inputMode={decimals > 0 ? "decimal" : "numeric"}
      step={decimals > 0 ? 0.1 : 1}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit();
        }
      }}
      className="w-14 px-1.5 py-1 text-[10.5px] tabular-nums rounded border bg-transparent outline-none"
      style={{
        borderColor: "var(--color-border)",
        color: "var(--color-base)",
      }}
    />
  );
}
