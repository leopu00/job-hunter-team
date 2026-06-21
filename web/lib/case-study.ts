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
}

export interface CaseStudyCity {
  city: string
  country: string
  lat: number
  lon: number
  count: number
}

export interface CaseStudyRun {
  source: string
  tsRange: [string, string]
  totals: { positions: number; scored: number; excluded: number }
  match: CaseStudyMatch
  categories: { name: string; count: number }[]
  countries: { name: string; code: string; count: number }[]
  cities: CaseStudyCity[]
  salary: { n: number; avgMin: number | null; avgMax: number | null }
  agents: string[]
  events: { ts: string; agent: string; action: string }[]
}
