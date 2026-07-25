"use client";

// Dettaglio di un beta tester: profilo anonimo → match → dove → categorie →
// come ha lavorato. In cima uno switcher COLLASSABILE (non una sidebar fissa)
// per saltare a un altro case study.

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  rememberCurrentSection,
  restoreSection,
} from "@/lib/case-study-scroll";
import type { CaseStudyProfile, CaseStudyPhase } from "@/lib/case-studies";
import type { CaseStudyRun, CaseStudyUsage } from "@/lib/case-study";
import type { TeamActivity } from "@/lib/team-activity";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import CaseStudyOverview from "./CaseStudyOverview";
import WorkBudgetChart from "./WorkBudgetChart";
import IntradayBudgetChart from "./IntradayBudgetChart";
import SourcesScoreChart from "./SourcesScoreChart";
import SourcesAvgScoreChart from "./SourcesAvgScoreChart";
import SourcesDonutChart from "./SourcesDonutChart";
import PositionsFunnelChart from "./PositionsFunnelChart";
import ExcludedDonut from "./ExcludedDonut";
import ConversionFunnelCard from "./ConversionFunnelCard";
import CostPerOutcome from "./CostPerOutcome";
import DailyHighScore from "./DailyHighScore";
import { caseMonthlyProjection } from "@/lib/case-studies";
import { intlTag } from "@/lib/locale-tag";

export interface PreparedCase {
  id: string;
  label: string;
  tagline: string;
  subscription: {
    provider: string;
    plan: string;
    price: string;
    monthlyEur?: number;
  };
  profile: CaseStudyProfile;
  phases?: CaseStudyPhase[];
  maintainerNote?: string[];
  run: CaseStudyRun; // events alleggeriti
  activity: TeamActivity;
}

export interface CaseRef {
  id: string;
  label: string;
  tagline: string;
  badge: string;
}

// Abbreviazioni dei mesi localizzate (gen…dic) via Intl, con il tag locale.
function monthShort(locale: Locale, monthIndex0: number): string {
  // 2021 = anno qualunque; usiamo il giorno 1 di ogni mese.
  const d = new Date(Date.UTC(2021, monthIndex0, 1));
  return new Intl.DateTimeFormat(intlTag(locale), {
    month: "short",
    timeZone: "UTC",
  }).format(d);
}

function dayLabel(locale: Locale, key: string): string {
  const [, m, d] = key.split("-");
  return `${Number(d)} ${monthShort(locale, Number(m) - 1) ?? ""}`.trim();
}

function nf(locale: Locale, n: number): string {
  return n.toLocaleString(intlTag(locale));
}

// Abbreviazioni dei giorni della settimana localizzate (lun…dom) via Intl.
// 2021-08-02 era un lunedì → offset 0..6 = lun..dom.
function dowLabels(locale: Locale): Record<string, string> {
  const keys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const fmt = new Intl.DateTimeFormat(intlTag(locale), {
    weekday: "short",
    timeZone: "UTC",
  });
  const out: Record<string, string> = {};
  keys.forEach((k, i) => {
    out[k] = fmt.format(new Date(Date.UTC(2021, 7, 2 + i)));
  });
  return out;
}

// Rende il grassetto **così** dentro un paragrafo (nota del manutentore): split
// sul marcatore, i segmenti a indice dispari sono le parti da evidenziare.
function renderBold(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((seg, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold text-[var(--color-white)]">
        {seg}
      </strong>
    ) : (
      <span key={i}>{seg}</span>
    ),
  );
}

const T: Record<
  Locale,
  {
    caseStudies: string;
    allCaseStudies: string;
    backToOverview: string;
    anonymousProfile: string;
    aiSubscriptionUsed: string;
    onlyExpense: string;
    whereSearches: string;
    runRealPrefix: string;
    runRealDays: string; // parola "giorni di lavoro" (mostrata tra parentesi)
    runRealSuffix: string; // coda: nota di anonimato
    everyDay: string;
    monFri: string;
    workBudgetTitle: string;
    workBudgetBars: string;
    workBudgetLines: string;
    workBudgetProse1: string; // "sono le azioni del team al giorno (per ruolo); le"
    workBudgetProse2: string; // "mostrano quanto del piano AI settimanale..."
    sourcesTitle: string;
    sourcesProse1: string; // "Le fonti da cui lo Scout ha trovato le"
    sourcesProse2: string; // "posizioni: job board, ATS e pagine carriera aziendali."
    sourcesTimeCaption: string; // didascalia grafico fonti-nel-tempo
    sourcesScoreTitle: string; // titolo grafico fonti volume+score nel tempo
    sourcesScoreCaption: string; // didascalia grafico fonti + score medio
    sourcesAvgCaption: string; // didascalia grafico score medio per fonte
    funnelTitle: string; // titolo sezione funnel trovate→escluse/tenute
    funnelProse: string; // didascalia sezione funnel
    funnelChartTitle: string; // titolo grafico funnel giornaliero
    funnelDonutTitle: string; // titolo donut tenute vs escluse
    conversionTitle: string; // titolo card statistiche di conversione
    breadcrumbAria: string; // aria-label della navigazione breadcrumb
    maintainerNoteLabel: string; // kicker della card "Nota del manutentore"
    maintainerNoteSign: string; // firma in coda alla nota
  }
