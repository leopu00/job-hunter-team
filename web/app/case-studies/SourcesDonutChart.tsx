"use client";

// Donut: distribuzione % delle fonti, sulle posizioni VALUTATE (con score) —
// stessa base del grafico "score medio per fonte" che gli sta accanto, così i
// numeri combaciano. Anello colorato per fonte + centro col totale + legenda %.
// Interattivo: hover su uno spicchio (o su una riga della legenda) evidenzia la
// fonte e ne mostra il nome.

import { useState } from "react";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import { colorForSource, labelForSource } from "@/lib/case-study-sources";

const T: Record<
  Locale,
  {
    title: string;
    noData: string;
    center: string;
    other: string;
    companyCareers: string;
    officialCareers: string;
  }
> = {
  it: {
    title: "Distribuzione delle fonti",
    noData: "Dato non disponibile in questo snapshot.",
    center: "valutate",
    other: "Altre",
    companyCareers: "Pagine carriera",
    officialCareers: "Carriere ufficiali",
  },
  en: {
    title: "Source distribution",
    noData: "Data not available in this snapshot.",
    center: "scored",
    other: "Other",
    companyCareers: "Career pages",
    officialCareers: "Official careers",
  },
  es: {
    title: "Distribución de las fuentes",
    noData: "Dato no disponible en esta instantánea.",
    center: "evaluadas",
    other: "Otras",
    companyCareers: "Páginas de empleo",
    officialCareers: "Carreras oficiales",
  },
  fr: {
    title: "Répartition des sources",
    noData: "Donnée non disponible dans cet instantané.",
    center: "évaluées",
    other: "Autres",
    companyCareers: "Pages carrière",
    officialCareers: "Carrières officielles",
  },
  de: {
    title: "Verteilung der Quellen",
    noData: "Daten in diesem Snapshot nicht verfügbar.",
    center: "bewertet",
    other: "Andere",
    companyCareers: "Karriereseiten",
    officialCareers: "Offizielle Karriere",
  },
  hu: {
    title: "Források megoszlása",
    noData: "Az adat nem érhető el ebben a pillanatképben.",
    center: "értékelt",
    other: "Egyéb",
    companyCareers: "Karrieroldalak",
    officialCareers: "Hivatalos karrier",
  },
  pt: {
    title: "Distribuição das fontes",
    noData: "Dado não disponível neste snapshot.",
    center: "avaliadas",
    other: "Outras",
    companyCareers: "Páginas de carreira",
    officialCareers: "Carreiras oficiais",
  },
};

export default function SourcesDonutChart({
  rows,
  keys,
}: {
  rows: { name: string; avg: number; n: number }[];
  keys: string[];
}) {
  const locale = useLocale();
  const t = T[locale];
  const [hover, setHover] = useState<string | null>(null);

  const total = rows.reduce((s, r) => s + r.n, 0);
  if (!rows.length || total <= 0) {
    return <p className="text-[11px] text-[var(--color-dim)]">{t.noData}</p>;
  }

  const col = (name: string) => colorForSource(name, keys.indexOf(name));
  const labelFor = (name: string) =>
    labelForSource(name, {
      other: t.other,
      companyCareers: t.companyCareers,
      officialCareers: t.officialCareers,
    });

  // Ordinate per quota (n) desc; archi del donut.
  const sorted = [...rows].sort((a, b) => b.n - a.n);
  const R = 62;
  const C = 2 * Math.PI * R;
  let acc = 0;
  const arcs = sorted.map((r) => {
    const frac = r.n / total;
    const a = { ...r, frac, start: acc, pct: Math.round(frac * 100) };
    acc += frac;
    return a;
  });
  const active = hover ? arcs.find((a) => a.name === hover) : null;

  return (
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] p-6">
      <div className="text-[12px] font-semibold text-[var(--color-base)] mb-4">
        {t.title}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-6 items-center">
        {/* Donut */}
        <div
          className="relative shrink-0 mx-auto"
          style={{ width: 180, height: 180 }}
        >
          <svg viewBox="0 0 180 180" width={180} height={180}>
            <g transform="rotate(-90 90 90)">
              {arcs.map((s) => {
                const on = hover === s.name;
                return (
                  <circle
                    key={s.name}
                    cx={90}
                    cy={90}
                    r={R}
                    fill="none"
                    stroke={col(s.name)}
                    strokeWidth={on ? 28 : 24}
                    strokeDasharray={`${s.frac * C} ${C - s.frac * C}`}
                    strokeDashoffset={-s.start * C}
                    opacity={hover && !on ? 0.3 : 1}
                    style={{ cursor: "pointer", transition: "opacity 120ms" }}
                    onMouseEnter={() => setHover(s.name)}
                    onMouseLeave={() => setHover(null)}
                  />
                );
              })}
            </g>
            {/* Centro: totale, oppure la fonte evidenziata */}
            <text
              x={90}
              y={active ? 84 : 90}
              textAnchor="middle"
              style={{
                fontSize: active ? 28 : 36,
                fontWeight: 800,
                fill: active ? col(active.name) : "var(--color-white)",
              }}
            >
              {active ? `${active.pct}%` : total}
            </text>
            <text
              x={90}
              y={active ? 102 : 108}
              textAnchor="middle"
              className="fill-[var(--color-dim)]"
              style={{ fontSize: active ? 9 : 8, letterSpacing: 0.5 }}
            >
              {active ? labelFor(active.name) : t.center.toUpperCase()}
            </text>
          </svg>
        </div>
        {/* Legenda % */}
        <div className="w-full space-y-1.5">
          {arcs.map((s) => {
            const on = hover === s.name;
            return (
              <div
                key={s.name}
                className="flex items-center gap-2.5 cursor-pointer transition-opacity"
                style={{ opacity: hover && !on ? 0.4 : 1 }}
                onMouseEnter={() => setHover(s.name)}
                onMouseLeave={() => setHover(null)}
              >
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ background: col(s.name) }}
                />
                <span
                  className={`text-[11px] flex-1 truncate ${on ? "font-semibold text-[var(--color-bright)]" : "text-[var(--color-muted)]"}`}
                  title={labelFor(s.name)}
                >
                  {labelFor(s.name)}
                </span>
                <span className="text-[11px] font-bold tabular-nums w-8 text-right text-[var(--color-base)]">
                  {s.pct}%
                </span>
                <span className="text-[10px] tabular-nums w-7 text-right text-[var(--color-dim)]">
                  {s.n}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
