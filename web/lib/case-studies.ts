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
import betaBKimiRun from "@/data/case-studies/betaB-kimi-run.json";
import betaDRun from "@/data/case-studies/betaD-kimi-run.json";
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

// Profilo del beta tester 1 (technical writer). La sessione free-run Codex è
// stata rimossa (~3 giorni senza monitor, sporcava le medie): resta la sessione
// Kimi monitorata.
const TW_PROFILE: CaseStudyProfile = {
  badge: "B1",
  headline: "Technical writer & traduttore tecnico — ponte industria e lingue",
  summary:
    "Candidato che punta a ruoli di technical writing, traduzione tecnica e localizzazione/LQA-UAT (ungherese/italiano/inglese). Porta un'esperienza cross-domain che unisce mestieri industriali e manifatturieri — manifattura, CAD/CAM/CNC, allestimenti fieristici — con traduzione e interpretariato multilingue: il suo punto di forza è proprio il ponte tra competenza hands-on di settore e competenza linguistica. Preferisce il full remote; ricerca multi-paese in Europa.",
  facts: [
    {
      label: "Ruoli target",
      value: "Technical writer · traduttore tecnico · localizzazione/LQA",
    },
    { label: "Esperienza", value: "Cross-domain · industria + lingue" },
    {
      label: "Background",
      value:
        "Manifattura · CAD/CAM/CNC · allestimenti · traduzione/interpretariato",
    },
    {
      label: "Lingue",
      value:
        "Ungherese e Italiano (madrelingua) · Inglese (C1-C2) · Tedesco (base)",
    },
    {
      label: "Mobilità",
      value:
        "Cittadino UE · full remote preferito · ricerca multi-paese in Europa",
    },
  ],
  locationNote:
    "Priorità al full remote; ricerca multi-paese in Europa, con apertura agli hub tech europei. Tra le città ricorrenti nella ricerca:",
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
  why: "Ecco perché i numeri vengono così: il candidato punta a technical writing, traduzione tecnica e localizzazione, ma con un forte background industriale — perciò il team ha cercato soprattutto documentazione tecnica industriale e software, e le famiglie di ruolo dominanti sono technical writing hardware/manifatturiero, software/API docs e localizzazione (con qualche affaccio su CAD/CAM/CNC, riflesso del suo passato di settore). Quasi tutto arriva da LinkedIn e da job board specializzate; la distribuzione geografica rispecchia le lingue native e le priorità del candidato.",
};

// Tre beta tester. Apre il run Codex (beta-2): il più lungo (~1 mese
// continuativo), l'unico MEASURED nel calcolo dei costi. La sessione free-run
// Codex del technical writer è stata TOLTA: ~3 giorni senza monitor del
// budget, sporcava tutte le medie. Resta la sua sessione Kimi (monitorata).
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
  // ── Beta tester 1 · technical writer (Kimi, run monitorato) ─────────────
  {
    id: "beta-1-kimi",
    label: "Beta tester 1",
    tagline: "Technical writing · traduzione · localizzazione",
    category: "Technical Writing",
    seniority: "Senior · cross-domain",
    geos: ["Europa"],
    model: "Kimi",
    subscription: {
      provider: "Moonshot Kimi",
      plan: "Kimi Code",
      price: "~€40/mese",
      monthlyEur: 40,
    },
    profile: TW_PROFILE,
    maintainerNote: [
      "Questo profilo è stato **la sfida più impegnativa della serie**. Le competenze sono molto eterogenee — technical writing, traduzione tecnica e localizzazione, innestate su un solido background industriale — e il target geografico è volutamente ampio: ne deriva **un mercato frammentato**, con annunci difficili da ricondurre a categorie stabili e da valutare con un metro uniforme. È inoltre il profilo su cui ho messo alla prova **Kimi K2**, il modello più difficile da mantenere in esecuzione autonoma per periodi prolungati.",
      "Nelle prime settimane Kimi **esauriva l'intero budget settimanale in un paio di giorni**. Per evitare che il team restasse fermo in attesa del reset ho distribuito il carico su più abbonamenti e, soprattutto, ho affinato progressivamente il pacing e il monitoraggio della spesa. Oggi **il budget viene dosato con rigore** e il tetto giornaliero non viene più superato; nel frattempo, però, il bacino di annunci realmente pertinenti per questo profilo ha iniziato a ridursi.",
      "Per considerarlo un successo pieno manca un ultimo traguardo: che, **con un solo abbonamento, il team lavori in autonomia giorno dopo giorno per almeno un mese consecutivo**, senza interruzioni. Raggiunto quel punto, diventerà il caso di riferimento della serie.",
    ],
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
          value:
            "Luxury hospitality · guest experience · VIP relations · cabin crew",
        },
        { label: "Esperienza", value: "Inizio-media carriera" },
        {
          label: "Settore",
          value: "Hôtellerie 5★ · ristorazione di lusso · eventi",
        },
        { label: "Formazione", value: "Ambito turistico-alberghiero" },
        {
          label: "Lingue",
          value:
            "Profilo multilingue (quattro lingue, incl. italiano e inglese)",
        },
        {
          label: "Mobilità",
          value:
            "Lavora in Italia · per alcune mete estere serve verifica di visto/sponsorship",
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
    maintainerNote: [
      "È il caso più recente della serie: il team ha iniziato a lavorarci da poco più di una settimana. Il profilo si muove in **un mercato di nicchia** — hôtellerie di lusso, guest experience e cabin crew per i vettori premium del Golfo — concentrato in poche piazze: le grandi mete del turismo italiano e gli hub internazionali dell'accoglienza di fascia alta.",
      "Anche qui il team gira su **Kimi**, con l'abbonamento più economico. **È ancora presto per trarre conclusioni**: una settimana racconta l'avvio, non l'andamento di un mese. I primi segnali, però, sono incoraggianti — in pochi giorni il team ha già prodotto un nucleo di match forti ed eccellenti su un profilo tutt'altro che generalista.",
      "La domanda aperta è la stessa del technical writing: se un mercato così specifico avrà **profondità sufficiente** per alimentare il team a lungo, e se Kimi reggerà l'esecuzione autonoma **per un mese intero** senza sforare il budget. Su questo profilo abbiamo ancora poche settimane di osservazione.",
      "Per ora lo considero un caso da seguire: promettente nell'avvio, ma tutto da confermare sul lungo periodo. È il banco di prova più fresco della serie.",
    ],
    // Run mono-fase: solo Kimi (budget settimanale monitorato), ~1 settimana.
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
