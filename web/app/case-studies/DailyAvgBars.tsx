"use client";

// Barre di confronto (una per profilo) del tasso giornaliero di match ad alto
// score, con hover: passando su una barra si vede il profilo e i valori ≥70/≥80
// al giorno. Componente client perché l'indice (page.tsx) è server-rendered.

import { useRef } from "react";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import { TooltipLayer, type TooltipHandle } from "@/app/components/ChartTooltip";

const LOCALE_TAG: Record<Locale, string> = {
  it: "it-IT",
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  hu: "hu-HU",
  pt: "pt-PT",
};

const STRONG = "#15803d";
const EXCELLENT = "#22c55e";

export default function DailyAvgBars({
  bars,
  max,
  unit,
}: {
  bars: { label: string; r70: number; r80: number }[];
  max: number;
  unit: string;
}) {
  const locale = useLocale();
  const fmt1 = (n: number) =>
    n.toLocaleString(LOCALE_TAG[locale], { maximumFractionDigits: 1 });
  const tipRef = useRef<TooltipHandle>(null);

  return (
    <>
      <div className="flex flex-col gap-3">
        {bars.map((s) => (
          <div
            key={s.label}
            className="cursor-default"
            onMouseEnter={(e) =>
              tipRef.current?.show(e.clientX, e.clientY, s.label, [
                { color: EXCELLENT, label: "≥80", value: `${fmt1(s.r80)} / ${unit}` },
                { color: STRONG, label: "≥70", value: `${fmt1(s.r70)} / ${unit}` },
              ])
            }
            onMouseMove={(e) => tipRef.current?.move(e.clientX, e.clientY)}
            onMouseLeave={() => tipRef.current?.hide()}
          >
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-[11px] text-[var(--color-muted)] flex-1 truncate">
                {s.label}
              </span>
              <span className="text-[13px] font-bold tabular-nums text-[var(--color-base)]">
                {fmt1(s.r70)}
                <span className="text-[10px] font-normal text-[var(--color-dim)]">
                  {" "}
                  / {unit}
                </span>
              </span>
            </div>
            <div
              className="relative h-2 rounded-full overflow-hidden"
              style={{ background: "var(--color-border)" }}
            >
              <div
                className="absolute left-0 top-0 h-full rounded-full"
                style={{
                  width: `${Math.max(2, (s.r70 / max) * 100)}%`,
                  background: STRONG,
                }}
              />
              <div
                className="absolute left-0 top-0 h-full rounded-full"
                style={{ width: `${(s.r80 / max) * 100}%`, background: EXCELLENT }}
              />
            </div>
          </div>
        ))}
      </div>
      <TooltipLayer ref={tipRef} />
    </>
  );
}
