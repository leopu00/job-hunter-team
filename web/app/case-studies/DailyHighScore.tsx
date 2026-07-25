"use client";

// Output di match ad alto score, giorno per giorno. Per ogni giorno in cui il
// team ha trovato posizioni: quante hanno raggiunto uno score alto (≥70, "forti")
// ed eccellente (≥80). Barre impilate: la parte bassa (viva) sono le eccellenti,
// quella sopra (spenta) le forti 70-79. In cima due medie: forti/giorno ed
// eccellenti/giorno. Serve a legare i GIORNI di lavoro all'OUTPUT di candidature
// di qualità.

import { useRef } from "react";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import {
  TooltipLayer,
  type TooltipHandle,
} from "@/app/components/ChartTooltip";
import { intlTag } from "@/lib/locale-tag";

const T: Record<
  Locale,
  {
    title: string;
    lead: string;
    avgStrong: string;
    avgExcellent: string;
    legendStrong: string;
    legendExcellent: string;
    chartTitle: string;
    caption: string;
  }
> = {
  it: {
    title: "📈 Match ad alto score, giorno per giorno",
    lead: "Per ogni giorno di lavoro, quante posizioni hanno raggiunto uno score alto (≥70) ed eccellente (≥80). In fondo: quante ne produce in media al giorno.",
    avgStrong: "forti ≥70 / giorno (media)",
    avgExcellent: "eccellenti ≥80 / giorno (media)",
    legendStrong: "forti 70–79",
    legendExcellent: "eccellenti ≥80",
    chartTitle: "Match ad alto score prodotti · giorno per giorno",
    caption:
      "Ogni barra è un giorno di lavoro; l'altezza è il numero di match ≥70, con la quota ≥80 evidenziata.",
  },
  en: {
    title: "📈 High-score matches, day by day",
    lead: "For each working day, how many positions reached a high score (≥70) and excellent (≥80). Below: how many it produces per day on average.",
    avgStrong: "strong ≥70 / day (avg)",
    avgExcellent: "excellent ≥80 / day (avg)",
    legendStrong: "strong 70–79",
    legendExcellent: "excellent ≥80",
    chartTitle: "High-score matches produced · day by day",
    caption:
      "Each bar is a working day; height is the number of ≥70 matches, with the ≥80 share highlighted.",
  },
  es: {
    title: "📈 Match de score alto, día a día",
    lead: "Por cada día de trabajo, cuántas posiciones alcanzaron un score alto (≥70) y excelente (≥80). Abajo: cuántas produce de media al día.",
    avgStrong: "fuertes ≥70 / día (media)",
    avgExcellent: "excelentes ≥80 / día (media)",
    legendStrong: "fuertes 70–79",
    legendExcellent: "excelentes ≥80",
    chartTitle: "Match de score alto producidos · día a día",
    caption:
      "Cada barra es un día de trabajo; la altura es el número de match ≥70, con la cuota ≥80 resaltada.",
  },
  fr: {
    title: "📈 Matchs à score élevé, jour par jour",
    lead: "Pour chaque jour de travail, combien de postes ont atteint un score élevé (≥70) et excellent (≥80). En bas : combien il en produit par jour en moyenne.",
    avgStrong: "forts ≥70 / jour (moy.)",
    avgExcellent: "excellents ≥80 / jour (moy.)",
    legendStrong: "forts 70–79",
    legendExcellent: "excellents ≥80",
    chartTitle: "Matchs à score élevé produits · jour par jour",
    caption:
      "Chaque barre est un jour de travail ; la hauteur est le nombre de matchs ≥70, avec la part ≥80 mise en évidence.",
  },
  de: {
    title: "📈 Hoch bewertete Matches, Tag für Tag",
    lead: "Pro Arbeitstag: wie viele Positionen einen hohen (≥70) und exzellenten (≥80) Score erreichten. Unten: wie viele es im Schnitt pro Tag produziert.",
    avgStrong: "stark ≥70 / Tag (Ø)",
    avgExcellent: "exzellent ≥80 / Tag (Ø)",
    legendStrong: "stark 70–79",
    legendExcellent: "exzellent ≥80",
    chartTitle: "Hoch bewertete Matches · Tag für Tag",
    caption:
      "Jeder Balken ist ein Arbeitstag; die Höhe ist die Zahl der ≥70-Matches, mit hervorgehobenem ≥80-Anteil.",
  },
  hu: {
    title: "📈 Magas pontszámú találatok, naponta",
    lead: "Minden munkanapra: hány pozíció ért el magas (≥70) és kiváló (≥80) pontszámot. Lent: naponta átlagosan mennyit termel.",
    avgStrong: "erős ≥70 / nap (átlag)",
    avgExcellent: "kiváló ≥80 / nap (átlag)",
    legendStrong: "erős 70–79",
    legendExcellent: "kiváló ≥80",
    chartTitle: "Magas pontszámú találatok · naponta",
    caption:
      "Minden oszlop egy munkanap; a magasság a ≥70 találatok száma, kiemelve a ≥80 hányad.",
  },
  pt: {
    title: "📈 Matches de score alto, dia a dia",
    lead: "Por cada dia de trabalho, quantas posições alcançaram um score alto (≥70) e excelente (≥80). Em baixo: quantas produz em média por dia.",
    avgStrong: "fortes ≥70 / dia (média)",
    avgExcellent: "excelentes ≥80 / dia (média)",
    legendStrong: "fortes 70–79",
    legendExcellent: "excelentes ≥80",
    chartTitle: "Matches de score alto produzidos · dia a dia",
    caption:
      "Cada barra é um dia de trabalho; a altura é o número de matches ≥70, com a quota ≥80 destacada.",
  },
};

