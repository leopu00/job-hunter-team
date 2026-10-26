// Registro dei case study pubblici. Ogni voce = un beta tester con:
//  - un PROFILO anonimo curato a mano (niente nome/datore/scuole/contatti),
//    pensato per dare il "perché" dei risultati senza esporre dati personali;
//  - i DATI aggregati del run (snapshot JSON generato dalla VPS).
// Aggiungere un caso = una nuova voce qui (più il suo snapshot in data/).

import type { CaseStudyRun } from "@/lib/case-study";
import {
  buildTeamActivity,
  TEAM_ACTIVITY_ROLES,
  type TeamActivity,
  type TeamActivityEvent,
  type TeamActivityRole,
} from "@/lib/team-activity";
import betaCRun from "@/data/case-studies/betaC-codex-run.json";
import PROFILES_I18N from "@/data/case-studies/profiles-i18n.json";
import type { Locale } from "@/i18n/config";
import { intlTag } from "@/lib/locale-tag";

// Link contribute (doc reali sul repo GitHub).
export const GITHUB_REPO = "https://github.com/leopu00/job-hunter-team";
export const CONTRIBUTE_LINKS = {
  repo: GITHUB_REPO,
  results: `${GITHUB_REPO}/blob/master/docs/about/RESULTS.md`,
  contributing: `${GITHUB_REPO}/blob/master/.github/CONTRIBUTING.md`,
  beta: `${GITHUB_REPO}/blob/master/docs/guides/BETA.md`,
  install: `${GITHUB_REPO}#installation`,
};

export interface CaseStudyProfile {
  /** monogramma mostrato nell'avatar (es. "B1") */
  badge: string;
  headline: string;
  summary: string;
  facts: { label: string; value: string }[];
  /** come ha espresso la preferenza di località (non solo città puntuali) */
  locationNote: string;
  targetCities: string[];
  /** perché i numeri vengono così — il ponte profilo → risultati */
  why: string;
}

// Una "fase" del run quando il candidato è stato testato in periodi distinti con
// modello/abbonamento/modalità diversi (es. betaB: prima Codex libero, poi Kimi
// monitorato). Se presente, la sezione budget mostra un grafico PER FASE invece
// di uno unico che mescolerebbe sessioni non confrontabili. `to: null` = fase in
// corso. Le date sono YYYY-MM-DD e filtrano usage.daily + attività.
export interface CaseStudyPhase {
  key: string;
  label: string; // "Codex" / "Kimi"
  price: string; // "~€100/mese"
  note: string; // descrizione breve della modalità (IT, come il profilo)
  from: string; // "2026-05-19"
  to: string | null; // "2026-06-04"; null = fase corrente
  /** "hourly" = grafico intraday (ora per ora) invece che giornaliero; per fasi corte */
  detail?: "hourly";
}

export interface CaseStudyMeta {
  id: string;
  label: string; // "Beta tester 1"
  tagline: string; // riga sotto il nome nel menu
  /** dimensioni "vetrina" usate dalla sidebar: ciò che distingue il tester */
  category: string; // settore/ruolo, es. "Finance"
  seniority: string; // livello di carriera, es. "Early career"
  geos: string[]; // aree geografiche, es. ["Europa"]
  model: string; // modello LLM usato dal team, es. "Codex"
  /** abbonamento AI usato per questo run (l'unica spesa reale) */
  subscription: {
    provider: string;
    plan: string;
    price: string;
    /** costo mensile in € (numerico) per il calcolo del costo per risultato */
    monthlyEur?: number;
  };
  profile: CaseStudyProfile;
  /** fasi del run con modello diverso (opzionale); se assente = run mono-fase */
  phases?: CaseStudyPhase[];
  /** sessione free-run senza monitor del budget (burst di pochi giorni che ha
   *  bruciato una settimana di budget): esclusa dalle statistiche di tasso
   *  giornaliero, dove pochi giorni non sono rappresentativi. */
  freeRun?: boolean;
  /** nota editoriale in prima persona di chi opera e affina il team su questo
   *  profilo (voce del manutentore): contesto, sfide e criterio di successo.
   *  Un paragrafo per elemento. Opzionale: la card in fondo appare solo se c'è. */
  maintainerNote?: string[];
  run: CaseStudyRun;
}

