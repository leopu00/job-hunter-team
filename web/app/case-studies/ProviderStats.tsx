"use client";

// Statistiche aggregate PER PROVIDER (Kimi ~€40 vs Codex ~€100: prezzi diversi,
// non si mediano insieme). Un toggle sceglie il provider; UNA sola tabella-imbuto
// mostra, per ogni tappa del funnel (Eccellenti ≥80 → Trovate), il totale medio in
// un mese di budget, quante al giorno e il prezzo medio per risultato. I numeri
// arrivano già calcolati dal server (media dei casi del provider, proiettata su un
// mese, free-run escluso); qui solo lo stato del toggle, le etichette localizzate,
// i colori e la formattazione. La barra è la proporzione sul totale trovate.

import { useState } from "react";
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

export type ProviderRow = {
  key: string; // found | scored | strong70 | strong80
  count: number;
  perDay: number;
  price: number;
};
export type ProviderData = {
  id: string; // "Kimi" | "Codex"
  monthlyEur: number | null;
  nCases: number;
  rows: ProviderRow[];
};

// Colori coerenti con le altre card (blu → teal → verde → ambra): dal livello più
// ampio (trovate) al più selettivo (eccellenti ≥80).
const COLOR: Record<string, string> = {
  found: "#3B82F6",
  scored: "#0EA5A4",
  strong70: "#22C55E",
  strong80: "#F59E0B",
};

const STAGE_LABEL: Record<Locale, Record<string, string>> = {
  it: { strong80: "Eccellenti ≥80", strong70: "Match forti ≥70", scored: "Valutate", found: "Trovate" },
  en: { strong80: "Excellent ≥80", strong70: "Strong match ≥70", scored: "Scored", found: "Found" },
  es: { strong80: "Excelentes ≥80", strong70: "Match fuerte ≥70", scored: "Evaluadas", found: "Encontradas" },
  fr: { strong80: "Excellents ≥80", strong70: "Match fort ≥70", scored: "Évaluées", found: "Trouvées" },
  de: { strong80: "Exzellent ≥80", strong70: "Starkes Match ≥70", scored: "Bewertet", found: "Gefunden" },
  hu: { strong80: "Kiváló ≥80", strong70: "Erős találat ≥70", scored: "Értékelt", found: "Találat" },
  pt: { strong80: "Excelentes ≥80", strong70: "Match forte ≥70", scored: "Avaliadas", found: "Encontradas" },
};

const T: Record<
  Locale,
  {
    title: string;
    lead: string;
    colMonth: string;
    colDay: string;
    colPrice: string;
    perMonth: string;
    avgOver: string;
    caseOne: string;
    caseMany: string;
    footer: string;
    disclaimer: string;
  }
