"use client";

// Statistiche aggregate PER PROVIDER (canoni di fascia diversa: non si mediano
// insieme). Un toggle sceglie il provider; UNA sola tabella-imbuto
// mostra, per ogni tappa del funnel (Eccellenti ≥80 → Trovate), il totale medio in
// un mese di budget, quante al giorno e il prezzo medio per risultato. Ogni riga ha
// una descrizione (così "Valutate/Scored" e le soglie ≥70/≥80 sono chiare senza
// gergo) e sotto un box "come leggere" con metodo e caveat. I numeri arrivano già
// calcolati dal server; qui solo stato del toggle, etichette localizzate,
// formattazione e la barra proporzionale sul totale trovate.

import { useState } from "react";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import { intlTag } from "@/lib/locale-tag";

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

// Etichetta + descrizione per ogni tappa.
const STAGE: Record<Locale, Record<string, { label: string; desc: string }>> = {
  it: {
    strong80: {
      label: "Eccellenti ≥80",
      desc: "punteggio ≥80 · corrispondenza ottima",
    },
    strong70: {
      label: "Match forti ≥70",
      desc: "punteggio ≥70 · buona corrispondenza",
    },
    scored: {
      label: "Valutate",
      desc: "analizzate, con un punteggio di match (0–100)",
    },
    found: { label: "Trovate", desc: "posizioni scovate dal team" },
  },
  en: {
    strong80: { label: "Excellent ≥80", desc: "score ≥80 · excellent fit" },
    strong70: { label: "Strong match ≥70", desc: "score ≥70 · good fit" },
    scored: { label: "Scored", desc: "analyzed, given a match score (0–100)" },
    found: { label: "Found", desc: "jobs the team collected" },
  },
  es: {
    strong80: {
      label: "Excelentes ≥80",
      desc: "puntuación ≥80 · correspondencia óptima",
    },
    strong70: {
      label: "Match fuerte ≥70",
      desc: "puntuación ≥70 · buena correspondencia",
    },
    scored: {
      label: "Evaluadas",
      desc: "analizadas, con una puntuación de match (0–100)",
    },
    found: {
      label: "Encontradas",
      desc: "posiciones encontradas por el equipo",
    },
  },
  fr: {
    strong80: {
      label: "Excellents ≥80",
      desc: "score ≥80 · correspondance optimale",
    },
    strong70: {
      label: "Match fort ≥70",
      desc: "score ≥70 · bonne correspondance",
    },
    scored: {
      label: "Évaluées",
      desc: "analysées, avec un score de match (0–100)",
    },
    found: { label: "Trouvées", desc: "postes trouvés par l'équipe" },
  },
  de: {
    strong80: {
      label: "Exzellent ≥80",
      desc: "Score ≥80 · exzellente Passung",
    },
    strong70: { label: "Starkes Match ≥70", desc: "Score ≥70 · gute Passung" },
    scored: { label: "Bewertet", desc: "analysiert, mit Match-Score (0–100)" },
    found: { label: "Gefunden", desc: "vom Team gefundene Stellen" },
  },
  hu: {
    strong80: {
      label: "Kiváló ≥80",
      desc: "pontszám ≥80 · kiváló illeszkedés",
    },
    strong70: {
      label: "Erős találat ≥70",
      desc: "pontszám ≥70 · jó illeszkedés",
    },
    scored: { label: "Értékelt", desc: "elemzett, match-pontszámmal (0–100)" },
    found: { label: "Találat", desc: "a csapat által talált pozíciók" },
  },
  pt: {
    strong80: {
      label: "Excelentes ≥80",
      desc: "pontuação ≥80 · correspondência ótima",
    },
    strong70: {
      label: "Match forte ≥70",
      desc: "pontuação ≥70 · boa correspondência",
    },
    scored: {
      label: "Avaliadas",
      desc: "analisadas, com uma pontuação de match (0–100)",
    },
    found: { label: "Encontradas", desc: "posições encontradas pela equipa" },
  },
};

const T: Record<
  Locale,
  {
    title: string;
    subtitle: string;
    perMonth: string;
    avgOver: string;
    caseOne: string;
    caseMany: string;
    colMonth: string;
    colDay: string;
    colPrice: string;
    notesTitle: string;
    methodLabel: string;
    methodText: string;
    relativeLabel: string;
    relativeText: string;
  }
