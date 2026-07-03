"use client";

// Barre orizzontali: score medio COMPLESSIVO per fonte (non per periodo).
// Una riga per provider, lunghezza barra = score medio (0-100), colore = fonte,
// ordinate dal migliore. A destra il valore e il n. di posizioni scorate.

import { useState } from "react";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import { colorForSource, labelForSource } from "@/lib/case-study-sources";

const T: Record<
  Locale,
  {
    title: string;
    noData: string;
    other: string;
    companyCareers: string;
    officialCareers: string;
    nLabel: string;
  }
> = {
  it: {
    title: "Score medio per fonte",
    noData: "Dato non disponibile in questo snapshot.",
    other: "Altre",
    companyCareers: "Pagine carriera",
    officialCareers: "Carriere ufficiali",
    nLabel: "pos.",
  },
  en: {
    title: "Average score by source",
    noData: "Data not available in this snapshot.",
    other: "Other",
    companyCareers: "Career pages",
    officialCareers: "Official careers",
    nLabel: "pos.",
  },
  es: {
    title: "Score medio por fuente",
    noData: "Dato no disponible en esta instantánea.",
    other: "Otras",
    companyCareers: "Páginas de empleo",
    officialCareers: "Carreras oficiales",
    nLabel: "pos.",
  },
  fr: {
    title: "Score moyen par source",
    noData: "Donnée non disponible dans cet instantané.",
    other: "Autres",
    companyCareers: "Pages carrière",
    officialCareers: "Carrières officielles",
    nLabel: "postes",
  },
  de: {
    title: "Durchschnitts-Score je Quelle",
    noData: "Daten in diesem Snapshot nicht verfügbar.",
    other: "Andere",
    companyCareers: "Karriereseiten",
    officialCareers: "Offizielle Karriere",
    nLabel: "Stellen",
  },
  hu: {
    title: "Átlagpontszám forrásonként",
    noData: "Az adat nem érhető el ebben a pillanatképben.",
    other: "Egyéb",
    companyCareers: "Karrieroldalak",
    officialCareers: "Hivatalos karrier",
    nLabel: "poz.",
  },
  pt: {
    title: "Score médio por fonte",
    noData: "Dado não disponível neste snapshot.",
    other: "Outras",
    companyCareers: "Páginas de carreira",
    officialCareers: "Carreiras oficiais",
    nLabel: "pos.",
  },
};

export default function SourcesAvgScoreChart({
  rows,
  keys,
}: {
  rows: { name: string; avg: number; n: number }[];
  keys: string[];
}) {
  const locale = useLocale();
  const t = T[locale];
  const [hover, setHover] = useState<string | null>(null);

  if (!rows.length) {
    return <p className="text-[11px] text-[var(--color-dim)]">{t.noData}</p>;
  }

  // Colore stabile (stesso indice degli altri grafici fonti).
  const col = (name: string) => colorForSource(name, keys.indexOf(name));
  const labelFor = (name: string) =>
    labelForSource(name, {
      other: t.other,
      companyCareers: t.companyCareers,
      officialCareers: t.officialCareers,
    });
  // Asse 0-100 (score). Già ordinate per avg desc dal generatore.
  const ordered = [...rows].sort((a, b) => b.avg - a.avg);
  // Quota % per fonte sulle posizioni valutate (stessa base del donut accanto).
  const totalN = rows.reduce((s, r) => s + r.n, 0) || 1;

  return (
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] p-6">
      <div className="text-[12px] font-semibold text-[var(--color-base)] mb-4">
        {t.title}
      </div>
      <div className="flex flex-col gap-2.5">
        {ordered.map((r) => {
          const color = col(r.name);
          const on = hover === r.name;
          return (
            <div
              key={r.name}
              className="flex items-center gap-2.5 cursor-default transition-opacity"
              style={{ opacity: hover && !on ? 0.4 : 1 }}
              onMouseEnter={() => setHover(r.name)}
              onMouseLeave={() => setHover(null)}
            >
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ background: color }}
              />
              <span
                className={`text-[11px] w-40 shrink-0 truncate ${on ? "font-semibold text-[var(--color-bright)]" : "text-[var(--color-muted)]"}`}
                title={labelFor(r.name)}
              >
                {labelFor(r.name)}
              </span>
              <div
                className="flex-1 h-1.5 rounded-full overflow-hidden"
                style={{ background: "var(--color-border)" }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${r.avg}%`,
                    background: color,
                    opacity: 0.85,
                  }}
                />
              </div>
              <span
                className="text-[11px] font-bold tabular-nums w-9 text-right"
                style={{ color }}
              >
                {r.avg}
              </span>
              <span className="text-[10px] tabular-nums w-20 shrink-0 text-right whitespace-nowrap text-[var(--color-dim)]">
                {r.n} {t.nLabel}
              </span>
              <span className="text-[10px] font-semibold tabular-nums w-10 shrink-0 text-right text-[var(--color-base)]">
                {Math.round((r.n / totalN) * 100)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
