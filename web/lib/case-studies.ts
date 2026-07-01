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
import betaBCodexRun from "@/data/case-studies/betaB-codex-run.json";
import betaBKimiRun from "@/data/case-studies/betaB-kimi-run.json";
import betaDRun from "@/data/case-studies/betaD-kimi-run.json";
import PROFILES_I18N from "@/data/case-studies/profiles-i18n.json";
import type { Locale } from "@/i18n/config";

// Link contribute (doc reali sul repo GitHub).
export const GITHUB_REPO = "https://github.com/leopu00/job-hunter-team";
export const CONTRIBUTE_LINKS = {
  repo: GITHUB_REPO,
  results: `${GITHUB_REPO}/blob/master/docs/about/RESULTS.md`,
  contributing: `${GITHUB_REPO}/blob/master/.github/CONTRIBUTING.md`,
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
  run: CaseStudyRun;
}

// Profilo condiviso dalle DUE pagine del beta tester 1 (technical writer): stesso
// candidato, testato in due sessioni distinte — prima Codex (free-run), poi Kimi
// (monitorato) — tenute su pagine SEPARATE, così match/categorie/fonti/funnel non
// mescolano modelli e periodi diversi.
const TW_PROFILE: CaseStudyProfile = {
  badge: "B1",
  headline: "Technical writer & traduttore tecnico — ponte industria e lingue",
  summary:
    "Candidato che punta a ruoli di technical writing, traduzione tecnica e localizzazione/LQA-UAT (ungherese/italiano/inglese). Porta un'esperienza cross-domain che unisce mestieri industriali e manifatturieri — manifattura, CAD/CAM/CNC, allestimenti fieristici — con traduzione e interpretariato multilingue: il suo punto di forza è proprio il ponte tra competenza hands-on di settore e competenza linguistica. Preferisce il full remote; priorità Ungheria, poi Italia, poi resto d'Europa.",
  facts: [
    { label: "Ruoli target", value: "Technical writer · traduttore tecnico · localizzazione/LQA" },
    { label: "Esperienza", value: "Cross-domain · industria + lingue" },
    { label: "Background", value: "Manifattura · CAD/CAM/CNC · allestimenti · traduzione/interpretariato" },
    { label: "Lingue", value: "Ungherese e Italiano (madrelingua) · Inglese (C1-C2) · Tedesco (base)" },
    { label: "Mobilità", value: "Cittadino UE · full remote preferito · Ungheria → Italia → Europa" },
  ],
  locationNote:
    "Priorità al full remote; geograficamente prima l'Ungheria, poi l'Italia, poi il resto d'Europa, con apertura agli hub tech europei. Tra le città ricorrenti nella ricerca:",
  targetCities: [
    "Budapest",
    "Milano",
    "Dublino",
    "Amsterdam",
    "Madrid",
    "Barcellona",
    "Varsavia",
    "Lisbona",
  ],
  why: "Ecco perché i numeri vengono così: il candidato punta a technical writing, traduzione tecnica e localizzazione, ma con un forte background industriale — perciò il team ha cercato soprattutto documentazione tecnica industriale e software, e le famiglie di ruolo dominanti sono technical writing hardware/manifatturiero, software/API docs e localizzazione (con qualche affaccio su CAD/CAM/CNC, riflesso del suo passato di settore). Quasi tutto arriva da LinkedIn e da job board specializzate; Ungheria e Italia in cima rispecchiano la priorità geografica e le lingue native.",
};

