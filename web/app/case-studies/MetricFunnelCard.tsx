"use client";

// Imbuti "per livello": la resa (match/giorno) a soglie di score decrescenti e
// il prezzo (€/risultato) lungo le tappe del funnel. Stesso stile della card di
// conversione. I valori arrivano GIÀ mediati dal server (budget-scaled sui casi,
// free-run escluso); qui solo etichette localizzate, colori e formattazione. La
// barra è proporzionale al valore (max della card = 100%).

import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

const LOCALE_TAG: Record<Locale, string> = {
  it: "it-IT",
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  hu: "hu-HU",
  pt: "pt-PT",
};

// Etichette per riga. Chiavi soglia (t80/t70/t60/t50) per i match al giorno;
// chiavi tappa (found/scored/strong70/strong80) per il prezzo per risultato.
const LABEL: Record<Locale, Record<string, string>> = {
  it: {
    t80: "Eccellenti ≥80",
    t70: "Match forti ≥70",
    t60: "Match ≥60",
    t50: "Match ≥50",
    found: "per posizione trovata",
    scored: "per posizione valutata",
    strong70: "per match forte ≥70",
    strong80: "per match eccellente ≥80",
  },
  en: {
    t80: "Excellent ≥80",
    t70: "Strong match ≥70",
    t60: "Match ≥60",
    t50: "Match ≥50",
    found: "per position found",
    scored: "per position scored",
    strong70: "per strong match ≥70",
    strong80: "per excellent match ≥80",
  },
  es: {
    t80: "Excelentes ≥80",
    t70: "Match fuerte ≥70",
    t60: "Match ≥60",
    t50: "Match ≥50",
    found: "por posición encontrada",
    scored: "por posición evaluada",
    strong70: "por match fuerte ≥70",
    strong80: "por match excelente ≥80",
  },
  fr: {
    t80: "Excellents ≥80",
    t70: "Match fort ≥70",
    t60: "Match ≥60",
    t50: "Match ≥50",
    found: "par poste trouvé",
    scored: "par poste évalué",
    strong70: "par match fort ≥70",
    strong80: "par match excellent ≥80",
  },
  de: {
    t80: "Exzellent ≥80",
    t70: "Starkes Match ≥70",
    t60: "Match ≥60",
    t50: "Match ≥50",
    found: "pro gefundener Stelle",
    scored: "pro bewerteter Stelle",
    strong70: "pro starkem Match ≥70",
    strong80: "pro exzellentem Match ≥80",
  },
  hu: {
    t80: "Kiváló ≥80",
    t70: "Erős találat ≥70",
    t60: "Találat ≥60",
    t50: "Találat ≥50",
    found: "találatonként",
    scored: "értékelt pozíciónként",
    strong70: "erős találatonként ≥70",
    strong80: "kiváló találatonként ≥80",
  },
  pt: {
    t80: "Excelentes ≥80",
    t70: "Match forte ≥70",
    t60: "Match ≥60",
    t50: "Match ≥50",
    found: "por posição encontrada",
    scored: "por posição avaliada",
    strong70: "por match forte ≥70",
    strong80: "por match excelente ≥80",
  },
};

const UNIT: Record<Locale, string> = {
  it: "/ giorno",
  en: "/ day",
  es: "/ día",
  fr: "/ jour",
  de: "/ Tag",
  hu: "/ nap",
  pt: "/ dia",
};

// Colori coerenti con la card di conversione (blu → teal → verde → ambra):
// dal livello più ampio/economico (trovate, ≥50) al più selettivo/costoso
// (eccellenti ≥80).
const COLOR: Record<string, string> = {
  found: "#3B82F6",
  scored: "#0EA5A4",
  strong70: "#22C55E",
  strong80: "#F59E0B",
  t50: "#3B82F6",
  t60: "#0EA5A4",
  t70: "#22C55E",
  t80: "#F59E0B",
};

export default function MetricFunnelCard({
  title,
  caption,
  variant,
  rows,
}: {
  title: string;
  caption: string;
  variant: "perDay" | "cost";
  rows: { key: string; value: number }[];
}) {
  const locale = useLocale();
  const tag = LOCALE_TAG[locale];
  const max = Math.max(1e-9, ...rows.map((r) => r.value));
  const currency = new Intl.NumberFormat(tag, {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const fmt = (v: number) =>
    variant === "cost" ? `≈ ${currency.format(v)}` : Math.round(v).toLocaleString(tag);

  return (
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-6 h-full">
      <div className="section-label mb-4">{title}</div>
      <div className="flex flex-col gap-3">
        {rows.map((r) => {
          const color = COLOR[r.key] ?? "#22C55E";
          return (
            <div key={r.key}>
              <div className="flex items-baseline gap-2 mb-1">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ background: color }}
                />
                <span className="text-[11px] text-[var(--color-muted)] flex-1 truncate">
                  {LABEL[locale][r.key] ?? r.key}
                </span>
                <span className="text-[13px] font-bold tabular-nums text-[var(--color-base)]">
                  {fmt(r.value)}
                  {variant === "perDay" && (
                    <span className="text-[10px] font-normal text-[var(--color-dim)]">
                      {" "}
                      {UNIT[locale]}
                    </span>
                  )}
                </span>
              </div>
              <div
                className="h-2 rounded-full overflow-hidden"
                style={{ background: "var(--color-border)" }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(2, (r.value / max) * 100)}%`,
                    background: color,
                    opacity: 0.85,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 pt-2 border-t border-[var(--color-border)] text-[10px] text-[var(--color-dim)]">
        {caption}
      </div>
    </div>
  );
}
