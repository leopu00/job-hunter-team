"use client";

// Costo per RISULTATO su una run ~mensile. L'abbonamento AI è mensile e a costo
// fisso (es. €100/mese): su una run lunga circa un ciclo mensile, dividere il
// canone per i risultati prodotti dà il costo reale per posizione / valutata /
// match forte / eccellente. Su run più corte non è rappresentativo (si pagherebbe
// il mese intero per meno output) → questa sezione si mostra solo per run lunghe.

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

const T: Record<
  Locale,
  {
    title: string;
    lead: (eur: string, days: number) => string;
    perPosition: string;
    perScored: string;
    perStrong: string;
    perExcellent: string;
    chartTitle: string;
    inMonth: string;
    caption: string;
  }
> = {
  it: {
    title: "💶 Quanto costa ogni risultato",
    lead: (eur, days) =>
      `L'abbonamento è mensile e a costo fisso (${eur}/mese). Questa run dura ~${days} giorni — circa un ciclo mensile — quindi dividere il canone per ciò che ha prodotto dà il costo REALE di ogni risultato.`,
    perPosition: "per posizione trovata",
    perScored: "per posizione valutata",
    perStrong: "per match forte ≥70",
    perExcellent: "per match eccellente ≥80",
    chartTitle: "Costo per risultato · a parità di canone mensile",
    inMonth: "nel mese",
    caption:
      "Più alto è il livello di qualità richiesto, più sale il costo per singolo risultato.",
  },
  en: {
    title: "💶 What each result costs",
    lead: (eur, days) =>
      `The subscription is monthly and fixed (${eur}/mo). This run lasts ~${days} days — about one monthly cycle — so dividing the fee by what it produced gives the REAL cost of each result.`,
    perPosition: "per position found",
    perScored: "per position scored",
    perStrong: "per strong match ≥70",
    perExcellent: "per excellent match ≥80",
    chartTitle: "Cost per result · for the same monthly fee",
    inMonth: "in the month",
    caption:
      "The higher the quality bar, the higher the cost per single result.",
  },
  es: {
    title: "💶 Cuánto cuesta cada resultado",
    lead: (eur, days) =>
      `La suscripción es mensual y de coste fijo (${eur}/mes). Esta ejecución dura ~${days} días — aproximadamente un ciclo mensual — así que dividir la cuota entre lo que produjo da el coste REAL de cada resultado.`,
    perPosition: "por posición encontrada",
    perScored: "por posición evaluada",
    perStrong: "por match fuerte ≥70",
    perExcellent: "por match excelente ≥80",
    chartTitle: "Coste por resultado · a igual cuota mensual",
    inMonth: "en el mes",
    caption:
      "Cuanto mayor es el nivel de calidad exigido, más sube el coste por resultado.",
  },
  fr: {
    title: "💶 Combien coûte chaque résultat",
    lead: (eur, days) =>
      `L'abonnement est mensuel et à coût fixe (${eur}/mois). Ce run dure ~${days} jours — environ un cycle mensuel — donc diviser l'abonnement par ce qu'il a produit donne le coût RÉEL de chaque résultat.`,
    perPosition: "par poste trouvé",
    perScored: "par poste évalué",
    perStrong: "par match fort ≥70",
    perExcellent: "par match excellent ≥80",
    chartTitle: "Coût par résultat · à abonnement mensuel égal",
    inMonth: "dans le mois",
    caption:
      "Plus le niveau de qualité exigé est élevé, plus le coût par résultat augmente.",
  },
  de: {
    title: "💶 Was jedes Ergebnis kostet",
    lead: (eur, days) =>
      `Das Abo ist monatlich und fix (${eur}/Monat). Dieser Lauf dauert ~${days} Tage — etwa ein Monatszyklus — also ergibt die Gebühr geteilt durch das Produzierte die REALEN Kosten pro Ergebnis.`,
    perPosition: "pro gefundener Stelle",
    perScored: "pro bewerteter Stelle",
    perStrong: "pro starkem Match ≥70",
    perExcellent: "pro exzellentem Match ≥80",
    chartTitle: "Kosten pro Ergebnis · bei gleicher Monatsgebühr",
    inMonth: "im Monat",
    caption:
      "Je höher die geforderte Qualität, desto höher die Kosten pro einzelnem Ergebnis.",
  },
  hu: {
    title: "💶 Mennyibe kerül egy-egy eredmény",
    lead: (eur, days) =>
      `Az előfizetés havi és fix díjú (${eur}/hó). Ez a futás ~${days} napig tart — nagyjából egy havi ciklus — így a díjat elosztva a termeléssel megkapjuk minden eredmény VALÓS költségét.`,
    perPosition: "talált pozíciónként",
    perScored: "értékelt pozíciónként",
    perStrong: "erős match ≥70",
    perExcellent: "kiváló match ≥80",
    chartTitle: "Költség eredményenként · azonos havi díj mellett",
    inMonth: "a hónapban",
    caption:
      "Minél magasabb a megkövetelt minőség, annál nagyobb az egy eredményre jutó költség.",
  },
  pt: {
    title: "💶 Quanto custa cada resultado",
    lead: (eur, days) =>
      `A subscrição é mensal e de custo fixo (${eur}/mês). Esta execução dura ~${days} dias — cerca de um ciclo mensal — por isso dividir a mensalidade pelo que produziu dá o custo REAL de cada resultado.`,
    perPosition: "por posição encontrada",
    perScored: "por posição avaliada",
    perStrong: "por match forte ≥70",
    perExcellent: "por match excelente ≥80",
    chartTitle: "Custo por resultado · com a mesma mensalidade",
    inMonth: "no mês",
    caption:
      "Quanto maior o nível de qualidade exigido, maior o custo por resultado.",
  },
};

