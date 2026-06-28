"use client";

// Donut a due spicchi: posizioni TENUTE (non escluse) vs ESCLUSE, sul totale
// trovato. Centro = totale trovate. Interattivo: hover su spicchio/legenda
// evidenzia. Accompagna il funnel giornaliero (stessa base: posizioni trovate).

import { useState } from "react";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

const KEPT = "#22C55E";
const EXCL = "#EF4444";

const T: Record<
  Locale,
  { noData: string; center: string; kept: string; excluded: string }
> = {
  it: { noData: "Dato non disponibile.", center: "trovate", kept: "Tenute", excluded: "Escluse" },
  en: { noData: "Data not available.", center: "found", kept: "Kept", excluded: "Excluded" },
  es: { noData: "Dato no disponible.", center: "encontradas", kept: "Conservadas", excluded: "Excluidas" },
  fr: { noData: "Donnée non disponible.", center: "trouvées", kept: "Conservées", excluded: "Exclues" },
  de: { noData: "Daten nicht verfügbar.", center: "gefunden", kept: "Behalten", excluded: "Ausgeschlossen" },
  hu: { noData: "Az adat nem érhető el.", center: "találat", kept: "Megtartott", excluded: "Kizárt" },
  pt: { noData: "Dado não disponível.", center: "encontradas", kept: "Mantidas", excluded: "Excluídas" },
};

export default function ExcludedDonut({
  kept,
  excluded,
}: {
  kept: number;
  excluded: number;
}) {
  const locale = useLocale();
  const t = T[locale];
  const [hover, setHover] = useState<"kept" | "excluded" | null>(null);

  const total = kept + excluded;
  if (total <= 0) {
    return <p className="text-[11px] text-[var(--color-dim)]">{t.noData}</p>;
  }

  const R = 62;
  const C = 2 * Math.PI * R;
  const slices = [
    { key: "kept" as const, label: t.kept, n: kept, color: KEPT, start: 0 },
    { key: "excluded" as const, label: t.excluded, n: excluded, color: EXCL, start: kept / total },
  ];
  const active = hover ? slices.find((s) => s.key === hover) : null;
  const pct = (nn: number) => Math.round((nn / total) * 100);

  return (
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-6">
      <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-6 items-center">
        <div className="relative shrink-0 mx-auto" style={{ width: 180, height: 180 }}>
          <svg viewBox="0 0 180 180" width={180} height={180}>
            <g transform="rotate(-90 90 90)">
              {slices.map((s) => {
                const frac = s.n / total;
                const on = hover === s.key;
                return (
                  <circle
                    key={s.key}
                    cx={90}
                    cy={90}
                    r={R}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={on ? 28 : 24}
                    strokeDasharray={`${frac * C} ${C - frac * C}`}
                    strokeDashoffset={-s.start * C}
                    opacity={hover && !on ? 0.3 : 1}
                    style={{ cursor: "pointer", transition: "opacity 120ms" }}
                    onMouseEnter={() => setHover(s.key)}
                    onMouseLeave={() => setHover(null)}
                  />
                );
              })}
            </g>
            <text x={90} y={active ? 84 : 90} textAnchor="middle" style={{ fontSize: active ? 28 : 34, fontWeight: 800, fill: active ? active.color : "var(--color-white)" }}>
              {active ? `${pct(active.n)}%` : total}
            </text>
            <text x={90} y={active ? 102 : 108} textAnchor="middle" className="fill-[var(--color-dim)]" style={{ fontSize: active ? 9 : 8, letterSpacing: 0.5 }}>
              {active ? active.label : t.center.toUpperCase()}
            </text>
          </svg>
        </div>
        <div className="w-full space-y-2">
          {slices.map((s) => {
            const on = hover === s.key;
            return (
              <div
                key={s.key}
                className="flex items-center gap-2.5 cursor-pointer transition-opacity"
                style={{ opacity: hover && !on ? 0.4 : 1 }}
                onMouseEnter={() => setHover(s.key)}
                onMouseLeave={() => setHover(null)}
              >
                <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
                <span className={`text-[11px] flex-1 ${on ? "font-semibold text-[var(--color-bright)]" : "text-[var(--color-muted)]"}`}>
                  {s.label}
                </span>
                <span className="text-[11px] font-bold tabular-nums w-8 text-right text-[var(--color-base)]">{pct(s.n)}%</span>
                <span className="text-[10px] tabular-nums w-9 text-right text-[var(--color-dim)]">{s.n}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