> = {
  it: {
    title: "Dal trovato all'eccellente · per provider",
    lead: "Scegli il provider: i numeri sono aggregati per abbonamento (Kimi e Codex costano diverso, non vanno mischiati). Per ogni livello, in un mese di budget: quante posizioni, quante al giorno e il prezzo medio per singolo risultato.",
    colMonth: "Totale / mese",
    colDay: "Al giorno",
    colPrice: "Prezzo medio",
    perMonth: "/mese",
    avgOver: "media su",
    caseOne: "caso",
    caseMany: "casi",
    footer:
      "Media dei casi del provider, proiettata su un mese di budget (free-run escluso). Al giorno = totale del mese ÷ 30; prezzo = canone mensile ÷ output del mese.",
    disclaimer:
      "I numeri dipendono molto dal profilo: la difficoltà del mercato di riferimento pesa spesso più del provider. I casi aggregati per ciascun provider hanno profili e mercati diversi — un mercato ricco di offerte produce un output più alto a prescindere dal modello — quindi il confronto non è a parità di condizioni: vanno letti come ordini di grandezza indicativi, non come una classifica dei provider.",
  },
  en: {
    title: "From found to excellent · by provider",
    lead: "Pick the provider: figures are aggregated per subscription (Kimi and Codex cost differently, they don't mix). For each level, over a month of budget: how many positions, how many per day, and the average price per single result.",
    colMonth: "Total / month",
    colDay: "Per day",
    colPrice: "Avg price",
    perMonth: "/mo",
    avgOver: "averaged over",
    caseOne: "case",
    caseMany: "cases",
    footer:
      "Average of the provider's cases, projected over a month of budget (free-run excluded). Per day = monthly total ÷ 30; price = monthly plan ÷ monthly output.",
    disclaimer:
      "The figures depend heavily on the profile: the difficulty of the target job market often matters more than the provider. The cases aggregated under each provider have different profiles and markets — an opportunity-rich market yields higher output regardless of the model — so the comparison isn't like-for-like: read them as indicative orders of magnitude, not as a ranking of providers.",
  },
  es: {
    title: "De encontrada a excelente · por proveedor",
    lead: "Elige el proveedor: los números se agregan por suscripción (Kimi y Codex cuestan distinto, no se mezclan). Por cada nivel, en un mes de presupuesto: cuántas posiciones, cuántas al día y el precio medio por resultado.",
    colMonth: "Total / mes",
    colDay: "Al día",
    colPrice: "Precio medio",
    perMonth: "/mes",
    avgOver: "media sobre",
    caseOne: "caso",
    caseMany: "casos",
    footer:
      "Media de los casos del proveedor, proyectada sobre un mes de presupuesto (sin el free-run). Al día = total del mes ÷ 30; precio = cuota mensual ÷ output del mes.",
    disclaimer:
      "Los números dependen mucho del perfil: la dificultad del mercado objetivo suele pesar más que el proveedor. Los casos agregados en cada proveedor tienen perfiles y mercados distintos — un mercado con muchas ofertas da un output más alto sin importar el modelo — así que la comparación no es en igualdad de condiciones: léelos como órdenes de magnitud indicativos, no como una clasificación de proveedores.",
  },
  fr: {
    title: "De trouvé à excellent · par fournisseur",
    lead: "Choisis le fournisseur : les chiffres sont agrégés par abonnement (Kimi et Codex n'ont pas le même prix, on ne les mélange pas). Pour chaque niveau, sur un mois de budget : combien de postes, combien par jour et le prix moyen par résultat.",
    colMonth: "Total / mois",
    colDay: "Par jour",
    colPrice: "Prix moyen",
    perMonth: "/mois",
    avgOver: "moyenne sur",
    caseOne: "cas",
    caseMany: "cas",
    footer:
      "Moyenne des cas du fournisseur, projetée sur un mois de budget (free-run exclu). Par jour = total du mois ÷ 30 ; prix = abonnement mensuel ÷ output du mois.",
    disclaimer:
      "Les chiffres dépendent fortement du profil : la difficulté du marché ciblé pèse souvent plus que le fournisseur. Les cas agrégés par fournisseur ont des profils et des marchés différents — un marché riche en offres donne un output plus élevé quel que soit le modèle — donc la comparaison n'est pas à conditions égales : à lire comme des ordres de grandeur indicatifs, pas comme un classement des fournisseurs.",
  },
  de: {
    title: "Von gefunden zu exzellent · nach Provider",
    lead: "Wähle den Provider: die Zahlen sind je Abo aggregiert (Kimi und Codex kosten unterschiedlich, sie werden nicht vermischt). Je Stufe, in einem Monat Budget: wie viele Stellen, wie viele pro Tag und der Durchschnittspreis pro Ergebnis.",
    colMonth: "Gesamt / Monat",
    colDay: "Pro Tag",
    colPrice: "Ø-Preis",
    perMonth: "/Mon.",
    avgOver: "Ø über",
    caseOne: "Fall",
    caseMany: "Fälle",
    footer:
      "Durchschnitt der Provider-Fälle, auf einen Monat Budget projiziert (ohne Free-Run). Pro Tag = Monatssumme ÷ 30; Preis = Monatsabo ÷ Monatsoutput.",
    disclaimer:
      "Die Zahlen hängen stark vom Profil ab: die Schwierigkeit des Zielmarkts wiegt oft schwerer als der Provider. Die je Provider aggregierten Fälle haben unterschiedliche Profile und Märkte — ein angebotsreicher Markt liefert unabhängig vom Modell höheren Output — daher ist der Vergleich nicht gleichwertig: als grobe Größenordnungen zu lesen, nicht als Rangliste der Provider.",
  },
  hu: {
    title: "A találattól a kiválóig · providerenként",
    lead: "Válaszd ki a providert: a számok előfizetésenként összesítve (a Kimi és a Codex ára eltér, nem keverjük). Szintenként, egy hónap budget alatt: hány pozíció, naponta mennyi, és az átlagár eredményenként.",
    colMonth: "Összesen / hó",
    colDay: "Naponta",
    colPrice: "Átlagár",
    perMonth: "/hó",
    avgOver: "átlag",
    caseOne: "eset",
    caseMany: "eset",
    footer:
      "A provider eseteinek átlaga, egy hónap budgetre vetítve (free-run nélkül). Naponta = havi összeg ÷ 30; ár = havi előfizetés ÷ havi output.",
    disclaimer:
      "A számok erősen függnek a profiltól: a célpiac nehézsége gyakran többet nyom a latban, mint a provider. Az egyes providerekhez összesített esetek eltérő profilúak és piacúak — egy ajánlatokban gazdag piac a modelltől függetlenül magasabb outputot ad —, így az összehasonlítás nem azonos feltételek mellett történik: nagyságrendi tájékoztató értékként olvasd, nem a providerek rangsoraként.",
  },
  pt: {
    title: "De encontrada a excelente · por fornecedor",
    lead: "Escolhe o fornecedor: os números são agregados por subscrição (Kimi e Codex custam de forma diferente, não se misturam). Por cada nível, num mês de orçamento: quantas posições, quantas por dia e o preço médio por resultado.",
    colMonth: "Total / mês",
    colDay: "Por dia",
    colPrice: "Preço médio",
    perMonth: "/mês",
    avgOver: "média sobre",
    caseOne: "caso",
    caseMany: "casos",
    footer:
      "Média dos casos do fornecedor, projetada sobre um mês de orçamento (sem o free-run). Por dia = total do mês ÷ 30; preço = mensalidade ÷ output do mês.",
    disclaimer:
      "Os números dependem muito do perfil: a dificuldade do mercado-alvo pesa muitas vezes mais do que o fornecedor. Os casos agregados por fornecedor têm perfis e mercados diferentes — um mercado rico em ofertas dá um output mais alto independentemente do modelo — por isso a comparação não é em igualdade de condições: lê-os como ordens de grandeza indicativas, não como uma classificação de fornecedores.",
  },
};