const STRONG = "#15803d"; // 70–79 (verde spento)
const EXCELLENT = "#22c55e"; // ≥80 (verde vivo, in basso)

export default function DailyHighScore({
  daily,
}: {
  daily: { day: string; strong70: number; strong80: number }[];
}) {
  const locale = useLocale();
  const t = T[locale];
  const tag = intlTag(locale);
  const nf = (n: number) => n.toLocaleString(tag);
  const tipRef = useRef<TooltipHandle>(null);
  const dayLabel = (iso: string) =>
    new Intl.DateTimeFormat(tag, {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${iso}T00:00:00Z`));

  if (daily.length === 0) return null;
  const n = daily.length;
  const tot70 = daily.reduce((s, d) => s + d.strong70, 0);
  const tot80 = daily.reduce((s, d) => s + d.strong80, 0);
  const avg70 = tot70 / n;
  const avg80 = tot80 / n;
  const max = Math.max(...daily.map((d) => d.strong70), 1);

  const kpi = (v: number, label: string, color: string) => (
    <div
      key={label}
      className="border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-4"
    >
      <div
        className="text-[22px] font-extrabold tabular-nums leading-none"
        style={{ color }}
      >
        {v.toLocaleString(tag, { maximumFractionDigits: 1 })}
      </div>
      <div className="mt-1.5 text-[10px] leading-snug text-[var(--color-muted)]">
        {label}
      </div>
    </div>
  );

  return (
    <>
      <div className="section-label mb-1">{t.title}</div>
      <p className="text-[11px] text-[var(--color-dim)] mb-6">{t.lead}</p>

      <div className="grid grid-cols-2 gap-3">
        {kpi(avg70, t.avgStrong, STRONG)}
        {kpi(avg80, t.avgExcellent, EXCELLENT)}
      </div>

      <div className="mt-6 bg-[var(--color-card)] border border-[var(--color-border)] p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
          <span className="text-[12px] font-semibold text-[var(--color-base)]">
            {t.chartTitle}
          </span>
          <span className="flex items-center gap-3 text-[10px] text-[var(--color-muted)]">
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm"
                style={{ background: EXCELLENT }}
              />
              {t.legendExcellent}
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm"
                style={{ background: STRONG }}
              />
              {t.legendStrong}
            </span>
          </span>
        </div>

        {/* colonne impilate: una per giorno; altezza ∝ ≥70, quota ≥80 in basso */}
        <div className="flex items-stretch gap-[3px] h-44">
          {daily.map((d) => {
            const fullPct = (d.strong70 / max) * 100;
            const excPct = (d.strong80 / max) * 100;
            return (
              <div
                key={d.day}
                className="flex-1 min-w-[2px] relative cursor-default"
                onMouseEnter={(e) =>
                  tipRef.current?.show(
                    e.clientX,
                    e.clientY,
                    `${dayLabel(d.day)} · ${nf(d.strong70)} ≥70`,
                    [
                      {
                        color: EXCELLENT,
                        label: t.legendExcellent,
                        value: nf(d.strong80),
                      },
                      {
                        color: STRONG,
                        label: t.legendStrong,
                        value: nf(d.strong70 - d.strong80),
                      },
                    ],
                  )
                }
                onMouseMove={(e) => tipRef.current?.move(e.clientX, e.clientY)}
                onMouseLeave={() => tipRef.current?.hide()}
              >
                <div
                  className="absolute bottom-0 inset-x-0 rounded-t-sm"
                  style={{ height: `${fullPct}%`, background: STRONG }}
                />
                <div
                  className="absolute bottom-0 inset-x-0"
                  style={{ height: `${excPct}%`, background: EXCELLENT }}
                />
                {/* zona hover a piena altezza: prendibile anche sopra la barra */}
                <div className="absolute inset-0" />
              </div>
            );
          })}
        </div>
        <div className="flex justify-between mt-2 text-[9px] tabular-nums text-[var(--color-dim)]">
          <span>{dayLabel(daily[0].day)}</span>
          <span>{dayLabel(daily[daily.length - 1].day)}</span>
        </div>

        <div className="mt-4 pt-2 border-t border-[var(--color-border)] text-[10px] text-[var(--color-dim)]">
          {t.caption}
        </div>
      </div>
      <TooltipLayer ref={tipRef} />
    </>
  );
}