> = {
  it: {
    title: "Quanto rende il team, per provider",
    subtitle:
      "Per un mese di abbonamento: quante posizioni il team produce a ogni livello di qualità e quanto costa ciascun risultato. Diviso per provider, perché Kimi e Codex costano diverso e non vanno mescolati.",
    perMonth: "/mese",
    avgOver: "media su",
    caseOne: "caso",
    caseMany: "casi",
    colMonth: "Totale / mese",
    colDay: "Al giorno",
    colPrice: "Prezzo medio",
    notesTitle: "Come leggere questi dati",
    methodLabel: "Come sono calcolati",
    methodText:
      "Media dei casi del provider proiettata su un mese di budget (free-run escluso). Al giorno = totale del mese ÷ 30; prezzo = canone mensile ÷ output del mese.",
    relativeLabel: "Sono dati relativi",
    relativeText:
      "Dipendono molto dal profilo: la difficoltà del mercato pesa spesso più del provider — un mercato ricco di offerte rende di più a prescindere dal modello. Vanno letti come ordini di grandezza, non come una classifica dei provider.",
  },
  en: {
    title: "What the team delivers, by provider",
    subtitle:
      "Per month of subscription: how many positions the team produces at each quality level, and how much each result costs. Split by provider, because Kimi and Codex cost differently and shouldn't be mixed.",
    perMonth: "/mo",
    avgOver: "averaged over",
    caseOne: "case",
    caseMany: "cases",
    colMonth: "Total / month",
    colDay: "Per day",
    colPrice: "Avg price",
    notesTitle: "How to read this",
    methodLabel: "How they're computed",
    methodText:
      "Average of the provider's cases projected over a month of budget (free-run excluded). Per day = monthly total ÷ 30; price = monthly plan ÷ monthly output.",
    relativeLabel: "The figures are relative",
    relativeText:
      "They depend heavily on the profile: market difficulty often matters more than the provider — an opportunity-rich market yields more regardless of the model. Read them as orders of magnitude, not a ranking of providers.",
  },
  es: {
    title: "Cuánto rinde el equipo, por proveedor",
    subtitle:
      "Por un mes de suscripción: cuántas posiciones produce el equipo en cada nivel de calidad y cuánto cuesta cada resultado. Separado por proveedor, porque Kimi y Codex cuestan distinto y no deben mezclarse.",
    perMonth: "/mes",
    avgOver: "media sobre",
    caseOne: "caso",
    caseMany: "casos",
    colMonth: "Total / mes",
    colDay: "Al día",
    colPrice: "Precio medio",
    notesTitle: "Cómo leer estos datos",
    methodLabel: "Cómo se calculan",
    methodText:
      "Media de los casos del proveedor proyectada sobre un mes de presupuesto (sin el free-run). Al día = total del mes ÷ 30; precio = cuota mensual ÷ output del mes.",
    relativeLabel: "Son datos relativos",
    relativeText:
      "Dependen mucho del perfil: la dificultad del mercado suele pesar más que el proveedor — un mercado con muchas ofertas rinde más sin importar el modelo. Léelos como órdenes de magnitud, no como una clasificación de proveedores.",
  },
  fr: {
    title: "Ce que l'équipe produit, par fournisseur",
    subtitle:
      "Par mois d'abonnement : combien de postes l'équipe produit à chaque niveau de qualité et combien coûte chaque résultat. Séparé par fournisseur, car Kimi et Codex n'ont pas le même prix et ne doivent pas être mélangés.",
    perMonth: "/mois",
    avgOver: "moyenne sur",
    caseOne: "cas",
    caseMany: "cas",
    colMonth: "Total / mois",
    colDay: "Par jour",
    colPrice: "Prix moyen",
    notesTitle: "Comment lire ces données",
    methodLabel: "Comment ils sont calculés",
    methodText:
      "Moyenne des cas du fournisseur projetée sur un mois de budget (free-run exclu). Par jour = total du mois ÷ 30 ; prix = abonnement mensuel ÷ output du mois.",
    relativeLabel: "Des chiffres relatifs",
    relativeText:
      "Ils dépendent fortement du profil : la difficulté du marché pèse souvent plus que le fournisseur — un marché riche en offres produit plus quel que soit le modèle. À lire comme des ordres de grandeur, pas comme un classement des fournisseurs.",
  },
  de: {
    title: "Was das Team liefert, nach Provider",
    subtitle:
      "Pro Monat Abo: wie viele Stellen das Team je Qualitätsstufe produziert und was jedes Ergebnis kostet. Nach Provider getrennt, denn Kimi und Codex kosten unterschiedlich und dürfen nicht vermischt werden.",
    perMonth: "/Mon.",
    avgOver: "Ø über",
    caseOne: "Fall",
    caseMany: "Fälle",
    colMonth: "Gesamt / Monat",
    colDay: "Pro Tag",
    colPrice: "Ø-Preis",
    notesTitle: "So liest du diese Daten",
    methodLabel: "Wie sie berechnet werden",
    methodText:
      "Durchschnitt der Provider-Fälle, auf einen Monat Budget projiziert (ohne Free-Run). Pro Tag = Monatssumme ÷ 30; Preis = Monatsabo ÷ Monatsoutput.",
    relativeLabel: "Relative Zahlen",
    relativeText:
      "Sie hängen stark vom Profil ab: die Marktschwierigkeit wiegt oft schwerer als der Provider — ein angebotsreicher Markt liefert unabhängig vom Modell mehr. Als grobe Größenordnungen zu lesen, nicht als Rangliste der Provider.",
  },
  hu: {
    title: "Mennyit termel a csapat, providerenként",
    subtitle:
      "Egy hónap előfizetésre: hány pozíciót termel a csapat az egyes minőségi szinteken, és mennyibe kerül egy-egy eredmény. Providerenként külön, mert a Kimi és a Codex ára eltér, és nem szabad összekeverni.",
    perMonth: "/hó",
    avgOver: "átlag",
    caseOne: "eset",
    caseMany: "eset",
    colMonth: "Összesen / hó",
    colDay: "Naponta",
    colPrice: "Átlagár",
    notesTitle: "Hogyan olvasd ezeket",
    methodLabel: "Hogyan számoljuk",
    methodText:
      "A provider eseteinek átlaga, egy hónap budgetre vetítve (free-run nélkül). Naponta = havi összeg ÷ 30; ár = havi előfizetés ÷ havi output.",
    relativeLabel: "Relatív adatok",
    relativeText:
      "Erősen függnek a profiltól: a piac nehézsége gyakran többet nyom a latban, mint a provider — egy ajánlatokban gazdag piac a modelltől függetlenül többet termel. Nagyságrendként olvasd, nem a providerek rangsoraként.",
  },
  pt: {
    title: "Quanto rende a equipa, por fornecedor",
    subtitle:
      "Por um mês de subscrição: quantas posições a equipa produz em cada nível de qualidade e quanto custa cada resultado. Separado por fornecedor, porque Kimi e Codex custam de forma diferente e não se devem misturar.",
    perMonth: "/mês",
    avgOver: "média sobre",
    caseOne: "caso",
    caseMany: "casos",
    colMonth: "Total / mês",
    colDay: "Por dia",
    colPrice: "Preço médio",
    notesTitle: "Como ler estes dados",
    methodLabel: "Como são calculados",
    methodText:
      "Média dos casos do fornecedor projetada sobre um mês de orçamento (sem o free-run). Por dia = total do mês ÷ 30; preço = mensalidade ÷ output do mês.",
    relativeLabel: "São dados relativos",
    relativeText:
      "Dependem muito do perfil: a dificuldade do mercado pesa muitas vezes mais do que o fornecedor — um mercado rico em ofertas rende mais independentemente do modelo. Lê-os como ordens de grandeza, não como uma classificação de fornecedores.",
  },
};

