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
import betaDRun from "@/data/case-studies/betaD-kimi-run.json";

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
  subscription: { provider: string; plan: string; price: string };
  profile: CaseStudyProfile;
  /** fasi del run con modello diverso (opzionale); se assente = run mono-fase */
  phases?: CaseStudyPhase[];
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
  {
    id: "beta-2",
    label: "Beta tester 2",
    tagline: "Technical writing · traduzione · localizzazione",
    category: "Technical Writing",
    seniority: "Senior · cross-domain",
    geos: ["Ungheria", "Italia", "Europa"],
    model: "Kimi",
    subscription: {
      provider: "Moonshot Kimi",
      plan: "Kimi Code",
      price: "~€40/mese",
    },
    profile: {
      badge: "B2",
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
    },
    // Due sessioni distinte sullo STESSO candidato: prima un test con Codex (agenti
    // liberi, senza monitor del budget), poi il run attuale con Kimi (monitorato).
    // Il buco 05-12/06 tra le due è downtime e non appartiene a nessuna fase.
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
      {
        key: "kimi",
        label: "Kimi",
        price: "~€40/mese",
        note: "run attuale — budget settimanale monitorato e dosato (pacing)",
        from: "2026-06-13",
        to: null,
      },
    ],
    run: betaBRun as unknown as CaseStudyRun,
  },
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