// Un case study: il run Codex del beta tester 2, il più lungo (~1 mese continuativo) e l'unico MEASURED nel
// calcolo dei costi. I case study su Kimi (archiviato dalla 0.4) non sono più mostrati; i loro dati restano
// in data/case-studies/ come archivio.
export const CASE_STUDIES: CaseStudyMeta[] = [
  // ── Beta tester 2 · finance, inizio carriera (Codex) ────────────────────
  {
    id: "beta-2",
    label: "Beta tester 2",
    tagline: "Finance · early-career · Europa",
    category: "Finance",
    seniority: "Early career",
    geos: ["Europa"],
    model: "Codex",
    subscription: {
      provider: "OpenAI Codex",
      plan: "Pro",
      price: "~€100/mese",
      monthlyEur: 100,
    },
    profile: {
      badge: "B2",
      headline: "Professionista finance, inizio carriera",
      summary:
        "Analista all'inizio della carriera in credit risk e due diligence in una banca d'investimento internazionale. Vuole spostarsi verso ruoli front-office — investment management, restructuring, transaction advisory — in grandi città europee.",
      facts: [
        { label: "Settore", value: "Finance · investment & credit risk" },
        { label: "Esperienza", value: "Early-career" },
        { label: "Formazione", value: "Laurea in Business & Economics" },
        { label: "Lingue", value: "Ungherese · Inglese (C1) · Tedesco (base)" },
        {
          label: "Mobilità",
          value: "Cittadino UE · Svizzera ok · UK con sponsorship",
        },
      ],
      locationNote:
        "Aperto a grandi città internazionali europee con molte opportunità — Europa occidentale preferita, paesi nordici per i ruoli più forti. Tra le città prioritarie:",
      targetCities: [
        "Milano",
        "Vienna",
        "Zurigo",
        "Ginevra",
        "Lione",
        "Nizza",
        "Barcellona",
        "Madrid",
        "Lisbona",
        "Monaco",
      ],
      why: "Ecco perché i numeri vengono così: cercando ruoli finance e investment in grandi città europee, il team ha concentrato la ricerca negli hub finanziari (Londra, Zurigo, Ginevra, Lussemburgo, Dublino) e quasi tutte le posizioni ricadono in categorie business & finance — esattamente il profilo del candidato.",
    },
    maintainerNote: [
      "Se il technical writing è stata la sfida, questo profilo è **il caso che più si avvicina a ciò che considero un successo**. Il candidato punta a ruoli finance e investment nelle grandi città europee: un mercato ampio, ben definito e concentrato negli hub finanziari — Londra, Zurigo, Ginevra, Lussemburgo, Dublino — dove le posizioni pertinenti non scarseggiano.",
      "È il profilo affidato a **Codex**, il modello che ho trovato più stabile nell'esecuzione autonoma prolungata. Un mercato favorevole unito a un modello solido ha permesso al team di lavorare **giorno dopo giorno per circa un mese** — esattamente il traguardo che uso come metro di successo.",
      "I risultati sono i migliori della serie: **la quota più alta di match forti ed eccellenti**. E c'è un dato che merita attenzione: pur essendo l'abbonamento più costoso (~€100 al mese contro i ~€40 di Kimi), **il costo per singolo match eccellente è il più basso** — perché un mercato ricco di posizioni adatte rende molto di più per ogni euro speso.",
      "Per questo lo considero il caso di riferimento: quando il mercato è favorevole e il modello è stabile, il team consegna un mese intero di lavoro autonomo con il miglior rapporto qualità/costo dell'intera serie.",
    ],
    run: betaCRun as unknown as CaseStudyRun,
  },
];

export function getCaseStudy(id: string): CaseStudyMeta | undefined {
  return CASE_STUDIES.find((c) => c.id === id);
}

// ── i18n del contenuto editoriale ──────────────────────────────────────
// L'italiano è la sorgente inline qui sopra (CASE_STUDIES); il file JSON tiene
// le altre 6 lingue. `localizeCaseStudy()` sovrappone la lingua scelta sui
// campi editoriali del meta IT (profilo, tagline, categoria, geo, prezzi, note
// delle fasi). I campi non testuali (id, badge, modello, città, run) restano
// condivisi. Risolvere SEMPRE lato server (page.tsx, [id]/page.tsx) col locale
// della richiesta, prima di passare ai componenti.
interface CaseI18nContent {
  tagline: string;
  category: string;
  seniority: string;
  geos: string[];
  subscriptionPrice: string;
  headline: string;
  summary: string;
  facts: { label: string; value: string }[];
  locationNote: string;
  why: string;
  phaseNotes?: { price: string; note: string }[];
  /** nota del manutentore tradotta (opzionale finché non localizzata: fallback IT) */
  maintainerNote?: string[];
}

const CASE_I18N = PROFILES_I18N as Partial<
  Record<Locale, Record<string, CaseI18nContent>>
>;

/** Case study coi campi editoriali nella lingua richiesta (fallback: italiano,
 *  che è la sorgente inline → 'it' e lingue mancanti tornano il meta IT). */