> = {
  it: {
    caseStudies: "Case studies",
    allCaseStudies: "Tutti i case study",
    backToOverview: "Torna alla panoramica",
    anonymousProfile: "profilo anonimo",
    aiSubscriptionUsed: "Abbonamento AI usato",
    onlyExpense: "È l’unica spesa: la piattaforma è gratis.",
    whereSearches: "Dove cerca lavoro",
    runRealPrefix: "Run reale del team su questo profilo · finestra",
    runRealDays: "giorni di lavoro",
    runRealSuffix: "ogni dato è aggregato e anonimo.",
    everyDay: "tutti i giorni",
    monFri: "lun–ven",
    workBudgetTitle: "Lavoro e budget AI nel tempo",
    workBudgetBars: "Barre",
    workBudgetLines: "linee",
    workBudgetProse1: "sono le azioni del team al giorno (per ruolo); le",
    workBudgetProse2:
      "mostrano quanto del piano AI settimanale è stato consumato — quel giorno e cumulato sulla settimana (reset giovedì). Il budget si spalma sui giorni invece di bruciarsi subito.",
    sourcesTitle: "Da dove arrivano le posizioni",
    sourcesTimeCaption:
      "Le stesse posizioni nel tempo: quante ne sono arrivate ogni giorno, divise per fonte.",
    sourcesScoreTitle: "Volume e score per fonte, nel tempo",
    sourcesScoreCaption:
      "E la qualità per fonte: le linee mostrano lo score medio giornaliero di ogni provider (asse destro), sopra le barre delle posizioni.",
    sourcesAvgCaption:
      "Lo score medio e la quota per fonte, sulle posizioni valutate (quelle con uno score): a sinistra la qualità media, a destra la distribuzione % delle fonti.",
    sourcesProse1: "Le fonti da cui lo Scout ha trovato le",
    sourcesProse2: "posizioni: job board, ATS e pagine carriera aziendali.",
    funnelTitle: "Quante posizioni vengono tenute",
    funnelProse:
      "Di tutte le posizioni trovate, quante superano i filtri (località, work-auth, pertinenza) e quante vengono escluse — giorno per giorno e in totale.",
    funnelChartTitle: "Trovate: tenute vs escluse · giorno per giorno",
    funnelDonutTitle: "Tenute vs escluse · totale",
    conversionTitle: "Statistiche di conversione",
    breadcrumbAria: "Percorso di navigazione",
    maintainerNoteLabel: "Nota del manutentore",
    maintainerNoteSign: "— Il manutentore",
  },
  en: {
    caseStudies: "Case studies",
    allCaseStudies: "All case studies",
    backToOverview: "Back to overview",
    anonymousProfile: "anonymous profile",
    aiSubscriptionUsed: "AI subscription used",
    onlyExpense: "It’s the only expense: the platform is free.",
    whereSearches: "Where they search for work",
    runRealPrefix: "Real team run on this profile · window",
    runRealDays: "working days",
    runRealSuffix: "every figure is aggregated and anonymous.",
    everyDay: "every day",
    monFri: "Mon–Fri",
    workBudgetTitle: "Work and AI budget over time",
    workBudgetBars: "Bars",
    workBudgetLines: "lines",
    workBudgetProse1: "are the team’s actions per day (by role); the",
    workBudgetProse2:
      "show how much of the weekly AI plan was used — that day and cumulatively over the week (resets on Thursday). The budget spreads across the days instead of burning out at once.",
    sourcesTitle: "Where the positions come from",
    sourcesTimeCaption:
      "The same positions over time: how many arrived each day, split by source.",
    sourcesScoreTitle: "Volume and score by source, over time",
    sourcesScoreCaption:
      "And quality by source: the lines show each provider's daily average score (right axis), over the position bars.",
    sourcesAvgCaption:
      "Average score and share by source, over scored positions (those with a score): on the left the average quality, on the right the % distribution of sources.",
    sourcesProse1: "The sources where the Scout found the",
    sourcesProse2: "positions: job boards, ATS and company career pages.",
    funnelTitle: "How many positions are kept",
    funnelProse:
      "Of all the positions found, how many pass the filters (location, work authorization, relevance) and how many are excluded — day by day and overall.",
    funnelChartTitle: "Found: kept vs excluded · day by day",
    funnelDonutTitle: "Kept vs excluded · total",
    conversionTitle: "Conversion statistics",
    breadcrumbAria: "Breadcrumb",
    maintainerNoteLabel: "Maintainer's note",
    maintainerNoteSign: "— The maintainer",
  },
  es: {
    caseStudies: "Casos de estudio",
    allCaseStudies: "Todos los casos de estudio",
    backToOverview: "Volver al resumen",
    anonymousProfile: "perfil anónimo",
    aiSubscriptionUsed: "Suscripción de AI usada",
    onlyExpense: "Es el único gasto: la plataforma es gratis.",
    whereSearches: "Dónde busca trabajo",
    runRealPrefix: "Ejecución real del equipo sobre este perfil · ventana",
    runRealDays: "días de trabajo",
    runRealSuffix: "cada dato está agregado y es anónimo.",
    everyDay: "todos los días",
    monFri: "lun–vie",
    workBudgetTitle: "Trabajo y presupuesto de AI a lo largo del tiempo",
    workBudgetBars: "Barras",
    workBudgetLines: "líneas",
    workBudgetProse1: "son las acciones del equipo por día (por rol); las",
    workBudgetProse2:
      "muestran cuánto del plan de AI semanal se ha consumido — ese día y acumulado en la semana (se reinicia el jueves). El presupuesto se reparte entre los días en lugar de agotarse de golpe.",
    sourcesTitle: "De dónde vienen las posiciones",
    sourcesTimeCaption:
      "Las mismas posiciones en el tiempo: cuántas llegaron cada día, por fuente.",
    sourcesScoreTitle: "Volumen y score por fuente, en el tiempo",
    sourcesScoreCaption:
      "Y la calidad por fuente: las líneas muestran el score medio diario de cada proveedor (eje derecho), sobre las barras de posiciones.",
    sourcesAvgCaption:
      "El score medio y la cuota por fuente, sobre las posiciones evaluadas (las que tienen score): a la izquierda la calidad media, a la derecha la distribución % de las fuentes.",
    sourcesProse1: "Las fuentes donde el Scout encontró las",
    sourcesProse2:
      "posiciones: portales de empleo, ATS y páginas de carrera de las empresas.",
    funnelTitle: "Cuántas posiciones se conservan",
    funnelProse:
      "De todas las posiciones encontradas, cuántas pasan los filtros (ubicación, autorización de trabajo, relevancia) y cuántas se excluyen — día a día y en total.",
    funnelChartTitle: "Encontradas: conservadas vs excluidas · día a día",
    funnelDonutTitle: "Conservadas vs excluidas · total",
    conversionTitle: "Estadísticas de conversión",
    breadcrumbAria: "Ruta de navegación",
    maintainerNoteLabel: "Nota del mantenedor",
    maintainerNoteSign: "— El mantenedor",
  },
  fr: {
    caseStudies: "Études de cas",
    allCaseStudies: "Toutes les études de cas",
    backToOverview: "Retour à la vue d’ensemble",
    anonymousProfile: "profil anonyme",
    aiSubscriptionUsed: "Abonnement AI utilisé",
    onlyExpense: "C’est la seule dépense : la plateforme est gratuite.",
    whereSearches: "Où il cherche du travail",
    runRealPrefix: "Exécution réelle de l’équipe sur ce profil · fenêtre",
    runRealDays: "jours de travail",
    runRealSuffix: "chaque donnée est agrégée et anonyme.",
    everyDay: "tous les jours",
    monFri: "lun–ven",
    workBudgetTitle: "Travail et budget AI au fil du temps",
    workBudgetBars: "Barres",
    workBudgetLines: "lignes",
    workBudgetProse1: "sont les actions de l’équipe par jour (par rôle) ; les",
    workBudgetProse2:
      "montrent quelle part du plan AI hebdomadaire a été consommée — ce jour-là et cumulée sur la semaine (réinitialisation le jeudi). Le budget s’étale sur les jours au lieu de s’épuiser d’un coup.",
    sourcesTitle: "D’où viennent les postes",
    sourcesTimeCaption:
      "Les mêmes postes dans le temps : combien sont arrivés chaque jour, par source.",
    sourcesScoreTitle: "Volume et score par source, dans le temps",
    sourcesScoreCaption:
      "Et la qualité par source : les lignes montrent le score moyen quotidien de chaque source (axe droit), au-dessus des barres de postes.",
    sourcesAvgCaption:
      "Le score moyen et la part par source, sur les postes évalués (ceux avec un score) : à gauche la qualité moyenne, à droite la répartition % des sources.",
    sourcesProse1: "Les sources où le Scout a trouvé les",
    sourcesProse2:
      "postes : sites d’emploi, ATS et pages carrières des entreprises.",
    funnelTitle: "Combien de postes sont conservés",
    funnelProse:
      "Sur tous les postes trouvés, combien passent les filtres (localisation, autorisation de travail, pertinence) et combien sont exclus — jour par jour et au total.",
    funnelChartTitle: "Trouvés : conservés vs exclus · jour par jour",
    funnelDonutTitle: "Conservés vs exclus · total",
    conversionTitle: "Statistiques de conversion",
    breadcrumbAria: "Fil d'Ariane",
    maintainerNoteLabel: "Note du mainteneur",
    maintainerNoteSign: "— Le mainteneur",
  },
  de: {
    caseStudies: "Fallstudien",
    allCaseStudies: "Alle Fallstudien",
    backToOverview: "Zurück zur Übersicht",
    anonymousProfile: "anonymes Profil",
    aiSubscriptionUsed: "Verwendetes AI-Abo",
    onlyExpense: "Es ist die einzige Ausgabe: Die Plattform ist kostenlos.",
    whereSearches: "Wo nach Arbeit gesucht wird",
    runRealPrefix: "Echter Team-Lauf für dieses Profil · Zeitfenster",
    runRealDays: "Arbeitstage",
    runRealSuffix: "jeder Wert ist aggregiert und anonym.",
    everyDay: "jeden Tag",
    monFri: "Mo–Fr",
    workBudgetTitle: "Arbeit und AI-Budget im Zeitverlauf",
    workBudgetBars: "Balken",
    workBudgetLines: "Linien",
    workBudgetProse1: "sind die Aktionen des Teams pro Tag (nach Rolle); die",
    workBudgetProse2:
      "zeigen, wie viel des wöchentlichen AI-Plans verbraucht wurde — an diesem Tag und kumuliert über die Woche (Reset am Donnerstag). Das Budget verteilt sich über die Tage, statt sofort aufgebraucht zu werden.",
    sourcesTitle: "Woher die Positionen kommen",
    sourcesTimeCaption:
      "Dieselben Positionen im Zeitverlauf: wie viele pro Tag kamen, nach Quelle.",
    sourcesScoreTitle: "Volumen und Score je Quelle, im Zeitverlauf",
    sourcesScoreCaption:
      "Und die Qualität je Quelle: die Linien zeigen den täglichen Durchschnitts-Score jeder Quelle (rechte Achse), über den Stellen-Balken.",
    sourcesAvgCaption:
      "Durchschnitts-Score und Anteil je Quelle, über die bewerteten Positionen (mit Score): links die Durchschnittsqualität, rechts die prozentuale Verteilung der Quellen.",
    sourcesProse1: "Die Quellen, in denen der Scout die",
    sourcesProse2:
      "Positionen gefunden hat: Jobbörsen, ATS und Karriereseiten von Unternehmen.",
    funnelTitle: "Wie viele Positionen behalten werden",
    funnelProse:
      "Von allen gefundenen Positionen: wie viele die Filter passieren (Ort, Arbeitserlaubnis, Relevanz) und wie viele ausgeschlossen werden — Tag für Tag und insgesamt.",
    funnelChartTitle: "Gefunden: behalten vs. ausgeschlossen · Tag für Tag",
    funnelDonutTitle: "Behalten vs. ausgeschlossen · gesamt",
    conversionTitle: "Conversion-Statistik",
    breadcrumbAria: "Brotkrümelnavigation",
    maintainerNoteLabel: "Notiz des Betreuers",
    maintainerNoteSign: "— Der Betreuer",
  },
  hu: {
    caseStudies: "Esettanulmányok",
    allCaseStudies: "Összes esettanulmány",
    backToOverview: "Vissza az áttekintéshez",
    anonymousProfile: "névtelen profil",
    aiSubscriptionUsed: "Használt AI-előfizetés",
    onlyExpense: "Ez az egyetlen költség: a platform ingyenes.",
    whereSearches: "Hol keres munkát",
    runRealPrefix: "Valódi csapatfuttatás ezen a profilon · időablak",
    runRealDays: "munkanap",
    runRealSuffix: "minden adat összesített és névtelen.",
    everyDay: "minden nap",
    monFri: "hét–pén",
    workBudgetTitle: "Munka és AI-keret az idő során",
    workBudgetBars: "Oszlopok",
    workBudgetLines: "vonalak",
    workBudgetProse1: "a csapat napi műveletei (szerepkörönként); a",
    workBudgetProse2:
      "azt mutatják, mennyit használtak fel a heti AI-keretből — aznap és a hétre kumulálva (csütörtökön nullázódik). A keret eloszlik a napok között, ahelyett, hogy egyszerre elfogyna.",
    sourcesTitle: "Honnan érkeznek a pozíciók",
    sourcesTimeCaption:
      "Ugyanazok a pozíciók időben: hányat találtunk naponta, források szerint.",
    sourcesScoreTitle: "Volumen és pontszám forrásonként, időben",
    sourcesScoreCaption:
      "És a minőség forrásonként: a vonalak az egyes források napi átlagpontszámát mutatják (jobb tengely), a pozíció-oszlopok felett.",
    sourcesAvgCaption:
      "Átlagpontszám és arány forrásonként, az értékelt pozíciókon (amelyeknek van pontszáma): balra az átlagos minőség, jobbra a források százalékos megoszlása.",
    sourcesProse1: "A források, ahol a Scout megtalálta a",
    sourcesProse2:
      "pozíciókat: állásportálok, ATS és vállalati karrieroldalak.",
    funnelTitle: "Hány pozíciót tartunk meg",
    funnelProse:
      "Az összes megtalált pozícióból hány megy át a szűrőkön (helyszín, munkavállalási engedély, relevancia) és hány kerül kizárásra — naponta és összesen.",
    funnelChartTitle: "Találatok: megtartott vs. kizárt · naponta",
    funnelDonutTitle: "Megtartott vs. kizárt · összesen",
    conversionTitle: "Konverziós statisztika",
    breadcrumbAria: "Morzsamenü",
    maintainerNoteLabel: "A karbantartó megjegyzése",
    maintainerNoteSign: "— A karbantartó",
  },
  pt: {
    caseStudies: "Estudos de caso",
    allCaseStudies: "Todos os estudos de caso",
    backToOverview: "Voltar à visão geral",
    anonymousProfile: "perfil anónimo",
    aiSubscriptionUsed: "Subscrição de AI usada",
    onlyExpense: "É a única despesa: a plataforma é gratuita.",
    whereSearches: "Onde procura trabalho",
    runRealPrefix: "Execução real da equipa sobre este perfil · janela",
    runRealDays: "dias de trabalho",
    runRealSuffix: "cada dado é agregado e anónimo.",
    everyDay: "todos os dias",
    monFri: "seg–sex",
    workBudgetTitle: "Trabalho e orçamento de AI ao longo do tempo",
    workBudgetBars: "Barras",
    workBudgetLines: "linhas",
    workBudgetProse1: "são as ações da equipa por dia (por função); as",
    workBudgetProse2:
      "mostram quanto do plano de AI semanal foi consumido — nesse dia e acumulado ao longo da semana (reinicia à quinta-feira). O orçamento distribui-se pelos dias em vez de se esgotar de uma vez.",
    sourcesTitle: "De onde vêm as posições",
    sourcesTimeCaption:
      "As mesmas posições ao longo do tempo: quantas chegaram por dia, por fonte.",
    sourcesScoreTitle: "Volume e score por fonte, ao longo do tempo",
    sourcesScoreCaption:
      "E a qualidade por fonte: as linhas mostram o score médio diário de cada provedor (eixo direito), sobre as barras de posições.",
    sourcesAvgCaption:
      "O score médio e a quota por fonte, sobre as posições avaliadas (as que têm score): à esquerda a qualidade média, à direita a distribuição % das fontes.",
    sourcesProse1: "As fontes onde o Scout encontrou as",
    sourcesProse2:
      "posições: portais de emprego, ATS e páginas de carreira das empresas.",
    funnelTitle: "Quantas posições são mantidas",
    funnelProse:
      "De todas as posições encontradas, quantas passam os filtros (localização, autorização de trabalho, relevância) e quantas são excluídas — dia a dia e no total.",
    funnelChartTitle: "Encontradas: mantidas vs excluídas · dia a dia",
    funnelDonutTitle: "Mantidas vs excluídas · total",
    conversionTitle: "Estatísticas de conversão",
    breadcrumbAria: "Trilho de navegação",
    maintainerNoteLabel: "Nota do mantenedor",
    maintainerNoteSign: "— O mantenedor",
  },
};