// Stessi colori dei livelli nel funnel di conversione, per coerenza visiva.
const COLORS = ["#3B82F6", "#0EA5A4", "#22C55E", "#F59E0B"];

export default function CostPerOutcome({
  monthlyEur,
  found,
  scored,
  strong70,
  strong80,
  days,
}: {
  monthlyEur: number;
  found: number;
  scored: number;
  strong70: number;
  strong80: number;
  days: number;
}) {
  const locale = useLocale();
  const t = T[locale];
  const tag = LOCALE_TAG[locale];
  const nf = (n: number) => n.toLocaleString(tag);
  const eur = (n: number, dp: number) =>
    new Intl.NumberFormat(tag, {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: dp,
      maximumFractionDigits: dp,
    }).format(n);

  const tiers = [
    { label: t.perPosition, count: found, color: COLORS[0] },
    { label: t.perScored, count: scored, color: COLORS[1] },
    { label: t.perStrong, count: strong70, color: COLORS[2] },
    { label: t.perExcellent, count: strong80, color: COLORS[3] },
  ].map((x) => ({ ...x, cost: x.count > 0 ? monthlyEur / x.count : 0 }));
  const maxCost = Math.max(...tiers.map((x) => x.cost), 0.0001);

  return (
    <>
      <div className="section-label mb-1">{t.title}</div>
      <p className="text-[11px] text-[var(--color-dim)] mb-6 max-w-3xl">
        {t.lead(eur(monthlyEur, 0), days)}
      </p>

      {/* Card: costo per ciascun livello */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tiers.map((tier) => (
          <div
            key={tier.label}
            className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-4"
          >
            <div
              className="text-[22px] font-extrabold tabular-nums leading-none"
              style={{ color: tier.color }}
            >
              {eur(tier.cost, 2)}
            </div>
            <div className="mt-1.5 text-[10px] leading-snug text-[var(--color-muted)]">
              {tier.label}
            </div>
            <div className="mt-2 text-[9px] tabular-nums text-[var(--color-dim)]">
              {nf(tier.count)} {t.inMonth}
            </div>
          </div>
        ))}
      </div>

      {/* Grafico: costo per risultato (barre, larghezza ∝ costo) */}
      <div className="mt-6 bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-6">
        <div className="text-[12px] font-semibold text-[var(--color-base)] mb-4">
          {t.chartTitle}
        </div>
        <div className="flex flex-col gap-3">
          {tiers.map((tier) => (
            <div key={tier.label}>
              <div className="flex items-baseline gap-2 mb-1">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ background: tier.color }}
                />
                <span className="text-[11px] text-[var(--color-muted)] flex-1 truncate">
                  {tier.label}
                </span>
                <span className="text-[13px] font-bold tabular-nums text-[var(--color-base)]">
                  {eur(tier.cost, 2)}
                </span>
              </div>
              <div
                className="h-2 rounded-full overflow-hidden"
                style={{ background: "var(--color-border)" }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(2, (tier.cost / maxCost) * 100)}%`,
                    background: tier.color,
                    opacity: 0.85,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-2 border-t border-[var(--color-border)] text-[10px] text-[var(--color-dim)]">
          {t.caption}
        </div>
      </div>
    </>
  );
}