export default function ProviderStats({ providers }: { providers: ProviderData[] }) {
  const locale = useLocale();
  const tag = LOCALE_TAG[locale];
  const t = T[locale];
  const [sel, setSel] = useState(providers[0]?.id ?? "");
  const p = providers.find((x) => x.id === sel) ?? providers[0];

  if (!p) return null;

  const label = STAGE_LABEL[locale];
  const nf = (n: number) => Math.round(n).toLocaleString(tag);
  const eur = (n: number) =>
    new Intl.NumberFormat(tag, {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  const max = Math.max(...p.rows.map((r) => r.count), 1);
  const casesWord = p.nCases === 1 ? t.caseOne : t.caseMany;

  return (
    <section className="mb-14">
      <h2 className="text-xl font-bold tracking-tight">{t.title}</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-muted)]">
        {t.lead}
      </p>

      {/* toggle provider */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {providers.map((prov) => {
          const on = prov.id === p.id;
          return (
            <button
              key={prov.id}
              type="button"
              aria-pressed={on}
              onClick={() => setSel(prov.id)}
              className={`rounded-full border px-4 py-1.5 text-[12px] font-semibold transition-colors ${
                on
                  ? "border-[var(--color-blue)] text-[var(--color-white)]"
                  : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-white)]"
              }`}
              style={
                on
                  ? {
                      background:
                        "color-mix(in srgb, var(--color-blue) 18%, transparent)",
                    }
                  : undefined
              }
            >
              {prov.id}
              {prov.monthlyEur != null && (
                <span className="font-normal text-[var(--color-dim)]">
                  {" "}
                  · €{prov.monthlyEur}
                  {t.perMonth}
                </span>
              )}
            </button>
          );
        })}
        <span className="text-[11px] text-[var(--color-dim)]">
          {t.avgOver} {p.nCases} {casesWord}
        </span>
      </div>

      {/* tabella-imbuto: una riga per tappa, tre colonne + barra proporzionale */}
      <div className="mt-5 bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-6">
        <div className="flex items-baseline gap-2 mb-3 text-[9px] uppercase tracking-wide text-[var(--color-dim)]">
          <span className="w-2.5 shrink-0" />
          <span className="flex-1" />
          <span className="w-16 text-right">{t.colMonth}</span>
          <span className="w-14 text-right">{t.colDay}</span>
          <span className="w-20 text-right">{t.colPrice}</span>
        </div>
        <div className="flex flex-col gap-3">
          {p.rows.map((r) => {
            const color = COLOR[r.key] ?? "#22C55E";
            return (
              <div key={r.key}>
                <div className="flex items-baseline gap-2 mb-1">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ background: color }}
                  />
                  <span className="flex-1 truncate text-[11px] text-[var(--color-muted)]">
                    {label[r.key] ?? r.key}
                  </span>
                  <span className="w-16 text-right text-[13px] font-bold tabular-nums text-[var(--color-base)]">
                    {nf(r.count)}
                  </span>
                  <span className="w-14 text-right text-[12px] tabular-nums text-[var(--color-muted)]">
                    {nf(r.perDay)}
                  </span>
                  <span className="w-20 text-right text-[12px] tabular-nums text-[var(--color-muted)]">
                    ≈ {eur(r.price)}
                  </span>
                </div>
                <div
                  className="h-2 rounded-full overflow-hidden"
                  style={{ background: "var(--color-border)" }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(2, (r.count / max) * 100)}%`,
                      background: color,
                      opacity: 0.85,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 pt-2 border-t border-[var(--color-border)] space-y-2 text-[10px] leading-relaxed text-[var(--color-dim)]">
          <p>{t.footer}</p>
          <p className="italic">{t.disclaimer}</p>
        </div>
      </div>
    </section>
  );
}
