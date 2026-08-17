// Tipi dello snapshot pubblico del case study (web/data/case-studies/*.json).
// Dati aggregati e anonimi di un run reale del team: nessun dato personale del
// candidato, solo numeri di mercato (score di match, città, categorie) + il log
// di attività per-istanza.

export interface CaseStudyBucket {
  label: string;
  n: number;
}

export interface CaseStudyMatch {
  scored: number;
  avg: number;
  min: number;
  max: number;
  strong70: number;
  strong80: number;
  buckets: CaseStudyBucket[];
  composition: { key: string; label: string; avg: number }[];
  scores: number[]; // tutti i punteggi grezzi (per l'istogramma)
}

export interface CaseStudyCity {
  city: string;
  country: string;
  lat: number;
  lon: number;
  count: number;
}

export interface CaseStudyUsageDay {
  day: string; // YYYY-MM-DD
  pct: number; // % del budget settimanale AI consumato quel giorno
  cum: number; // % cumulata del budget settimanale a fine giornata
  week: string; // giovedì di riferimento (settimana di budget)
}

export interface CaseStudyWorkingHours {
  timezone: string | null;
  windows: { days: string[]; start: string | null; end: string | null }[];
}

export interface CaseStudyUsage {
  provider: string;
  unit: string; // es. "weekly_budget_pct"
  daily: CaseStudyUsageDay[];
  workingHours?: CaseStudyWorkingHours | null;
}

export interface CaseStudyRun {
  source: string;
  tsRange: [string, string];
  totals: { positions: number; scored: number; excluded: number };
  match: CaseStudyMatch;
  // count = posizioni nella famiglia; scored = quante hanno uno score; avg =
  // media total_score sulle scorate (null/assente se nessuna). scored/avg sono
  // opzionali: snapshot precedenti all'aggiunta non li hanno.
  categories: {
    name: string;
    count: number;
    scored?: number;
    avg?: number | null;
  }[];
  // Fonti da cui sono arrivate le posizioni (top-N + "Altre"). Opzionale:
  // assente negli snapshot generati prima dell'aggiunta del campo.
  sources?: { name: string; count: number }[];
  // Fonti NEL TEMPO: posizioni trovate per giorno divise per fonte (top-8 +
  // "Altre"). `sourcesDailyKeys` = ordine fonti per stack/legenda. Opzionali:
  // assenti negli snapshot precedenti all'aggiunta.
  sourcesDaily?: { day: string; counts: Record<string, number> }[];
  sourcesDailyKeys?: string[];
  // Score medio per giorno PER fonte (linee sull'asse dx del grafico fonti):
  // chiavi = stesse di sourcesDailyKeys, solo posizioni scorate. Opzionale.
  sourcesScoreDaily?: { day: string; score: Record<string, number> }[];
  // Score medio COMPLESSIVO per fonte (grafico a barre, non per periodo).
  // name = chiave fonte (top-8 + "Altre"), avg = score medio, n = scorate. Opzionale.
  sourcesScore?: { name: string; avg: number; n: number }[];
  countries: { name: string; code: string; count: number }[];
  cities: CaseStudyCity[];
  salary: { n: number; avgMin: number | null; avgMax: number | null };
  agents: string[];
  events: { ts: string; agent: string; action: string }[];
  // Attività + budget per ORA (per viste intraday su fasi corte): solo le ore con
  // attività. hour = "YYYY-MM-DDTHH", counts per ruolo, cum = budget% a quell'ora.
  // Opzionale: assente negli snapshot precedenti.
  hourly?: { hour: string; counts: Record<string, number>; cum: number }[];
  // Funnel trovate → escluse/tenute. `funnelDaily` per giorno (found_at + status
  // attuale), `funnelTotals` complessivo (per il donut). Opzionali.
  funnelDaily?: {
    day: string;
    found: number;
    excluded: number;
    kept: number;
    scored: number;
    ready: number;
  }[];
  funnelTotals?: {
    found: number;
    excluded: number;
    kept: number;
    scored: number;
    ready: number;
  };
  // Imbuto di conversione a POSIZIONI DISTINTE (monotòno): found ≥ scored ≥
  // strong70 ≥ strong80, con la soglia sul MIGLIOR punteggio per posizione.
  // Da preferire, per la card di conversione, a funnelTotals.scored (che conta
  // lo stato 'scored' → sottostima quando le posizioni avanzano a 'ready') e a
  // match.strong70/80 (che contano gli EVENTI di score → sovrastima coi
  // ri-score). Opzionale: assente negli snapshot precedenti all'aggiunta.
  conversion?: {
    found: number;
    scored: number;
    strong70: number;
    strong80: number;
  };
  // Per-giorno (found_at): match forti/eccellenti prodotti quel giorno (best-score
  // per posizione ≥70 / ≥80). Per il grafico temporale "score alto al giorno".
  // Opzionale: assente negli snapshot precedenti all'aggiunta.
  scoreDaily?: {
    day: string;
    scored: number;
    strong70: number;
    strong80: number;
  }[];
  usage?: CaseStudyUsage | null;
}