// Schede in ordine CRONOLOGICO di run. Il beta tester 1 (technical writer) è
// stato testato in DUE sessioni su pagine separate — prima Codex (mag '26), poi
// Kimi (giu '26); il run finance è avvenuto IN MEZZO, quindi si inserisce tra le
// due. (Le etichette "Beta tester N" restano per tester, non per posizione.)
export const CASE_STUDIES: CaseStudyMeta[] = [
  // ── Beta tester 1 · technical writer · sessione Codex (free-run) ─────────
  {
    id: "beta-1-codex",
    label: "Beta tester 1",
    tagline: "Sessione Codex · Technical writing · traduzione · localizzazione",
    category: "Technical Writing",
    seniority: "Senior · cross-domain",
    geos: ["Ungheria", "Italia", "Europa"],
    model: "Codex",
    subscription: {
      provider: "OpenAI Codex",
      plan: "Pro",
      price: "~€100/mese",
      monthlyEur: 100,
    },
    profile: TW_PROFILE,
    // Fase unica = l'UNICA sessione di questa pagina (Codex free-run, ~3 giorni):
    // dettaglio ora-per-ora, per mostrare il burst intraday senza monitor.
    phases: [
      {
        key: "codex",
        label: "Codex",
        price: "~€100/mese",
        note: "primo test — agenti liberi, senza monitor, fino a esaurire il budget",
        from: "2026-05-19",
        to: "2026-05-21",
        detail: "hourly",
      },
    ],
    run: betaBCodexRun as unknown as CaseStudyRun,
  },
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
    run: betaCRun as unknown as CaseStudyRun,
  },
  // ── Beta tester 1 · technical writer · sessione Kimi (run monitorato) ────
  {
    id: "beta-1-kimi",
    label: "Beta tester 1",
    tagline: "Sessione Kimi · Technical writing · traduzione · localizzazione",
    category: "Technical Writing",
    seniority: "Senior · cross-domain",
    geos: ["Ungheria", "Italia", "Europa"],
    model: "Kimi",
    subscription: {
      provider: "Moonshot Kimi",
      plan: "Kimi Code",
      price: "~€40/mese",
      monthlyEur: 40,
    },
    profile: TW_PROFILE,
    // Run monitorato (Kimi), settimane intere: vista budget giornaliera.
    phases: [
      {
        key: "kimi",
        label: "Kimi",
        price: "~€40/mese",
        note: "run monitorato — budget settimanale dosato (pacing)",
        from: "2026-06-13",
        to: null,
      },
    ],
    run: betaBKimiRun as unknown as CaseStudyRun,
  },
  // ── Beta tester 3 · luxury hospitality (Kimi) ───────────────────────────
  {
    id: "beta-3",
    label: "Beta tester 3",
    tagline: "Luxury hospitality · guest experience · cabin crew",
    category: "Luxury Hospitality",
    seniority: "Inizio-media carriera",
    geos: ["Italia", "Europa", "Emirati"],
    model: "Kimi",
    subscription: {
      provider: "Moonshot Kimi",
      plan: "Kimi Code",
      price: "~€40/mese",
      monthlyEur: 40,
    },
    profile: {
      badge: "B3",
      headline: "Professionista luxury hospitality & guest experience",
      summary:
        "Profilo di inizio-media carriera nell'hospitality e nella ristorazione di lusso: accoglienza e guest relations per ospiti VIP in brand internazionali, con coordinamento eventi, gestione delle prenotazioni e problem solving in servizi ad alta affluenza. Punta a ruoli di guest experience, VIP relations e front office nel segmento luxury, con interesse per il cabin crew di compagnie aeree premium. Profilo multilingue.",
      facts: [
        {
          label: "Ruoli target",
          value: "Luxury hospitality · guest experience · VIP relations · cabin crew",
        },
        { label: "Esperienza", value: "Inizio-media carriera" },
        { label: "Settore", value: "Hôtellerie 5★ · ristorazione di lusso · eventi" },
        { label: "Formazione", value: "Ambito turistico-alberghiero" },
        {
          label: "Lingue",
          value: "Profilo multilingue (quattro lingue, incl. italiano e inglese)",
        },
        {
          label: "Mobilità",
          value: "Lavora in Italia · per alcune mete estere serve verifica di visto/sponsorship",
        },
      ],
      locationNote:
        "L'hospitality di lusso si concentra in poche piazze: le grandi mete del turismo italiano e gli hub internazionali dell'accoglienza premium. Tra i mercati target:",
      targetCities: [
        "Milano",
        "Roma",
        "Venezia",
        "Firenze",
        "Dubai",
        "Abu Dhabi",
        "Doha",
        "Madrid",
      ],
      why: "Ecco perché i numeri vengono così: il profilo punta a luxury hospitality e guest experience, con interesse per il cabin crew premium — perciò il team ha cercato soprattutto hôtellerie 5★, guest relations VIP ed eventi, con un ramo dedicato al cabin crew dei vettori del Golfo (Emirates, Wizz Air). Le famiglie di ruolo dominanti sono Luxury Hospitality Operations, hostess/eventi e cabin crew. Quasi tutto arriva da LinkedIn e da job board specializzate dell'hospitality (hosco, resortwork) e delle compagnie aeree; il mercato del lusso italiano fa da baricentro, mentre il requisito di lavorabilità spiega perché diverse posizioni fuori dall'Italia richiedono la verifica di visto/sponsorship.",
    },
    // Run mono-fase: solo Kimi (budget settimanale monitorato), ~3 giorni.
    run: betaDRun as unknown as CaseStudyRun,
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
const RUN_LOCALE_TAG: Record<Locale, string> = {
  it: "it-IT",
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  hu: "hu-HU",
  pt: "pt-PT",
};
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
  return new Intl.DateTimeFormat(RUN_LOCALE_TAG[locale], {
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
