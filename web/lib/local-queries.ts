import { getDb } from './db'
import { aggregateRoleFamilies, type RoleFamilyCount } from './position-classifier'
import type {
  DashboardStats,
  PositionWithScore,
  Position,
  Score,
  PositionHighlight,
  Company,
  ApplicationWithPosition,
  Application,
  PendingMessage,
} from './types'

// Helpers per convertire ID integer -> string (compatibilita' con tipi TS)
function sid(v: number | null | undefined): string { return v != null ? String(v) : '' }

// ── Dashboard Stats ────────────────────────────────────────────────
export function getDashboardStatsLocal(ws: string): DashboardStats {
  const db = getDb(ws)
  const rows = db.prepare('SELECT status, COUNT(*) as cnt FROM positions GROUP BY status').all() as { status: string; cnt: number }[]

  const counts: Record<string, number> = {}
  let total = 0
  for (const r of rows) {
    counts[r.status] = r.cnt
    total += r.cnt
  }

  // Pipeline write-requested-aware: "Da scrivere" = selezionate dall'utente
  // (write_requested) con CV non ancora pronto; "Con lo score" = scored non
  // selezionate. Guardato in try/catch: workspace vecchi seedati da Supabase
  // potrebbero non avere ancora la colonna write_requested → degrada a 0.
  let to_write = 0
  let scored_requested = 0
  try {
    to_write = (db.prepare(
      "SELECT COUNT(*) as cnt FROM positions WHERE write_requested = 1 AND status IN ('scored','writing','review')",
    ).get() as { cnt: number }).cnt
    scored_requested = (db.prepare(
      "SELECT COUNT(*) as cnt FROM positions WHERE write_requested = 1 AND status = 'scored'",
    ).get() as { cnt: number }).cnt
  } catch {
    /* colonna write_requested assente: box 'Da scrivere' a 0 */
  }

  return {
    total,
    new: counts['new'] ?? 0,
    checked: counts['checked'] ?? 0,
    scored: counts['scored'] ?? 0,
    writing: counts['writing'] ?? 0,
    review: counts['review'] ?? 0,
    ready: counts['ready'] ?? 0,
    applied: counts['applied'] ?? 0,
    excluded: counts['excluded'] ?? 0,
    response: counts['response'] ?? 0,
    scored_open: (counts['scored'] ?? 0) - scored_requested,
    to_write,
  }
}

// ── Recent positions with scores ───────────────────────────────────
export function getRecentPositionsLocal(ws: string, limit = 15): PositionWithScore[] {
  const db = getDb(ws)
  // last_action_at = ULTIMA azione qualsiasi su una posizione: insert
  // dello Scout (found_at), check dell'Analista (last_checked), score
  // dello Scorer (scored_at). Versione "lite" — non guarda
  // status_changed_at perche' il trigger SQLite non e' garantito su
  // workspace seedati da Supabase (tipico dev locale).
  const rows = db.prepare(`
    SELECT p.*, s.total_score as score,
           MAX(
             COALESCE(p.found_at, '1970-01-01'),
             COALESCE(p.last_checked, '1970-01-01'),
             COALESCE(s.scored_at, '1970-01-01')
           ) AS last_action_at
    FROM positions p
    LEFT JOIN scores s ON s.position_id = p.id
    WHERE p.status != 'excluded'
    ORDER BY last_action_at DESC
    LIMIT ?
  `).all(limit) as any[]

  return rows.map(r => ({ ...mapPosition(r), last_action_at: r.last_action_at }))
}

