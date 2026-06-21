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
    subscription: { provider: "OpenAI Codex", plan: "Pro", price: "~€100/mese" },
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
        { label: "Mobilità", value: "Cittadino UE · Svizzera ok · UK con sponsorship" },
      ],
      targetCities: [
        "Milano", "Vienna", "Zurigo", "Ginevra",
        "Barcellona", "Madrid", "Lisbona", "Monaco",
      ],
      why: "Ecco perché i numeri vengono così: cercando ruoli finance e investment in grandi città europee, il team ha concentrato la ricerca negli hub finanziari (Londra, Zurigo, Ginevra, Lussemburgo, Dublino) e quasi tutte le posizioni ricadono in categorie business & finance — esattamente il profilo del candidato.",
    },
    run: betaCRun as CaseStudyRun,
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