export default function ProviderStats({
  providers,
}: {
  providers: ProviderData[];
}) {
  const locale = useLocale();
  const tag = intlTag(locale);
  const t = T[locale];
  const stage = STAGE[locale];
  const [sel, setSel] = useState(providers[0]?.id ?? "");
  const p = providers.find((x) => x.id === sel) ?? providers[0];

  if (!p) return null;

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
    <section className="mb-16">
      <h2 className="text-2xl sm:text-[28px] font-bold tracking-tight">
        {t.title}
      </h2>
      <p className="mt-3 text-[15px] leading-relaxed text-[var(--color-muted)]">
        {t.subtitle}
      </p>

      {/* toggle provider */}
      <div className="mt-6 flex flex-wrap items-center gap-2.5">
        {providers.map((prov) => {
          const on = prov.id === p.id;
          return (
            <button
              key={prov.id}
              type="button"
              aria-pressed={on}
              onClick={() => setSel(prov.id)}
              className={`rounded-full border px-5 py-2 text-[14px] font-semibold transition-colors ${
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
        <span className="text-[12px] text-[var(--color-dim)]">
          {t.avgOver} {p.nCases} {casesWord}
        </span>
      </div>

      {/* tabella-imbuto */}
      <div className="mt-6 bg-[var(--color-card)] border border-[var(--color-border)] p-6 sm:p-7">
        {/* intestazioni colonne */}
        <div className="flex items-end gap-4 pb-3 mb-4 border-b border-[var(--color-border)]">
          <span className="w-3 shrink-0" />
          <span className="flex-1" />
          <div className="flex items-end gap-8">
            <span className="w-24 text-right text-[11px] font-semibold uppercase tracking-wide leading-tight text-[var(--color-dim)]">
              {t.colMonth}
            </span>
            <span className="w-16 text-right text-[11px] font-semibold uppercase tracking-wide leading-tight text-[var(--color-dim)]">
              {t.colDay}
            </span>
            <span className="w-24 text-right text-[11px] font-semibold uppercase tracking-wide leading-tight text-[var(--color-dim)]">
              {t.colPrice}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          {p.rows.map((r) => {
            const color = COLOR[r.key] ?? "#22C55E";
            const s = stage[r.key];
            return (
              <div key={r.key}>
                <div className="flex items-start gap-4 mb-2">
                  <span
                    className="mt-1.5 inline-block w-3 h-3 rounded-sm shrink-0"
                    style={{ background: color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-semibold text-[var(--color-base)]">
                      {s?.label ?? r.key}
                    </div>
                    {s?.desc && (
                      <div className="text-[12px] leading-snug text-[var(--color-dim)]">
                        {s.desc}
                      </div>
                    )}
                  </div>
                  <div className="flex items-baseline gap-8">
                    <span className="w-24 text-right text-[19px] font-bold tabular-nums text-[var(--color-base)]">
                      {nf(r.count)}
                    </span>
                    <span className="w-16 text-right text-[15px] tabular-nums text-[var(--color-muted)]">
                      {nf(r.perDay)}
                    </span>
                    <span className="w-24 text-right text-[15px] tabular-nums text-[var(--color-muted)]">
                      ≈ {eur(r.price)}
                    </span>
                  </div>
                </div>
                <div
                  className="h-2.5 rounded-full overflow-hidden"
                  style={{ background: "var(--color-border)" }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(2, (r.count / max) * 100)}%`,
                      background: color,
                      opacity: 0.9,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* come leggere: metodo + relatività, raggruppati */}
      <div className="mt-4 border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-card)_55%,transparent)] p-6">
        <div className="text-[13px] font-bold uppercase tracking-wide text-[var(--color-base)] mb-3">
          {t.notesTitle}
        </div>
        <ul className="space-y-3 text-[13px] leading-relaxed text-[var(--color-muted)]">
          <li className="flex gap-2.5">
            <span
              className="mt-2 h-1.5 w-1.5 rounded-full shrink-0"
              style={{ background: "var(--color-blue)" }}
            />
            <span>
              <strong className="font-semibold text-[var(--color-base)]">
                {t.methodLabel}.
              </strong>{" "}
              {t.methodText}
            </span>
          </li>
          <li className="flex gap-2.5">
            <span
              className="mt-2 h-1.5 w-1.5 rounded-full shrink-0"
              style={{ background: "#F59E0B" }}
            />
            <span>
              <strong className="font-semibold text-[var(--color-base)]">
                {t.relativeLabel}.
              </strong>{" "}
              {t.relativeText}
            </span>
          </li>
        </ul>
      </div>
    </section>
  );
}