// Posizioni ordinate per ULTIMA azione qualsiasi: insert dello Scout
// (found_at), check dell'Analista (last_checked), score dello Scorer
// (scored_at), o cambio di stato di Scrittore/Critico/User
// (status_changed_at, popolato dal trigger SQLite installato sul DB).
// Restituisce anche `last_action_at` e `last_action_by` (l'agente che
// ha causato l'ultima modifica), così la UI può mostrare il feed in
// tempo reale e attribuire l'evento.
export function getRecentlyTouchedPositionsLocal(ws: string, limit = 15): (PositionWithScore & { last_action_at: string; last_action_by: string; last_action_actor: string; voto: number | null })[] {
  const db = getDb(ws)
  // last_action_by: ruolo (scout, analista, scorer, scrittore, critico, user)
  // last_action_actor: identificativo dell'istanza concreta dove
  // disponibile (scout-1 da found_by, scorer-1 da scored_by); per gli
  // altri ruoli ricade sul nome del role perché lo schema attuale non
  // registra l'attore di analista/writer/critic/user.
  // voto: critic_score dalla applications (review del critico, 0-10).
  const rows = db.prepare(`
    SELECT p.*, s.total_score as score, s.scored_at as scored_at, s.scored_by as scored_by,
           a.critic_score as voto,
           MAX(
             COALESCE(p.found_at, '1970-01-01'),
             COALESCE(p.last_checked, '1970-01-01'),
             COALESCE(s.scored_at, '1970-01-01'),
             COALESCE(p.status_changed_at, '1970-01-01')
           ) AS last_action_at,
           CASE
             WHEN COALESCE(p.status_changed_at, '1970-01-01') >= COALESCE(s.scored_at, '1970-01-01')
              AND COALESCE(p.status_changed_at, '1970-01-01') >= COALESCE(p.last_checked, '1970-01-01')
              AND COALESCE(p.status_changed_at, '1970-01-01') >= COALESCE(p.found_at, '1970-01-01')
              AND p.status_changed_at IS NOT NULL THEN
                CASE p.status
                  WHEN 'checked'  THEN 'analista'
                  WHEN 'excluded' THEN 'analista'
                  WHEN 'scored'   THEN 'scorer'
                  WHEN 'writing'  THEN 'scrittore'
                  WHEN 'review'   THEN 'scrittore'
                  WHEN 'ready'    THEN 'critico'
                  WHEN 'applied'  THEN 'user'
                  WHEN 'response' THEN 'user'
                  ELSE 'scout'
                END
             WHEN COALESCE(s.scored_at, '1970-01-01') >= COALESCE(p.last_checked, '1970-01-01')
              AND COALESCE(s.scored_at, '1970-01-01') >= COALESCE(p.found_at, '1970-01-01')
              AND s.scored_at IS NOT NULL THEN 'scorer'
             WHEN COALESCE(p.last_checked, '1970-01-01') >= COALESCE(p.found_at, '1970-01-01')
              AND p.last_checked IS NOT NULL THEN 'analista'
             ELSE 'scout'
           END AS last_action_by,
           CASE
             -- Quando il MAX viene da status_changed_at, usiamo last_actor
             -- (popolato da db_update.py con JHT_AGENT_NAME → es. 'scrittore-1',
             -- 'critico-s2'). Fallback al ruolo dedotto dallo status corrente
             -- se last_actor è ancora NULL (righe pre-migrazione).
             WHEN COALESCE(p.status_changed_at, '1970-01-01') >= COALESCE(s.scored_at, '1970-01-01')
              AND COALESCE(p.status_changed_at, '1970-01-01') >= COALESCE(p.last_checked, '1970-01-01')
              AND COALESCE(p.status_changed_at, '1970-01-01') >= COALESCE(p.found_at, '1970-01-01')
              AND p.status_changed_at IS NOT NULL THEN
                COALESCE(p.last_actor,
                  CASE p.status
                    WHEN 'checked'  THEN 'analista'
                    WHEN 'excluded' THEN 'analista'
                    WHEN 'scored'   THEN COALESCE(s.scored_by, 'scorer')
                    WHEN 'writing'  THEN 'scrittore'
                    WHEN 'review'   THEN 'scrittore'
                    WHEN 'ready'    THEN 'critico'
                    WHEN 'applied'  THEN 'user'
                    WHEN 'response' THEN 'user'
                    ELSE COALESCE(p.found_by, 'scout')
                  END)
             WHEN COALESCE(s.scored_at, '1970-01-01') >= COALESCE(p.last_checked, '1970-01-01')
              AND COALESCE(s.scored_at, '1970-01-01') >= COALESCE(p.found_at, '1970-01-01')
              AND s.scored_at IS NOT NULL THEN COALESCE(s.scored_by, 'scorer')
             WHEN COALESCE(p.last_checked, '1970-01-01') >= COALESCE(p.found_at, '1970-01-01')
              AND p.last_checked IS NOT NULL THEN COALESCE(p.last_actor, 'analista')
             ELSE COALESCE(p.found_by, 'scout')
           END AS last_action_actor
    FROM positions p
    LEFT JOIN scores s ON s.position_id = p.id
    LEFT JOIN applications a ON a.position_id = p.id
    WHERE p.status != 'excluded'
    ORDER BY last_action_at DESC
    LIMIT ?
  `).all(limit) as any[]

  return rows.map(r => ({
    ...mapPosition(r),
    last_action_at: r.last_action_at,
    last_action_by: r.last_action_by,
    last_action_actor: r.last_action_actor,
    voto: typeof r.voto === 'number' ? r.voto : null,
  }))
}

// ── All positions with optional filters ────────────────────────────
// Whitelist colonne sortabili → espressione SQL. NON inserire mai
// opts.sort raw nella query: SQLite non supporta prepared statement
// per ORDER BY, quindi la mappa qui sotto è l'unica difesa anti-injection.
const POSITION_SORT_COLUMNS: Record<string, string> = {
  id: 'p.id',
  title: 'p.title',
  company: 'p.company',
  role_family: 'p.role_family',
  source: 'p.source',
  location: 'p.location',
  score: 's.total_score',
  critic: 'a.critic_score',
  found_at: 'p.found_at',
  status: 'p.status',
}

type LocalPositionFilterOpts = {
  statuses?: string[]
  remoteTypes?: string[]
  sources?: string[]
  verdicts?: string[]
  limit?: number
  offset?: number
  sort?: string
  dir?: 'asc' | 'desc'
}

