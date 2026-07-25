"use client";

// Costo per RISULTATO. L'abbonamento AI è mensile e a costo fisso (es. €100/mese):
// la domanda è "quanto costa ogni posizione / match forte / eccellente in un mese".
//
// Due modalità:
//  - MISURATO: la run copre già ~un ciclo mensile (es. finance ~26 giorni) → si
//    divide il canone per l'output reale.
//  - STIMATO: run più corta e budget-limited → si PROIETTA l'output a un mese
//    intero. La proiezione NON è "giorni × 30" (sovrastima: le run brevi bruciano
//    in fretta il budget settimanale), ma si basa sul BUDGET consumato: quante
//    settimane-di-budget ha speso la run → quante ne spende un mese (~4,3). Il
//    moltiplicatore arriva già calcolato (`multiplier`), qui si applica ai conteggi.

import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import { intlTag } from "@/lib/locale-tag";

const T: Record<
  Locale,
  {
    title: string;
    estimate: string;
    lead: (eur: string, days: number) => string;
    leadEst: (eur: string, days: number) => string;
    perPosition: string;
    perScored: string;
    perStrong: string;
    perExcellent: string;
    chartTitle: string;
    inMonth: string;
    perMonth: string;
    caption: string;
  }
> = {
  it: {
    title: "💶 Quanto costa ogni risultato",
    estimate: "stima",
    lead: (eur, days) =>
      `L'abbonamento è mensile e a costo fisso (${eur}/mese). Questa run dura ~${days} giorni — circa un ciclo mensile — quindi dividere il canone per ciò che ha prodotto dà il costo REALE di ogni risultato.`,
    leadEst: (eur, days) =>
      `Run di ~${days} giorni: proiettiamo l'output a un mese intero di abbonamento (${eur}/mese) in base al budget realmente consumato (non a "giorni × 30", che sovrastima). È una STIMA — per numeri certi serve una run di un mese pieno.`,
    perPosition: "per posizione trovata",
    perScored: "per posizione valutata",
    perStrong: "per match forte ≥70",
    perExcellent: "per match eccellente ≥80",
    chartTitle: "Costo per risultato · a parità di canone mensile",
    inMonth: "nel mese",
    perMonth: "/mese",
    caption:
      "Più alto è il livello di qualità richiesto, più sale il costo per singolo risultato.",
  },
  en: {
    title: "💶 What each result costs",
    estimate: "estimate",
    lead: (eur, days) =>
      `The subscription is monthly and fixed (${eur}/mo). This run lasts ~${days} days — about one monthly cycle — so dividing the fee by what it produced gives the REAL cost of each result.`,
    leadEst: (eur, days) =>
      `~${days}-day run: we project the output to a full month of subscription (${eur}/mo) based on the budget actually used (not "days × 30", which overstates). It's an ESTIMATE — solid numbers need a full-month run.`,
    perPosition: "per position found",
    perScored: "per position scored",
    perStrong: "per strong match ≥70",
    perExcellent: "per excellent match ≥80",
    chartTitle: "Cost per result · for the same monthly fee",
    inMonth: "in the month",
    perMonth: "/mo",
    caption:
      "The higher the quality bar, the higher the cost per single result.",
  },
  es: {
    title: "💶 Cuánto cuesta cada resultado",
    estimate: "estimación",
    lead: (eur, days) =>
      `La suscripción es mensual y de coste fijo (${eur}/mes). Esta ejecución dura ~${days} días — aproximadamente un ciclo mensual — así que dividir la cuota entre lo que produjo da el coste REAL de cada resultado.`,
    leadEst: (eur, days) =>
      `Ejecución de ~${days} días: proyectamos el output a un mes completo de suscripción (${eur}/mes) según el presupuesto realmente usado (no "días × 30", que sobreestima). Es una ESTIMACIÓN — para datos firmes hace falta una ejecución de un mes entero.`,
    perPosition: "por posición encontrada",
    perScored: "por posición evaluada",
    perStrong: "por match fuerte ≥70",
    perExcellent: "por match excelente ≥80",
    chartTitle: "Coste por resultado · a igual cuota mensual",
    inMonth: "en el mes",
    perMonth: "/mes",
    caption:
      "Cuanto mayor es el nivel de calidad exigido, más sube el coste por resultado.",
  },
  fr: {
    title: "💶 Combien coûte chaque résultat",
    estimate: "estimation",
    lead: (eur, days) =>
      `L'abonnement est mensuel et à coût fixe (${eur}/mois). Ce run dure ~${days} jours — environ un cycle mensuel — donc diviser l'abonnement par ce qu'il a produit donne le coût RÉEL de chaque résultat.`,
    leadEst: (eur, days) =>
      `Run de ~${days} jours : nous projetons l'output sur un mois complet d'abonnement (${eur}/mois) selon le budget réellement consommé (pas "jours × 30", qui surestime). C'est une ESTIMATION — des chiffres fiables nécessitent un run d'un mois entier.`,
    perPosition: "par poste trouvé",
    perScored: "par poste évalué",
    perStrong: "par match fort ≥70",
    perExcellent: "par match excellent ≥80",
    chartTitle: "Coût par résultat · à abonnement mensuel égal",
    inMonth: "dans le mois",
    perMonth: "/mois",
    caption:
      "Plus le niveau de qualité exigé est élevé, plus le coût par résultat augmente.",
  },
  de: {
    title: "💶 Was jedes Ergebnis kostet",
    estimate: "Schätzung",
    lead: (eur, days) =>
      `Das Abo ist monatlich und fix (${eur}/Monat). Dieser Lauf dauert ~${days} Tage — etwa ein Monatszyklus — also ergibt die Gebühr geteilt durch das Produzierte die REALEN Kosten pro Ergebnis.`,
    leadEst: (eur, days) =>
      `Lauf über ~${days} Tage: Wir projizieren den Output auf einen vollen Abo-Monat (${eur}/Monat) anhand des tatsächlich verbrauchten Budgets (nicht "Tage × 30", was überschätzt). Es ist eine SCHÄTZUNG — verlässliche Zahlen brauchen einen vollen Monatslauf.`,
    perPosition: "pro gefundener Stelle",
    perScored: "pro bewerteter Stelle",
    perStrong: "pro starkem Match ≥70",
    perExcellent: "pro exzellentem Match ≥80",
    chartTitle: "Kosten pro Ergebnis · bei gleicher Monatsgebühr",
    inMonth: "im Monat",
    perMonth: "/Monat",
    caption:
      "Je höher die geforderte Qualität, desto höher die Kosten pro einzelnem Ergebnis.",
  },
  hu: {
    title: "💶 Mennyibe kerül egy-egy eredmény",
    estimate: "becslés",
    lead: (eur, days) =>
      `Az előfizetés havi és fix díjú (${eur}/hó). Ez a futás ~${days} napig tart — nagyjából egy havi ciklus — így a díjat elosztva a termeléssel megkapjuk minden eredmény VALÓS költségét.`,
    leadEst: (eur, days) =>
      `~${days} napos futás: az outputot egy teljes előfizetési hónapra vetítjük (${eur}/hó) a ténylegesen elhasznált budget alapján (nem "nap × 30", ami túlbecsül). Ez BECSLÉS — pontos számokhoz teljes hónapos futás kell.`,
    perPosition: "talált pozíciónként",
    perScored: "értékelt pozíciónként",
    perStrong: "erős match ≥70",
    perExcellent: "kiváló match ≥80",
    chartTitle: "Költség eredményenként · azonos havi díj mellett",
    inMonth: "a hónapban",
    perMonth: "/hó",
    caption:
      "Minél magasabb a megkövetelt minőség, annál nagyobb az egy eredményre jutó költség.",
  },
  pt: {
    title: "💶 Quanto custa cada resultado",
    estimate: "estimativa",
    lead: (eur, days) =>
      `A subscrição é mensal e de custo fixo (${eur}/mês). Esta execução dura ~${days} dias — cerca de um ciclo mensal — por isso dividir a mensalidade pelo que produziu dá o custo REAL de cada resultado.`,
    leadEst: (eur, days) =>
      `Execução de ~${days} dias: projetamos o output para um mês completo de subscrição (${eur}/mês) com base no orçamento realmente usado (não "dias × 30", que sobrestima). É uma ESTIMATIVA — números fiáveis exigem uma execução de um mês inteiro.`,
    perPosition: "por posição encontrada",
    perScored: "por posição avaliada",
    perStrong: "por match forte ≥70",
    perExcellent: "por match excelente ≥80",
    chartTitle: "Custo por resultado · com a mesma mensalidade",
    inMonth: "no mês",
    perMonth: "/mês",
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
  multiplier = 1,
  estimated = false,
}: {
  monthlyEur: number;
  found: number;
  scored: number;
  strong70: number;
  strong80: number;
  days: number;
  /** fattore di proiezione a un mese (1 = misurato, >1 = run breve proiettata) */
  multiplier?: number;
  /** true = costo STIMATO (output proiettato a un mese), false = misurato */
  estimated?: boolean;
}) {
  const locale = useLocale();
  const t = T[locale];
  const tag = intlTag(locale);
  const nf = (n: number) => Math.round(n).toLocaleString(tag);
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
  ].map((x) => {
    const monthly = x.count * multiplier; // output proiettato al mese
    return { ...x, monthly, cost: monthly > 0 ? monthlyEur / monthly : 0 };
  });
  const maxCost = Math.max(...tiers.map((x) => x.cost), 0.0001);
  const pfx = estimated ? "≈ " : "";

  return (
    <>
      <div className="flex items-center gap-2 mb-1">
        <span className="section-label">{t.title}</span>
        {estimated && (
          <span
            className="text-[9px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5"
            style={{
              background: "color-mix(in srgb, #F59E0B 16%, transparent)",
              color: "#F59E0B",
            }}
          >
            {t.estimate}
          </span>
        )}
      </div>
      <p className="text-[11px] text-[var(--color-dim)] mb-6 max-w-3xl">
        {(estimated ? t.leadEst : t.lead)(eur(monthlyEur, 0), days)}
      </p>

      {/* Card: costo per ciascun livello */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tiers.map((tier) => (
          <div
            key={tier.label}
            className="border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-4"
          >
            <div
              className="text-[22px] font-extrabold tabular-nums leading-none"
              style={{ color: tier.color }}
            >
              {pfx}
              {eur(tier.cost, 2)}
            </div>
            <div className="mt-1.5 text-[10px] leading-snug text-[var(--color-muted)]">
              {tier.label}
            </div>
            <div className="mt-2 text-[9px] tabular-nums text-[var(--color-dim)]">
              {estimated
                ? `~${nf(tier.monthly)}${t.perMonth}`
                : `${nf(tier.monthly)} ${t.inMonth}`}
            </div>
          </div>
        ))}
      </div>

      {/* Grafico: costo per risultato (barre, larghezza ∝ costo) */}
      <div className="mt-6 bg-[var(--color-card)] border border-[var(--color-border)] p-6">
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
                  {pfx}
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