export function localizeCaseStudy(
  meta: CaseStudyMeta,
  locale: Locale,
): CaseStudyMeta {
  const tr = CASE_I18N[locale]?.[meta.id];
  if (!tr) return meta;
  return {
    ...meta,
    tagline: tr.tagline,
    category: tr.category,
    seniority: tr.seniority,
    geos: tr.geos,
    // finché la nota non è tradotta nella lingua scelta, resta l'italiano (sorgente)
    maintainerNote: tr.maintainerNote ?? meta.maintainerNote,
    subscription: { ...meta.subscription, price: tr.subscriptionPrice },
    phases: meta.phases?.map((p, i) => ({
      ...p,
      price: tr.phaseNotes?.[i]?.price ?? p.price,
      note: tr.phaseNotes?.[i]?.note ?? p.note,
    })),
    profile: {
      ...meta.profile,
      headline: tr.headline,
      summary: tr.summary,
      facts: tr.facts,
      locationNote: tr.locationNote,
      why: tr.why,
    },
  };
}

// Da event-log dello snapshot all'attività aggregata (per i grafici attività).
const ROLE_SET = new Set<string>(TEAM_ACTIVITY_ROLES);
export function buildCaseActivity(run: CaseStudyRun): TeamActivity {
  const events: TeamActivityEvent[] = run.events.flatMap((e) => {
    const role = e.agent.split("-")[0] as TeamActivityRole;
    if (!ROLE_SET.has(role)) return [];
    return [{ role, actor: e.agent.toLowerCase(), ts: e.ts, pid: null }];
  });
  return buildTeamActivity(
    events,
    run.tsRange[0].slice(0, 10),
    run.tsRange[1].slice(0, 10),
  );
}

// ── periodo di lavoro (finestra del run + giorni attivi) ────────────────────
// `days` = giorni con attività del team (stessa definizione della pagina di
// dettaglio). Formattazione locale-aware, risolta server-side col locale della
// richiesta (come gli altri campi editoriali della scheda). `label` è pronto da
// mostrare: es. "19 mag → 30 giu (34 giorni)".
const DAYS_WORD: Record<Locale, (n: number) => string> = {
  it: (n) => `${n} giorn${n === 1 ? "o" : "i"}`,
  en: (n) => `${n} day${n === 1 ? "" : "s"}`,
  es: (n) => `${n} día${n === 1 ? "" : "s"}`,
  fr: (n) => `${n} jour${n === 1 ? "" : "s"}`,
  de: (n) => `${n} Tag${n === 1 ? "" : "e"}`,
  hu: (n) => `${n} nap`,
  pt: (n) => `${n} dia${n === 1 ? "" : "s"}`,
};
function fmtRunDay(locale: Locale, iso: string): string {
  return new Intl.DateTimeFormat(intlTag(locale), {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}
export function caseRunInfo(
  run: CaseStudyRun,
  locale: Locale,
): { range: string; days: number; daysWord: string; label: string } {
  const activity = buildCaseActivity(run);
  const days = activity.roleDaily.filter((d) =>
    Object.values(d.counts).some((n) => n > 0),
  ).length;
  const range = `${fmtRunDay(locale, run.tsRange[0].slice(0, 10))} → ${fmtRunDay(
    locale,
    run.tsRange[1].slice(0, 10),
  )}`;
  const daysWord = DAYS_WORD[locale](days);
  return { range, days, daysWord, label: `${range} (${daysWord})` };
}

// ── proiezione a un mese per il costo per risultato ─────────────────────────
// Sopra questa soglia di giorni attivi la run copre ~un ciclo mensile → il costo
// è MISURATO (multiplier 1). Sotto → STIMATO proiettando l'output a un mese in
// base al BUDGET consumato (Σ % dei consumi giornalieri = settimane-budget; un
// mese ≈ 4,345 settimane). NON "giorni × 30": le run brevi bruciano in fretta il
// budget settimanale e lo sovrastimerebbe (fallback a giorni×30 solo se manca il
// dato di budget). Usato sia dal dettaglio sia dalla media in home.
export const COST_MIN_DAYS = 20;
export function caseMonthlyProjection(
  run: CaseStudyRun,
  days: number,
): { estimated: boolean; multiplier: number } {
  if (days >= COST_MIN_DAYS) return { estimated: false, multiplier: 1 };
  const budgetWeeks =
    (run.usage?.daily ?? []).reduce((s, d) => s + (d.pct ?? 0), 0) / 100;
  const WEEKS_PER_MONTH = 4.345;
  let m =
    budgetWeeks >= 0.4
      ? WEEKS_PER_MONTH / budgetWeeks
      : days > 0
        ? 30 / days
        : 1;
  m = Math.max(1, Math.min(m, 12));
  return { estimated: true, multiplier: m };
}
