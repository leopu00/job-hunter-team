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
import betaBRun from "@/data/case-studies/betaB-kimi-run.json";

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
  subscription: { provider: string; plan: string; price: string };
  profile: CaseStudyProfile;
  run: CaseStudyRun;
}

export const CASE_STUDIES: CaseStudyMeta[] = [
  {
    id: "beta-1",
    label: "Beta tester 1",
    tagline: "Finance · early-career · Europa",
    category: "Finance",
    seniority: "Early career",
    geos: ["Europa"],
    model: "Codex",
    subscription: {
      provider: "OpenAI Codex",
      plan: "Pro",
      price: "~€100/mese",
    },
    profile: {
      badge: "B1",
      headline: "Professionista finance, inizio carriera",
      summary:
        "Analista con circa 2 anni di esperienza in credit risk e due diligence in una banca d'investimento internazionale. Vuole spostarsi verso ruoli front-office — investment management, restructuring, transaction advisory — in grandi città europee.",
      facts: [
        { label: "Settore", value: "Finance · investment & credit risk" },
        { label: "Esperienza", value: "~2 anni · early-career" },
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
  {
    id: "beta-2",
    label: "Beta tester 2",
    tagline: "Technical writing · localizzazione · Europa",
    category: "Technical Writing",
    seniority: "Mid-level",
    geos: ["Italia", "Europa"],
    model: "Kimi",
    subscription: {
      provider: "Moonshot Kimi",
      plan: "Kimi Code",
      price: "~€40/mese",
    },
    profile: {
      badge: "B2",
      headline: "Technical writer, documentazione e localizzazione",
      summary:
        "Technical writer con esperienza nella documentazione di prodotto e software (API, developer docs, manualistica industriale) e nella localizzazione. Cerca ruoli di technical writing, documentation e content design in Europa, con base in Italia e legami con l'Ungheria — aperto al lavoro da remoto.",
      facts: [
        { label: "Settore", value: "Technical writing · documentation · localizzazione" },
        { label: "Esperienza", value: "Mid-level · documentazione di prodotto" },
        { label: "Specializzazione", value: "Software & API docs · localizzazione · content" },
        { label: "Lingue", value: "Italiano · Inglese · Ungherese" },
        { label: "Mobilità", value: "Cittadino UE · remote-friendly · base Italia/Ungheria" },
      ],
      locationNote:
        "Aperto a ruoli in Europa, con preferenza per hub tech e aziende remote-friendly — base in Italia e disponibilità verso l'area ungherese. Tra le città ricorrenti nella ricerca:",
      targetCities: [
        "Milano",
        "Budapest",
        "Dublino",
        "Amsterdam",
        "Madrid",
        "Barcellona",
        "Varsavia",
        "Lisbona",
      ],
      why: "Ecco perché i numeri vengono così: cercando ruoli di technical writing e localizzazione spesso remoti, il team ha pescato soprattutto da LinkedIn e dalle job board specializzate, e quasi tutte le posizioni ricadono in famiglie di documentazione, localizzazione e content — coerenti col profilo. La concentrazione su Italia e Ungheria riflette la base del candidato e le sue lingue.",
    },
    run: betaBRun as unknown as CaseStudyRun,
  },
];

export function getCaseStudy(id: string): CaseStudyMeta | undefined {
  return CASE_STUDIES.find((c) => c.id === id);
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