export default function CaseStudyDetail({
  current,
  all,
}: {
  current: PreparedCase;
  all: CaseRef[];
}) {
  const locale = useLocale();
  const t = T[locale];
  const [menuOpen, setMenuOpen] = useState(false);
  const { run, activity, profile, phases } = current;

  // Cambiando tester (stesso componente, nuovo id) riallinea alla stessa sezione
  // ricordata dal menu; al primo ingresso non c'è nulla in sospeso → resta in cima.
  useEffect(() => {
    restoreSection();
  }, [current.id]);

  const activeDays = activity.roleDaily.filter((d) =>
    Object.values(d.counts).some((n) => n > 0),
  ).length;

  // Costo per risultato: misurato (run ~mensile) o stimato (proiezione a un mese).
  const { estimated: costEstimated, multiplier: costMultiplier } =
    caseMonthlyProjection(run, activeDays);

  const fromKey = run.tsRange[0].slice(0, 10);
  const toKey = run.tsRange[1].slice(0, 10);

  // Ruoli con attività (per il grafico unico lavoro+budget).
  const activeRoles = activity.roles.filter((r) => activity.roleTotals[r] > 0);

  // Orario di lavoro formattato (contesto sulla distribuzione del budget).
  const DOW = dowLabels(locale);
  const fmtDays = (days: string[]) => {
    const all = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const s = new Set(days);
    if (all.every((d) => s.has(d))) return t.everyDay;
    if (
      ["mon", "tue", "wed", "thu", "fri"].every((d) => s.has(d)) &&
      !s.has("sat") &&
      !s.has("sun")
    )
      return t.monFri;
    return days.map((d) => DOW[d] ?? d).join(", ");
  };
  const wh = run.usage?.workingHours;
  const whText = wh
    ? wh.windows
        .map((w) => `${fmtDays(w.days)} · ${w.start}–${w.end}`)
        .join(" / ") + (wh.timezone ? ` (${wh.timezone})` : "")
    : null;

  return (
    <div className="space-y-12">
      {/* ── Toolbar: breadcrumb + switcher collassabile ───────── */}
      <div className="flex items-center justify-between gap-3">
        <nav
          aria-label={t.breadcrumbAria}
          className="flex items-center gap-2 text-[11px] min-w-0"
        >
          <Link
            href="/case-studies"
            className="text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
          >
            {t.caseStudies}
          </Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">
            /
          </span>
          <span className="text-[var(--color-muted)] truncate">
            {current.label}
          </span>
        </nav>

        {/* Switcher a tendina: solo su mobile — su desktop (lg+) c'è la sidebar
            collassabile dei tester, quindi qui sarebbe ridondante. */}
        <div className="relative shrink-0 lg:hidden">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            className="flex items-center gap-2 border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-muted)] hover:border-[var(--color-blue)] hover:text-[var(--color-white)] transition-colors"
          >
            ☰ {t.allCaseStudies}
            <span
              className="text-[8px]"
              style={{ transform: menuOpen ? "rotate(180deg)" : "none" }}
            >
              ▾
            </span>
          </button>
          {menuOpen && (
            <>
              {/* backdrop per chiudere */}
              <div
                className="fixed inset-0 z-40"
                onClick={() => setMenuOpen(false)}
                aria-hidden="true"
              />
              <div className="absolute right-0 mt-2 w-64 z-50 border border-[var(--color-border)] bg-[var(--color-card)] p-1.5 shadow-xl">
                {all.map((c) => {
                  const active = c.id === current.id;
                  return (
                    <Link
                      key={c.id}
                      href={`/case-studies/${c.id}`}
                      scroll={false}
                      onClick={() => {
                        rememberCurrentSection();
                        setMenuOpen(false);
                      }}
                      className="flex items-center gap-2.5 px-2.5 py-2 no-underline transition-colors hover:bg-[var(--color-bg)]"
                      style={{
                        background: active
                          ? "color-mix(in srgb, var(--color-blue) 12%, transparent)"
                          : undefined,
                      }}
                    >
                      <span
                        className="inline-flex items-center justify-center w-7 h-7 text-[11px] font-bold shrink-0"
                        style={{
                          background: active
                            ? "var(--color-blue)"
                            : "var(--color-bg)",
                          color: active ? "#0a0a0a" : "var(--color-muted)",
                        }}
                      >
                        {c.badge}
                      </span>
                      <div className="min-w-0">
                        <div className="text-[12px] font-bold text-[var(--color-white)]">
                          {c.label}
                        </div>
                        <div className="text-[9px] text-[var(--color-dim)] truncate">
                          {c.tagline}
                        </div>
                      </div>
                    </Link>
                  );
                })}
                <div className="border-t border-[var(--color-border)] mt-1 pt-1">
                  <Link
                    href="/case-studies"
                    onClick={() => setMenuOpen(false)}
                    className="block px-2.5 py-2 text-[11px] text-[var(--color-dim)] hover:text-[var(--color-muted)] hover:bg-[var(--color-bg)] no-underline transition-colors"
                  >
                    ← {t.backToOverview}
                  </Link>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Profilo ───────────────────────────────────────────── */}
      <header id="cs-profile" data-cs-anchor="profile">
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] p-6 sm:p-8">
          {/* Riga alta: testo a sinistra (piena larghezza) + abbonamento a destra */}
          <div className="flex flex-col lg:flex-row lg:items-stretch gap-6">
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-semibold tracking-[0.16em] uppercase text-[var(--color-dim)]">
                {current.label} · {t.anonymousProfile}
              </div>
              <h1 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight leading-tight">
                {profile.headline}
              </h1>
              <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-muted)]">
                {profile.summary}
              </p>
            </div>

            {/* Abbonamento AI usato — l'unica spesa reale */}
            <div
              className="lg:w-64 shrink-0 px-4 py-4 flex flex-col justify-center"
              style={{
                border:
                  "1px solid color-mix(in srgb, #00e676 40%, transparent)",
                background: "color-mix(in srgb, #00e676 8%, transparent)",
              }}
            >
              <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-wide text-[var(--color-dim)]">
                <span aria-hidden className="text-[14px]">
                  🧠
                </span>
                {t.aiSubscriptionUsed}
              </div>
              <div className="mt-1.5 text-[15px] font-bold text-[var(--color-white)] leading-snug">
                {current.subscription.provider}
              </div>
              <div className="mt-0.5 text-[12px] text-[var(--color-muted)]">
                {current.subscription.plan} ·{" "}
                <span className="font-bold" style={{ color: "#00e676" }}>
                  {current.subscription.price}
                </span>
              </div>
              <div className="mt-2 text-[10px] text-[var(--color-dim)] leading-relaxed">
                {t.onlyExpense}
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4 border-t border-[var(--color-border)] pt-6">
            {profile.facts.map((f) => (
              <div key={f.label}>
                <div className="text-[9px] uppercase tracking-wide text-[var(--color-dim)]">
                  {f.label}
                </div>
                <div className="text-[13px] font-semibold text-[var(--color-white)] mt-1">
                  {f.value}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 border-t border-[var(--color-border)] pt-6">
            <div className="text-[9px] uppercase tracking-wide text-[var(--color-dim)] mb-2">
              {t.whereSearches}
            </div>
            <p className="text-[12px] text-[var(--color-muted)] leading-relaxed mb-3">
              {profile.locationNote}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {profile.targetCities.map((city) => (
                <span
                  key={city}
                  className="text-[11px] font-medium rounded-full px-2.5 py-1 border border-[var(--color-border)] text-[var(--color-muted)]"
                >
                  {city}
                </span>
              ))}
            </div>
          </div>
        </div>

        <p className="mt-4 text-[12px] text-[var(--color-muted)] px-1">
          {t.runRealPrefix}{" "}
          <strong className="text-[var(--color-base)]">
            {dayLabel(locale, fromKey)} → {dayLabel(locale, toKey)}
          </strong>{" "}
          ({activeDays} {t.runRealDays}) · {t.runRealSuffix}
        </p>
      </header>

      {/* ── Match · Dove · Categorie ──────────────────────────── */}
      <CaseStudyOverview run={run} />

      {/* ── Lavoro e budget nel tempo (grafico unico, doppio asse) ── */}
      {run.usage && run.usage.daily.length > 0 && (
        <section id="cs-budget" data-cs-anchor="budget">
          <div className="section-label mb-1">📈 {t.workBudgetTitle}</div>
          <p className="text-[11px] text-[var(--color-dim)] mb-4">
            <strong className="text-[var(--color-muted)]">
              {t.workBudgetBars}
            </strong>{" "}
            {t.workBudgetProse1}{" "}
            <strong className="text-[var(--color-muted)]">
              {t.workBudgetLines}
            </strong>{" "}
            {t.workBudgetProse2}
          </p>
          {phases && phases.length > 0 ? (
            // Run multi-fase (es. Codex poi Kimi): un grafico PER FASE, così non si
            // mescolano sessioni con modello/abbonamento/modalità diversi.
            <div className="space-y-8">
              {phases.map((ph) => {
                const within = (d: string) =>
                  d >= ph.from && (ph.to == null || d <= ph.to);
                const u: CaseStudyUsage = {
                  ...run.usage!,
                  daily: run.usage!.daily.filter((x) => within(x.day)),
                };
                const rd = activity.roleDaily.filter((x) => within(x.date));
                if (u.daily.length === 0) return null;
                return (
                  <div key={ph.key}>
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 mb-2.5">
                      <span className="text-[13px] font-bold text-[var(--color-white)]">
                        {ph.label}
                      </span>
                      <span
                        className="text-[10px] font-semibold px-2 py-0.5"
                        style={{
                          background:
                            "color-mix(in srgb, var(--color-blue) 14%, transparent)",
                          color: "var(--color-blue)",
                        }}
                      >
                        {ph.price}
                      </span>
                      <span className="text-[10px] text-[var(--color-dim)]">
                        {ph.note}
                      </span>
                    </div>
                    <div className="bg-[var(--color-card)] border border-[var(--color-border)] p-6">
                      {ph.detail === "hourly" && run.hourly ? (
                        // Fase corta (es. free-run): dettaglio ora per ora.
                        <IntradayBudgetChart
                          hourly={run.hourly.filter((x) =>
                            within(x.hour.slice(0, 10)),
                          )}
                          roles={activeRoles}
                        />
                      ) : (
                        <WorkBudgetChart
                          usage={u}
                          roleDaily={rd}
                          roles={activeRoles}
                          workingHoursText={ph.to == null ? whText : null}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] p-6">
              <WorkBudgetChart
                usage={run.usage}
                roleDaily={activity.roleDaily}
                roles={activeRoles}
                workingHoursText={whText}
              />
            </div>
          )}
        </section>
      )}

      {/* ── Da dove arrivano le posizioni (fonti) ─────────────── */}
      {run.sourcesDaily &&
        run.sourcesDaily.length > 0 &&
        run.sourcesScoreDaily &&
        run.sourcesScoreDaily.length > 0 &&
        run.sourcesDailyKeys &&
        run.sourcesDailyKeys.length > 0 && (
          <section
            id="cs-sources"
            data-cs-anchor="sources"
            className="pt-10 border-t border-[var(--color-border)]"
          >
            <div className="section-label mb-1">📥 {t.sourcesTitle}</div>
            <p className="text-[11px] text-[var(--color-dim)] mb-6">
              {t.sourcesProse1} {nf(locale, run.totals.positions)}{" "}
              {t.sourcesProse2}
            </p>

            {/* posizioni/giorno per fonte + score medio/giorno (interattivo) */}
            <div className="text-[12px] font-semibold text-[var(--color-base)] mb-1">
              {t.sourcesScoreTitle}
            </div>
            <p className="text-[11px] text-[var(--color-dim)] mb-4">
              {t.sourcesScoreCaption}
            </p>
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] p-6">
              <SourcesScoreChart
                daily={run.sourcesDaily}
                scoreDaily={run.sourcesScoreDaily}
                keys={run.sourcesDailyKeys}
              />
            </div>

            {/* score medio + distribuzione % per fonte (sulle valutate) */}
            {run.sourcesScore && run.sourcesScore.length > 0 && (
              <>
                <p className="text-[11px] text-[var(--color-dim)] mt-8 mb-4">
                  {t.sourcesAvgCaption}
                </p>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
                  <SourcesAvgScoreChart
                    rows={run.sourcesScore}
                    keys={run.sourcesDailyKeys}
                  />
                  <SourcesDonutChart
                    rows={run.sourcesScore}
                    keys={run.sourcesDailyKeys}
                  />
                </div>
              </>
            )}
          </section>
        )}

      {/* ── Funnel: trovate → tenute vs escluse (sezione nuova) ──────── */}
      {run.funnelDaily && run.funnelDaily.length > 0 && run.funnelTotals && (
        <section
          id="cs-funnel"
          data-cs-anchor="funnel"
          className="pt-10 border-t border-[var(--color-border)]"
        >
          <div className="section-label mb-1">🪣 {t.funnelTitle}</div>
          <p className="text-[11px] text-[var(--color-dim)] mb-6">
            {t.funnelProse}
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-6 items-stretch">
            {/* sinistra: grafico giornaliero — titolo SOPRA la card, card riempita */}
            <div className="flex flex-col">
              <div className="text-[12px] font-semibold text-[var(--color-base)] mb-3">
                {t.funnelChartTitle}
              </div>
              <div className="bg-[var(--color-card)] border border-[var(--color-border)] p-6 flex-1 flex flex-col">
                <PositionsFunnelChart daily={run.funnelDaily} />
              </div>
            </div>
            {/* destra: donut + conversione — titoli SOPRA le card */}
            <div className="flex flex-col gap-6">
              <div>
                <div className="text-[12px] font-semibold text-[var(--color-base)] mb-3">
                  {t.funnelDonutTitle}
                </div>
                <ExcludedDonut
                  kept={run.funnelTotals.kept}
                  excluded={run.funnelTotals.excluded}
                />
              </div>
              <div>
                <div className="text-[12px] font-semibold text-[var(--color-base)] mb-3">
                  {t.conversionTitle}
                </div>
                {/* Imbuto a POSIZIONI DISTINTE, monotòno per costruzione (vedi
                    run.conversion nel generatore): found ≥ valutate ≥ forti ≥
                    eccellenti, soglia sul miglior punteggio per posizione. Così
                    "Forti≥70" non supera mai "Valutate" nemmeno quando molte
                    posizioni avanzano a 'ready'. Fallback per gli snapshot vecchi
                    senza il campo (funnel per lo stato + match per gli eventi). */}
                <ConversionFunnelCard
                  found={run.conversion?.found ?? run.funnelTotals.found}
                  scored={run.conversion?.scored ?? run.funnelTotals.scored}
                  strong70={run.conversion?.strong70 ?? run.match.strong70}
                  strong80={run.conversion?.strong80 ?? run.match.strong80}
                />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── Costo per risultato (solo run ~mensili, con canone noto) ──── */}
      {/* ── Match ad alto score, giorno per giorno ──────────────── */}
      {run.scoreDaily && run.scoreDaily.length > 0 && (
        <section className="pt-10 border-t border-[var(--color-border)]">
          <DailyHighScore daily={run.scoreDaily} />
        </section>
      )}

      {current.subscription.monthlyEur != null && run.conversion && (
        <section className="pt-10 border-t border-[var(--color-border)]">
          <CostPerOutcome
            monthlyEur={current.subscription.monthlyEur}
            found={run.conversion.found}
            scored={run.conversion.scored}
            strong70={run.conversion.strong70}
            strong80={run.conversion.strong80}
            days={activeDays}
            multiplier={costMultiplier}
            estimated={costEstimated}
          />
        </section>
      )}

      {/* ── Nota del manutentore (voce umana in prima persona, per-tester) ── */}
      {current.maintainerNote && current.maintainerNote.length > 0 && (
        <section className="pt-10 border-t border-[var(--color-border)]">
          <div className="section-label mb-4">✍️ {t.maintainerNoteLabel}</div>
          <div
            className="rounded-2xl border border-[var(--color-border)] p-6 sm:p-7"
            style={{
              borderLeft: "3px solid #00e676",
              background: "color-mix(in srgb, #00e676 5%, var(--color-card))",
            }}
          >
            <div className="flex flex-col gap-3">
              {current.maintainerNote.map((para, i) => (
                <p
                  key={i}
                  className="text-[13px] leading-relaxed text-[var(--color-muted)]"
                >
                  {renderBold(para)}
                </p>
              ))}
            </div>
            <div
              className="mt-5 text-[12px] font-semibold"
              style={{ color: "#00e676" }}
            >
              {t.maintainerNoteSign}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