export function getPositionsLocal(ws: string, opts?: LocalPositionFilterOpts): PositionWithScore[] {
  const db = getDb(ws)
  const where: string[] = []
  const params: any[] = []

  if (opts?.statuses?.length) {
    where.push(`p.status IN (${opts.statuses.map(() => '?').join(',')})`)
    params.push(...opts.statuses)
  }
  if (opts?.remoteTypes?.length) {
    where.push(`p.remote_type IN (${opts.remoteTypes.map(() => '?').join(',')})`)
    params.push(...opts.remoteTypes)
  }
  if (opts?.sources?.length) {
    where.push(`p.source IN (${opts.sources.map(() => '?').join(',')})`)
    params.push(...opts.sources)
  }
  if (opts?.verdicts?.length) {
    where.push(`a.critic_verdict IN (${opts.verdicts.map(() => '?').join(',')})`)
    params.push(...opts.verdicts)
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const limitClause = opts?.limit ? `LIMIT ?` : ''
  const offsetClause = opts?.offset ? `OFFSET ?` : ''
  if (opts?.limit) params.push(opts.limit)
  if (opts?.offset) params.push(opts.offset)

  const sortCol = POSITION_SORT_COLUMNS[opts?.sort ?? ''] ?? 'p.found_at'
  const sortDir = opts?.dir === 'asc' ? 'ASC' : 'DESC'
  const nullsLast = sortCol.startsWith('s.') || sortCol.startsWith('a.')
    ? `${sortCol} IS NULL, `
    : ''

  const sql = `
    SELECT p.*, s.total_score as score,
      s.stack_match, s.remote_fit, s.salary_fit, s.strategic_fit,
      s.scored_at, s.scored_by,
      a.critic_score, a.critic_verdict,
      a.written_at, a.written_by, a.critic_reviewed_at, a.reviewed_by,
      a.applied_at, a.response_at
    FROM positions p
    LEFT JOIN scores s ON s.position_id = p.id
    LEFT JOIN applications a ON a.position_id = p.id
    ${whereClause}
    ORDER BY ${nullsLast}${sortCol} ${sortDir}
    ${limitClause} ${offsetClause}
  `
  const rows = db.prepare(sql).all(...params) as any[]
  const mapped = rows.map(r => {
    // Stipendio: stima del team se presente, altrimenti il dichiarato.
    const useEst = r.salary_estimated_min != null || r.salary_estimated_max != null
    const salary_min = (useEst ? r.salary_estimated_min : r.salary_declared_min) ?? null
    const salary_max = (useEst ? r.salary_estimated_max : r.salary_declared_max) ?? null
    const salary_currency = (useEst ? r.salary_estimated_currency : r.salary_declared_currency) ?? 'EUR'
    const la = pickLastActionLocal([
      { ts: r.found_at, by: 'scout', actor: r.found_by },
      { ts: r.last_checked, by: 'analista', actor: 'analista' },
      { ts: r.scored_at, by: 'scorer', actor: r.scored_by },
      { ts: r.written_at, by: 'scrittore', actor: r.written_by },
      { ts: r.critic_reviewed_at, by: 'critico', actor: r.reviewed_by },
      { ts: r.applied_at, by: 'user', actor: 'user' },
      { ts: r.response_at, by: 'user', actor: 'user' },
      { ts: r.status_changed_at, by: 'user', actor: r.last_actor },
    ])
    return {
      ...mapPosition(r),
      salary_min, salary_max, salary_currency,
      last_action_at: la.at, last_action_by: la.by, last_action_actor: la.actor,
    }
  })
  // Sort in JS su QUALSIASI colonna (incluse quelle derivate: salary, voto,
  // last_action_*). Uniforme col path cloud, così ogni intestazione ordina
  // davvero anche in locale. La ORDER BY SQL resta come ordine di base.
  if (opts?.sort) {
    const mul = opts.dir === 'asc' ? 1 : -1
    const val = (p: PositionWithScore): string | number | null => {
      switch (opts.sort) {
        case 'id': return p.legacy_id ?? null
        case 'score': return p.score ?? null
        case 'critic': return p.critic_score ?? null
        case 'salary': case 'monthly': return p.salary_min ?? null
        case 'remote': return p.remote_type ?? null
        case 'last_action_by': return p.last_action_actor ?? null
        case 'last_action_at': return p.last_action_at ?? null
        case 'found_at': return p.found_at ?? null
        case 'role_family': return p.role_family ?? null
        case 'loc_country': return p.loc_country ?? null
        case 'loc_city': return p.loc_city ?? null
        case 'title': return p.title ?? null
        case 'company': return p.company ?? null
        case 'source': return p.source ?? null
        case 'location': return p.location ?? null
        case 'status': return p.status ?? null
        default: return null
      }
    }
    mapped.sort((a, b) => {
      const va = val(a), vb = val(b)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mul
      return String(va).localeCompare(String(vb)) * mul
    })
  }
  return mapped
}

// ── Single position with all details ───────────────────────────────
export function getPositionByIdLocal(ws: string, id: string): {
  position: Position; score: Score | null; highlights: PositionHighlight[]
  company: Company | null; application: Application | null
} | null {
  const db = getDb(ws)
  const numId = Number(id)

  const pos = db.prepare('SELECT * FROM positions WHERE id = ?').get(numId) as any
  if (!pos) return null

  const score = db.prepare('SELECT * FROM scores WHERE position_id = ?').get(numId) as any
  const highlights = db.prepare('SELECT * FROM position_highlights WHERE position_id = ? ORDER BY type').all(numId) as any[]
  const app = db.prepare('SELECT * FROM applications WHERE position_id = ?').get(numId) as any

  let company: Company | null = null
  if (pos.company_id) {
    const c = db.prepare('SELECT * FROM companies WHERE id = ?').get(pos.company_id) as any
    if (c) company = mapCompany(c)
  }

  return {
    position: mapPositionFull(pos),
    score: score ? mapScore(score) : null,
    highlights: highlights.map(h => ({ id: sid(h.id), position_id: sid(h.position_id), type: h.type, text: h.text })),
    company,
    application: app ? mapApplication(app) : null,
  }
}

// ── Applications with position info ────────────────────────────────
export function getApplicationsLocal(ws: string): ApplicationWithPosition[] {
  const db = getDb(ws)
  const rows = db.prepare(`
    SELECT a.*, p.id as p_id, p.title as p_title, p.company as p_company, p.status as p_status, p.url as p_url
    FROM applications a
    LEFT JOIN positions p ON p.id = a.position_id
    ORDER BY a.written_at DESC
  `).all() as any[]

  return rows.map(r => mapAppWithPosition(r))
}

// ── Applications filtered by status ────────────────────────────────
export function getApplicationsByStatusLocal(ws: string, status: string): ApplicationWithPosition[] {
  const db = getDb(ws)
  const rows = db.prepare(`
    SELECT a.*, p.id as p_id, p.title as p_title, p.company as p_company, p.status as p_status, p.url as p_url
    FROM applications a
    LEFT JOIN positions p ON p.id = a.position_id
    WHERE a.status = ?
    ORDER BY a.response_at DESC
  `).all(status) as any[]

  return rows.map(r => mapAppWithPosition(r))
}

// ── Risposte ────────────────────────────────────────────────────────
export function getRisposteLocal(ws: string): ApplicationWithPosition[] {
  const db = getDb(ws)
  const rows = db.prepare(`
    SELECT a.*, p.id as p_id, p.title as p_title, p.company as p_company, p.status as p_status, p.url as p_url
    FROM applications a
    LEFT JOIN positions p ON p.id = a.position_id
    WHERE a.status = 'response' OR a.response IS NOT NULL
    ORDER BY a.response_at DESC
  `).all() as any[]

  return rows.map(r => mapAppWithPosition(r))
}

// ── Risposte count ──────────────────────────────────────────────────
export function getRisposteCountLocal(ws: string): number {
  const db = getDb(ws)
  const row = db.prepare(`
    SELECT COUNT(*) as cnt FROM applications
    WHERE status = 'response' OR response IS NOT NULL
  `).get() as { cnt: number }
  return row.cnt
}

// ── Score distribution ──────────────────────────────────────────────
export function getScoreDistributionLocal(ws: string) {
  const db = getDb(ws)
  const rows = db.prepare(`
    SELECT s.total_score
    FROM positions p
    LEFT JOIN scores s ON s.position_id = p.id
    WHERE p.status != 'excluded'
  `).all() as { total_score: number | null }[]

  const allScores = rows.map(r => r.total_score)
  const withScore = allScores.filter((s): s is number => s != null && s > 0)

  const buckets = [
    { label: '76\u2013100', min: 76, max: 100, color: 'var(--color-green)' },
    { label: '61\u201375',  min: 61, max: 75,  color: 'var(--color-yellow)' },
    { label: '41\u201360',  min: 41, max: 60,  color: 'var(--color-orange)' },
    { label: '\u2264 40',   min: 0,  max: 40,  color: 'var(--color-red)' },
  ].map(b => ({
    label: b.label,
    count: withScore.filter(s => s >= b.min && s <= b.max).length,
    color: b.color,
  }))

  const sum = withScore.reduce((a, s) => a + s, 0)
  const avgScore = withScore.length > 0 ? Math.round(sum / withScore.length) : null

  return { buckets, total: allScores.length, withScore: withScore.length, avgScore, scores: withScore }
}

// ── Positions con coordinate ufficio (per JobsGlobe) ───────────────
export interface PositionCoord {
  id: string
  title: string
  company: string
  status: string
  role_family: string | null
  score: number | null
  lat: number
  lon: number
  is_remote: boolean
  location: string | null
  loc_country: string | null
  loc_city: string | null
  office_address: string | null
}
export function getPositionsWithCoordsLocal(ws: string): PositionCoord[] {
  const db = getDb(ws)
  const rows = db.prepare(`
    SELECT p.id, p.title, p.company, p.status, p.role_family, p.location,
           p.loc_country, p.loc_city, p.office_address,
           s.total_score as score,
           p.office_lat as lat, p.office_lon as lon,
           p.is_remote
    FROM positions p
    LEFT JOIN scores s ON s.position_id = p.id
    WHERE p.status != 'excluded'
      AND p.office_lat IS NOT NULL AND p.office_lon IS NOT NULL
  `).all() as any[]
  return rows.map(r => ({
    id: sid(r.id),
    title: r.title,
    company: r.company,
    status: r.status,
    role_family: r.role_family ?? null,
    score: typeof r.score === 'number' ? r.score : null,
    lat: r.lat,
    lon: r.lon,
    is_remote: !!r.is_remote,
    location: r.location ?? null,
    loc_country: r.loc_country ?? null,
    loc_city: r.loc_city ?? null,
    office_address: r.office_address ?? null,
  }))
}

// ── Tree gerarchico location (country → cities → positions) ──────
// Allineato a queries.ts (Supabase). Usa loc_country/loc_city strutturati.
export type LocationPositionLite = {
  id: string
  title: string | null
  company: string | null
  score: number | null
}
export type LocationCity = {
  city: string | null
  count: number
  positions: LocationPositionLite[]
}
export type LocationCountry = {
  country: string
  count: number
  cities: LocationCity[]
}

export function getPositionLocationsLocal(ws: string): LocationCountry[] {
  const db = getDb(ws)
  const rows = db.prepare(`
    SELECT p.id, p.title, p.company, p.loc_country, p.loc_city,
           s.total_score AS score
    FROM positions p
    LEFT JOIN scores s ON s.position_id = p.id
    WHERE p.status != 'excluded'
  `).all() as Array<{
    id: any
    title: string | null
    company: string | null
    loc_country: string | null
    loc_city: string | null
    score: number | null
  }>
  const byCountry = new Map<string, Map<string | null, LocationPositionLite[]>>()
  for (const r of rows) {
    const country = r.loc_country?.trim() || '(unknown)'
    const city = r.loc_city?.trim() || null
    const cMap = byCountry.get(country) ?? new Map<string | null, LocationPositionLite[]>()
    const arr = cMap.get(city) ?? []
    arr.push({
      id: sid(r.id),
      title: r.title,
      company: r.company,
      score: typeof r.score === 'number' ? r.score : null,
    })
    cMap.set(city, arr)
    byCountry.set(country, cMap)
  }
  const out: LocationCountry[] = []
  for (const [country, cMap] of byCountry) {
    const cities: LocationCity[] = []
    let total = 0
    for (const [city, positions] of cMap) {
      positions.sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
      cities.push({ city, count: positions.length, positions })
      total += positions.length
    }
    cities.sort((a, b) => {
      if (a.city == null) return 1
      if (b.city == null) return -1
      return b.count - a.count
    })
    out.push({ country, count: total, cities })
  }
  out.sort((a, b) => {
    if (a.country === '(unknown)') return 1
    if (b.country === '(unknown)') return -1
    return b.count - a.count
  })
  return out
}

// ── Positions SENZA coordinate (per /map "remote bucket") ─────────
export function getPositionsWithoutCoordsLocal(ws: string) {
  const db = getDb(ws)
  const rows = db.prepare(`
    SELECT p.id, p.title, p.company, p.status, p.location,
           p.loc_country, p.loc_city,
           p.role_family,
           s.total_score as score,
           p.is_remote
    FROM positions p
    LEFT JOIN scores s ON s.position_id = p.id
    WHERE p.status != 'excluded'
      AND p.office_lat IS NULL
  `).all() as any[]
  return rows.map(r => ({
    id: sid(r.id),
    title: r.title as string | null,
    company: r.company as string | null,
    status: r.status as string,
    role_family: r.role_family as string | null,
    score: typeof r.score === 'number' ? r.score : null,
    is_remote: !!r.is_remote,
    location: (r.location as string | null) ?? null,
    loc_country: (r.loc_country as string | null) ?? null,
    loc_city: (r.loc_city as string | null) ?? null,
  }))
}

// ── Faceting dataset per la sidebar /positions ────────────────────
// Universo completo (incluse excluded) con i campi per donut/score/location.
export function getPositionFacetsLocal(ws: string) {
  const db = getDb(ws)
  const rows = db.prepare(`
    SELECT p.id, p.title, p.company, p.status, p.role_family,
           p.loc_country, p.loc_city,
           s.total_score as score,
           a.critic_score as critic_score
    FROM positions p
    LEFT JOIN scores s ON s.position_id = p.id
    LEFT JOIN applications a ON a.position_id = p.id
  `).all() as any[]
  return rows.map(r => ({
    id: sid(r.id),
    role_family: (r.role_family as string | null) ?? null,
    score: typeof r.score === 'number' ? r.score : null,
    critic_score: typeof r.critic_score === 'number' ? r.critic_score : null,
    loc_country: (r.loc_country as string | null) ?? null,
    loc_city: (r.loc_city as string | null) ?? null,
    status: r.status as string,
    title: (r.title as string | null) ?? null,
    company: (r.company as string | null) ?? null,
  }))
}

// ── Dataset dashboard: facet + campi tabella + recency (universo attivo) ──
// Sceglie l'evento col timestamp più recente (copia locale di pickLastAction
// in queries.ts: evita un import circolare local-queries <-> queries).
function pickLastActionLocal(
  cands: Array<{ ts: string | null | undefined; by: string; actor: string | null | undefined }>,
): { at: string; by: string; actor: string } {
  let best: { at: string; by: string; actor: string } | null = null
  for (const c of cands) {
    if (!c.ts) continue
    if (!best || c.ts > best.at) best = { at: c.ts, by: c.by, actor: c.actor || c.by }
  }
  return best ?? { at: '', by: 'scout', actor: 'scout' }
}

export function getDashboardPositionsLocal(ws: string) {
  const db = getDb(ws)
  const rows = db.prepare(`
    SELECT p.id, p.legacy_id, p.title, p.company, p.location, p.remote_type,
           p.status, p.role_family, p.loc_country, p.loc_city,
           p.salary_estimated_min, p.salary_estimated_max, p.salary_estimated_currency,
           p.salary_declared_min, p.salary_declared_max, p.salary_declared_currency,
           p.found_at, p.found_by,
           s.total_score as score, s.scored_at AS scored_at, s.scored_by AS scored_by,
           a.written_at AS written_at, a.written_by AS written_by,
           a.critic_reviewed_at AS critic_reviewed_at, a.reviewed_by AS reviewed_by,
           a.applied_at AS applied_at, a.response_at AS response_at,
           a.critic_score AS critic_score, a.critic_verdict AS critic_verdict,
           MAX(
             COALESCE(p.found_at, '1970-01-01'),
             COALESCE(p.last_checked, '1970-01-01'),
             COALESCE(s.scored_at, '1970-01-01'),
             COALESCE(a.written_at, '1970-01-01'),
             COALESCE(a.critic_reviewed_at, '1970-01-01'),
             COALESCE(a.applied_at, '1970-01-01'),
             COALESCE(a.response_at, '1970-01-01')
           ) AS last_action_at
    FROM positions p
    LEFT JOIN scores s ON s.position_id = p.id
    LEFT JOIN applications a ON a.position_id = p.id
    WHERE p.status != 'excluded'
    ORDER BY last_action_at DESC
  `).all() as any[]
  return rows.map(r => {
    const { at, by: last_action_by, actor: last_action_actor } = pickLastActionLocal([
      { ts: r.found_at, by: 'scout', actor: r.found_by },
      { ts: r.last_checked, by: 'analista', actor: 'analista' },
      { ts: r.scored_at, by: 'scorer', actor: r.scored_by },
      { ts: r.written_at, by: 'scrittore', actor: r.written_by },
      // critic_reviewed_at è scritto dallo SCRITTORE (chiamata --critic-score;
      // il critico non tocca mai il DB — single-writer rule, bug #21).
      { ts: r.critic_reviewed_at, by: 'scrittore', actor: r.written_by },
      { ts: r.applied_at, by: 'user', actor: 'user' },
      { ts: r.response_at, by: 'user', actor: 'user' },
    ])
    return {
    id: sid(r.id),
    legacy_id: (r.legacy_id as number | null) ?? null,
    title: (r.title as string | null) ?? null,
    company: (r.company as string | null) ?? null,
    location: (r.location as string | null) ?? null,
    remote_type: (r.remote_type as string | null) ?? null,
    status: r.status as string,
    score: typeof r.score === 'number' ? r.score : null,
    role_family: (r.role_family as string | null) ?? null,
    loc_country: (r.loc_country as string | null) ?? null,
    loc_city: (r.loc_city as string | null) ?? null,
    salary_min: ((r.salary_estimated_min ?? r.salary_estimated_max) != null ? r.salary_estimated_min : r.salary_declared_min) as number | null ?? null,
    salary_max: ((r.salary_estimated_min ?? r.salary_estimated_max) != null ? r.salary_estimated_max : r.salary_declared_max) as number | null ?? null,
    salary_currency: (((r.salary_estimated_min ?? r.salary_estimated_max) != null ? r.salary_estimated_currency : r.salary_declared_currency) as string | null) ?? 'EUR',
    found_at: (r.found_at as string | null) ?? null,
    last_action_at: ((r.last_action_at as string | null) ?? '') || at,
    last_action_by,
    last_action_actor,
    critic_score: typeof r.critic_score === 'number' ? r.critic_score : null,
    critic_verdict: (r.critic_verdict as string | null) ?? null,
    }
  })
}

// ── Position state-history (timestamp transizioni) ────────────────
export function getPositionStateHistoryLocal(ws: string) {
  const db = getDb(ws)
  const rows = db.prepare(`
    SELECT p.id AS id,
           p.status AS status,
           p.found_at AS found_at,
           p.last_checked AS last_checked,
           s.scored_at AS scored_at,
           a.written_at AS written_at,
           a.critic_reviewed_at AS critic_reviewed_at,
           a.critic_verdict AS critic_verdict,
           a.applied_at AS applied_at,
           a.response_at AS response_at
    FROM positions p
    LEFT JOIN scores s ON s.position_id = p.id
    LEFT JOIN applications a ON a.position_id = p.id
  `).all() as Array<{
    id: number | string
    status: string
    found_at: string | null
    last_checked: string | null
    scored_at: string | null
    written_at: string | null
    critic_reviewed_at: string | null
    critic_verdict: string | null
    applied_at: string | null
    response_at: string | null
  }>
  return rows.map(r => ({ ...r, id: String(r.id) }))
}

// ── Position type distribution ──────────────────────────────────────
// Legge la colonna positions.role_family (popolata dal team analyst).
// score → scores.total_score, critic → applications.critic_score (0-10).
// LEFT JOIN entrambi: aggregateRoleFamilies filtra null nel calcolo delle
// medie, includiamo anche posizioni senza voto.
export function getPositionTypeDistributionLocal(ws: string): RoleFamilyCount[] {
  const db = getDb(ws)
  const rows = db.prepare(`
    SELECT p.role_family AS role_family,
           s.total_score AS score,
           a.critic_score AS critic
    FROM positions p
    LEFT JOIN scores s ON s.position_id = p.id
    LEFT JOIN applications a ON a.position_id = p.id
    WHERE p.status != 'excluded'
  `).all() as { role_family: string | null; score: number | null; critic: number | null }[]
  return aggregateRoleFamilies(rows)
}

// ── Critic votes distribution (0-10) ───────────────────────────────
export function getCriticScoresLocal(ws: string): number[] {
  const db = getDb(ws)
  const rows = db.prepare(`
    SELECT a.critic_score
    FROM applications a
    JOIN positions p ON p.id = a.position_id
    WHERE p.status != 'excluded' AND a.critic_score IS NOT NULL
  `).all() as { critic_score: number }[]
  return rows.map(r => r.critic_score).filter((s): s is number => typeof s === 'number')
}

// ── Source distribution ─────────────────────────────────────────────
export function getSourceDistributionLocal(ws: string): Array<{ source: string; count: number }> {
  const db = getDb(ws)
  const rows = db.prepare(`
    SELECT COALESCE(source, 'sconosciuta') as source, COUNT(*) as cnt
    FROM positions WHERE status != 'excluded'
    GROUP BY source ORDER BY cnt DESC LIMIT 8
  `).all() as { source: string; cnt: number }[]

  return rows.map(r => ({ source: r.source, count: r.cnt }))
}

// ── Positions count by status ───────────────────────────────────────
export function getPositionsByStatusLocal(ws: string): Record<string, number> {
  const db = getDb(ws)
  const rows = db.prepare('SELECT status, COUNT(*) as cnt FROM positions GROUP BY status').all() as { status: string; cnt: number }[]
  const result: Record<string, number> = {}
  for (const r of rows) result[r.status] = r.cnt
  return result
}

// ── Scout stats ─────────────────────────────────────────────────────
export function getScoutStatsLocal(ws: string) {
  const db = getDb(ws)
  const positions = db.prepare('SELECT id, found_by, status FROM positions').all() as any[]
  const respondedIds = new Set(
    (db.prepare("SELECT position_id FROM applications WHERE status = 'response' OR response IS NOT NULL").all() as any[])
      .map(r => r.position_id)
  )

  const grouped: Record<string, { total: number; excluded: number; applied: number; responded: number }> = {}
  for (const row of positions) {
    const key = row.found_by ?? 'sconosciuto'
    if (!grouped[key]) grouped[key] = { total: 0, excluded: 0, applied: 0, responded: 0 }
    grouped[key].total++
    if (row.status === 'excluded') grouped[key].excluded++
    if (row.status === 'applied' || row.status === 'response') grouped[key].applied++
    if (respondedIds.has(row.id)) grouped[key].responded++
  }
  return Object.entries(grouped).map(([scout, s]) => ({
    scout, total: s.total, active: s.total - s.excluded, excluded: s.excluded, applied: s.applied, responded: s.responded,
  })).sort((a, b) => b.total - a.total)
}

// ── Scorer stats ────────────────────────────────────────────────────
export function getScorerStatsLocal(ws: string) {
  const db = getDb(ws)
  const rows = db.prepare('SELECT scored_by, total_score FROM scores').all() as { scored_by: string | null; total_score: number }[]
  const grouped: Record<string, number[]> = {}
  for (const row of rows) {
    const key = row.scored_by ?? 'sconosciuto'
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(row.total_score)
  }
  return Object.entries(grouped).map(([scorer, scores]) => ({
    scorer,
    total: scores.length,
    avgScore: scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
    high: scores.filter(s => s >= 70).length,
    mid: scores.filter(s => s >= 40 && s < 70).length,
    low: scores.filter(s => s < 40).length,
  })).sort((a, b) => b.total - a.total)
}

// ── Scrittore stats ─────────────────────────────────────────────────
export function getScrittoreStatsLocal(ws: string) {
  const db = getDb(ws)
  const rows = db.prepare('SELECT written_by, critic_verdict, applied FROM applications').all() as any[]
  const grouped: Record<string, { total: number; pass: number; needsWork: number; sent: number }> = {}
  for (const row of rows) {
    const key = row.written_by ?? 'sconosciuto'
    if (!grouped[key]) grouped[key] = { total: 0, pass: 0, needsWork: 0, sent: 0 }
    grouped[key].total++
    if (row.critic_verdict === 'PASS') grouped[key].pass++
    if (row.critic_verdict === 'NEEDS_WORK') grouped[key].needsWork++
    if (row.applied) grouped[key].sent++
  }
  return Object.entries(grouped).map(([scrittore, s]) => ({ scrittore, ...s })).sort((a, b) => b.total - a.total)
}

// ── Analista stats ──────────────────────────────────────────────────
export function getAnalistaStatsLocal(ws: string) {
  const db = getDb(ws)
  const rows = db.prepare('SELECT analyzed_by, verdict FROM companies WHERE analyzed_by IS NOT NULL').all() as any[]
  const grouped: Record<string, { total: number; go: number; cautious: number; noGo: number }> = {}
  for (const row of rows) {
    const key = row.analyzed_by
    if (!grouped[key]) grouped[key] = { total: 0, go: 0, cautious: 0, noGo: 0 }
    grouped[key].total++
    if (row.verdict === 'GO') grouped[key].go++
    if (row.verdict === 'CAUTIOUS') grouped[key].cautious++
    if (row.verdict === 'NO_GO') grouped[key].noGo++
  }
  return Object.entries(grouped).map(([analista, s]) => ({ analista, ...s })).sort((a, b) => b.total - a.total)
}

// ── Critico stats ───────────────────────────────────────────────────
export function getCriticoStatsLocal(ws: string) {
  const db = getDb(ws)
  const rows = db.prepare('SELECT reviewed_by, critic_verdict FROM applications WHERE reviewed_by IS NOT NULL').all() as any[]
  const grouped: Record<string, { total: number; pass: number; needsWork: number; reject: number }> = {}
  for (const row of rows) {
    const key = row.reviewed_by
    if (!grouped[key]) grouped[key] = { total: 0, pass: 0, needsWork: 0, reject: 0 }
    grouped[key].total++
    if (row.critic_verdict === 'PASS') grouped[key].pass++
    if (row.critic_verdict === 'NEEDS_WORK') grouped[key].needsWork++
    if (row.critic_verdict === 'REJECT') grouped[key].reject++
  }
  return Object.entries(grouped).map(([critico, s]) => ({ critico, ...s })).sort((a, b) => b.total - a.total)
}

// ── Critic verdict aggregate ────────────────────────────────────────
// Conta PASS / NEEDS_WORK / REJECT totali (non per critico).
// Per il widget "Conversion rate" della dashboard.
export function getCriticVerdictTotalsLocal(ws: string): {
  pass: number; needs_work: number; reject: number; total: number
} {
  const db = getDb(ws)
  const rows = db.prepare(
    "SELECT critic_verdict, count(*) as n FROM applications WHERE critic_verdict IS NOT NULL GROUP BY critic_verdict"
  ).all() as { critic_verdict: string; n: number }[]
  const out = { pass: 0, needs_work: 0, reject: 0, total: 0 }
  for (const r of rows) {
    out.total += r.n
    if (r.critic_verdict === 'PASS') out.pass = r.n
    else if (r.critic_verdict === 'NEEDS_WORK') out.needs_work = r.n
    else if (r.critic_verdict === 'REJECT') out.reject = r.n
  }
  return out
}

// ── Pending user messages (V5) ──────────────────────────────────────
// Restituisce i messaggi che l'utente deve ancora ack-are: arrivati via
// fallback web (Telegram down/non configurato) e non ancora visti.
// Quelli consegnati a Telegram non finiscono qui: l'utente li ha gia'
// visti sul telefono, non serve duplicarli in dashboard.
export function getPendingMessagesLocal(ws: string, limit = 20): PendingMessage[] {
  const db = getDb(ws)
  const rows = db.prepare(`
    SELECT id, agent, body, kind, related_position_id,
           delivered_via, delivered_at, acknowledged_at,
           user_reply, user_reply_at, agent_seen_reply_at, created_at
    FROM pending_user_messages
    WHERE delivered_via = 'web' AND acknowledged_at IS NULL
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as any[]

  return rows.map((r) => ({
    id: sid(r.id),
    agent: r.agent,
    body: r.body,
    kind: r.kind,
    related_position_id: r.related_position_id != null ? sid(r.related_position_id) : null,
    delivered_via: r.delivered_via,
    delivered_at: r.delivered_at,
    acknowledged_at: r.acknowledged_at,
    user_reply: r.user_reply,
    user_reply_at: r.user_reply_at,
    agent_seen_reply_at: r.agent_seen_reply_at,
    created_at: r.created_at,
  }))
}

export function ackPendingMessageLocal(ws: string, id: string): boolean {
  const db = getDb(ws)
  const result = db.prepare(`
    UPDATE pending_user_messages
    SET acknowledged_at = CURRENT_TIMESTAMP
    WHERE id = ? AND acknowledged_at IS NULL
  `).run(id)
  return result.changes > 0
}

export function replyPendingMessageLocal(ws: string, id: string, reply: string): boolean {
  const db = getDb(ws)
  // Risposta + ack atomico: una reply implica visione.
  const result = db.prepare(`
    UPDATE pending_user_messages
    SET user_reply = ?,
        user_reply_at = CURRENT_TIMESTAMP,
        acknowledged_at = COALESCE(acknowledged_at, CURRENT_TIMESTAMP)
    WHERE id = ?
  `).run(reply, id)
  return result.changes > 0
}

// ── Application stats ───────────────────────────────────────────────
export function getApplicationStatsLocal(ws: string): Record<string, number> {
  const db = getDb(ws)
  const rows = db.prepare('SELECT status, applied FROM applications').all() as { status: string; applied: number }[]
  const counts: Record<string, number> = {}
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1
  counts['_total'] = rows.length
  counts['_sent'] = rows.filter(r => r.applied).length
  return counts
}

// ── Mapping helpers ─────────────────────────────────────────────────

function mapPosition(r: any): PositionWithScore {
  return {
    id: sid(r.id), legacy_id: r.legacy_id ?? null, title: r.title, company: r.company,
    company_id: r.company_id ? sid(r.company_id) : null,
    location: r.location, remote_type: r.remote_type,
    salary_declared_min: r.salary_declared_min, salary_declared_max: r.salary_declared_max,
    salary_declared_currency: r.salary_declared_currency ?? null,
    salary_estimated_min: r.salary_estimated_min ?? null, salary_estimated_max: r.salary_estimated_max ?? null,
    salary_estimated_currency: r.salary_estimated_currency ?? null, salary_estimated_source: r.salary_estimated_source ?? null,
    url: r.url, source: r.source, jd_text: r.jd_text ?? null, requirements: r.requirements ?? null,
    found_by: r.found_by, found_at: r.found_at ?? '', deadline: r.deadline ?? null,
    status: r.status, notes: r.notes ?? null, last_checked: r.last_checked ?? null,
    role_family: r.role_family ?? null,
    loc_country: r.loc_country ?? null,
    loc_city: r.loc_city ?? null,
    score: r.score ?? undefined,
    critic_score: r.critic_score ?? null,
    critic_verdict: r.critic_verdict ?? null,
    scores: r.stack_match != null ? {
      id: '', position_id: sid(r.id), total_score: r.score ?? 0,
      stack_match: r.stack_match, remote_fit: r.remote_fit, salary_fit: r.salary_fit,
      experience_fit: r.experience_fit ?? null, strategic_fit: r.strategic_fit,
      breakdown: null, notes: null, scored_by: null, scored_at: '',
    } : undefined,
  }
}

function mapPositionFull(r: any): Position {
  return {
    id: sid(r.id), legacy_id: r.legacy_id ?? null, title: r.title, company: r.company,
    company_id: r.company_id ? sid(r.company_id) : null,
    location: r.location, remote_type: r.remote_type,
    salary_declared_min: r.salary_declared_min, salary_declared_max: r.salary_declared_max,
    salary_declared_currency: r.salary_declared_currency ?? null,
    salary_estimated_min: r.salary_estimated_min ?? null, salary_estimated_max: r.salary_estimated_max ?? null,
    salary_estimated_currency: r.salary_estimated_currency ?? null, salary_estimated_source: r.salary_estimated_source ?? null,
    url: r.url, source: r.source, jd_text: r.jd_text ?? null, requirements: r.requirements ?? null,
    found_by: r.found_by, found_at: r.found_at ?? '', deadline: r.deadline ?? null,
    status: r.status, notes: r.notes ?? null, last_checked: r.last_checked ?? null,
    write_requested: r.write_requested === 1 || r.write_requested === true,
    write_requested_at: r.write_requested_at ?? null,
    geocode_requested: r.geocode_requested === 1 || r.geocode_requested === true,
    geocode_requested_at: r.geocode_requested_at ?? null,
    office_geocoded: r.office_geocoded === 1 || r.office_geocoded === true,
  }
}

function mapScore(r: any): Score {
  return {
    id: sid(r.id), position_id: sid(r.position_id), total_score: r.total_score,
    stack_match: r.stack_match, remote_fit: r.remote_fit, salary_fit: r.salary_fit,
    experience_fit: r.experience_fit, strategic_fit: r.strategic_fit,
    breakdown: r.breakdown, notes: r.notes, scored_by: r.scored_by, scored_at: r.scored_at ?? '',
  }
}

function mapCompany(r: any): Company {
  return {
    id: sid(r.id), name: r.name, website: r.website, hq: r.hq_country ?? null,
    sector: r.sector, size: r.size, glassdoor_rating: r.glassdoor_rating,
    red_flags: r.red_flags, culture_notes: r.culture_notes,
    analyzed_by: r.analyzed_by, analyzed_at: r.analyzed_at, verdict: r.verdict,
  }
}

function mapApplication(r: any): Application {
  return {
    id: sid(r.id), position_id: sid(r.position_id),
    cv_path: r.cv_path, cl_path: r.cl_path, cv_pdf_path: r.cv_pdf_path, cl_pdf_path: r.cl_pdf_path,
    cv_drive_id: r.cv_drive_id ?? null, cl_drive_id: r.cl_drive_id ?? null,
    critic_verdict: r.critic_verdict, critic_score: r.critic_score, critic_notes: r.critic_notes,
    status: r.status, written_at: r.written_at, applied_at: r.applied_at, applied_via: r.applied_via,
    response: r.response, response_at: r.response_at,
    written_by: r.written_by, reviewed_by: r.reviewed_by,
    applied: !!r.applied, interview_round: r.interview_round,
  }
}

function mapAppWithPosition(r: any): ApplicationWithPosition {
  return {
    ...mapApplication(r),
    positions: {
      id: sid(r.p_id ?? r.position_id),
      title: r.p_title ?? '',
      company: r.p_company ?? '',
      status: r.p_status ?? 'new',
      url: r.p_url ?? null,
    },
  }
}
