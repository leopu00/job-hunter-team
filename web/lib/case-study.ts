// Tipi dello snapshot pubblico del case study (web/data/case-studies/*.json).
// Dati aggregati e anonimi di un run reale del team: nessun dato personale del
// candidato, solo numeri di mercato (score di match, città, categorie) + il log
// di attività per-istanza.

export interface CaseStudyBucket {
  label: string
  n: number
}

export interface CaseStudyMatch {
  scored: number
  avg: number
  min: number
  max: number
  strong70: number
  strong80: number
  buckets: CaseStudyBucket[]
  composition: { key: string; label: string; avg: number }[]
  scores: number[] // tutti i punteggi grezzi (per l'istogramma)
}

export interface CaseStudyCity {
  city: string
  country: string
  lat: number
  lon: number
  count: number
}

export interface CaseStudyUsageDay {
  day: string // YYYY-MM-DD
  pct: number // % del budget settimanale AI consumato quel giorno
  cum: number // % cumulata del budget settimanale a fine giornata
  week: string // giovedì di riferimento (settimana di budget)
}

export interface CaseStudyWorkingHours {
  timezone: string | null
  windows: { days: string[]; start: string | null; end: string | null }[]
}

export interface CaseStudyUsage {
  provider: string
  unit: string // es. "weekly_budget_pct"
  daily: CaseStudyUsageDay[]
  workingHours?: CaseStudyWorkingHours | null
}

export interface CaseStudyRun {
  source: string
  tsRange: [string, string]
  totals: { positions: number; scored: number; excluded: number }
  match: CaseStudyMatch
  categories: { name: string; count: number }[]
  // Fonti da cui sono arrivate le posizioni (top-N + "Altre"). Opzionale:
  // assente negli snapshot generati prima dell'aggiunta del campo.
  sources?: { name: string; count: number }[]
  // Fonti NEL TEMPO: posizioni trovate per giorno divise per fonte (top-8 +
  // "Altre"). `sourcesDailyKeys` = ordine fonti per stack/legenda. Opzionali:
  // assenti negli snapshot precedenti all'aggiunta.
  sourcesDaily?: { day: string; counts: Record<string, number> }[]
  sourcesDailyKeys?: string[]
  // Score medio per giorno PER fonte (linee sull'asse dx del grafico fonti):
  // chiavi = stesse di sourcesDailyKeys, solo posizioni scorate. Opzionale.
  sourcesScoreDaily?: { day: string; score: Record<string, number> }[]
  // Score medio COMPLESSIVO per fonte (grafico a barre, non per periodo).
  // name = chiave fonte (top-8 + "Altre"), avg = score medio, n = scorate. Opzionale.
  sourcesScore?: { name: string; avg: number; n: number }[]
  countries: { name: string; code: string; count: number }[]
  cities: CaseStudyCity[]
  salary: { n: number; avgMin: number | null; avgMax: number | null }
  agents: string[]
  events: { ts: string; agent: string; action: string }[]
  usage?: CaseStudyUsage | null
}
