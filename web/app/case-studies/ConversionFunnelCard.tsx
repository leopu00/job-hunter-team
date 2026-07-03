"use client";

// Statistiche di CONVERSIONE (aggregate, non personali): di tutte le posizioni
// trovate, quante si convertono in valutate, match forti (≥70) ed eccellenti
// (≥80). Imbuto orizzontale: barre decrescenti con conteggio e % sul totale
// trovato, più la conversione step-su-step.

import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

const T: Record<
  Locale,
  {
    found: string;
    scored: string;
    strong: string;
    excellent: string;
    ofFound: string;
    stepNote: string;
  }
> = {
  it: {
    found: "Trovate",
    scored: "Valutate",
    strong: "Match forti ≥70",
    excellent: "Eccellenti ≥80",
    ofFound: "del totale trovate",
    stepNote: "conversione tra step",
  },
  en: {
    found: "Found",
    scored: "Scored",
    strong: "Strong match ≥70",
    excellent: "Excellent ≥80",
    ofFound: "of all found",
    stepNote: "step-to-step conversion",
  },
  es: {
    found: "Encontradas",
    scored: "Evaluadas",
    strong: "Match fuerte ≥70",
    excellent: "Excelentes ≥80",
    ofFound: "del total encontradas",
    stepNote: "conversión entre pasos",
  },
  fr: {
    found: "Trouvées",
    scored: "Évaluées",
    strong: "Match fort ≥70",
    excellent: "Excellentes ≥80",
    ofFound: "du total trouvées",
    stepNote: "conversion entre étapes",
  },
  de: {
    found: "Gefunden",
    scored: "Bewertet",
    strong: "Starkes Match ≥70",
    excellent: "Exzellent ≥80",
    ofFound: "aller gefundenen",
    stepNote: "Schritt-zu-Schritt-Conversion",
  },
  hu: {
    found: "Találat",
    scored: "Értékelt",
    strong: "Erős találat ≥70",
    excellent: "Kiváló ≥80",
    ofFound: "az összes találatból",
    stepNote: "lépésenkénti konverzió",
  },
  pt: {
    found: "Encontradas",
    scored: "Avaliadas",
    strong: "Match forte ≥70",
    excellent: "Excelentes ≥80",
    ofFound: "do total encontradas",
    stepNote: "conversão entre etapas",
  },
};

const COLORS = ["#3B82F6", "#0EA5A4", "#22C55E", "#F59E0B"];

export default function ConversionFunnelCard({
  found,
  scored,
  strong70,
  strong80,
}: {
  found: number;
  scored: number;
  strong70: number;
  strong80: number;
}) {
  const locale = useLocale();
  const t = T[locale];

  const base = Math.max(1, found);
  // Imbuto rovesciato: eccellenti in cima (stadio più stretto) → trovate in fondo
  // (stadio più ampio). La conversione tra step confronta ogni riga con quella
  // SOTTO, cioè lo stadio più ampio da cui si "sale".
  const stages = [
    { label: t.excellent, n: strong80, color: COLORS[3] },
    { label: t.strong, n: strong70, color: COLORS[2] },
    { label: t.scored, n: scored, color: COLORS[1] },
    { label: t.found, n: found, color: COLORS[0] },
  ];
  const pctFound = (n: number) => Math.round((n / base) * 100);
  const pctStep = (i: number) =>
    i === stages.length - 1 || stages[i + 1].n <= 0
      ? null
      : Math.round((stages[i].n / stages[i + 1].n) * 100);

  return (
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] p-6 h-full">
      <div className="flex flex-col gap-3">
        {stages.map((s, i) => {
          const step = pctStep(i);
          return (
            <div key={s.label}>
              <div className="flex items-baseline gap-2 mb-1">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ background: s.color }}
                />
                <span className="text-[11px] text-[var(--color-muted)] flex-1 truncate">
                  {s.label}
                </span>
                {step != null && (
                  <span className="text-[10px] tabular-nums text-[var(--color-dim)]">
                    ↑ {step}%
                  </span>
                )}
                <span className="text-[13px] font-bold tabular-nums text-[var(--color-base)] w-12 text-right">
                  {s.n.toLocaleString()}
                </span>
                <span className="text-[10px] font-semibold tabular-nums text-[var(--color-dim)] w-9 text-right">
                  {pctFound(s.n)}%
                </span>
              </div>
              <div
                className="h-2 rounded-full overflow-hidden"
                style={{ background: "var(--color-border)" }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${pctFound(s.n)}%`,
                    background: s.color,
                    opacity: 0.85,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 pt-2 border-t border-[var(--color-border)] text-[10px] text-[var(--color-dim)] text-right">
        % {t.ofFound} · ↑ {t.stepNote}
      </div>
    </div>
  );
}
