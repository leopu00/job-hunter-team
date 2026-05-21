// fresh
import { createClient } from '@/lib/supabase/server'
import { getWorkspacePath, isSupabaseConfigured } from '@/lib/workspace'
import { isLocalRequest } from '@/lib/auth'
import * as local from '@/lib/local-queries'
import { aggregateTypes, type PositionTypeCount } from '@/lib/position-classifier'
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
} from '@/lib/types'

// Source of truth = origine della request:
//   - host=localhost (Mac dell'utente, JHT Desktop o browser locale) → SQLite
//   - host pubblico (deploy Vercel) → Supabase
// Vale per tutte le query (dashboard, positions, applications, scores...).
// In local mode il banner cloud-sync e il filtro synced/unsynced funzionano
// perché vediamo TUTTE le row locali e usiamo Supabase come overlay (non
// come fonte). In cloud puro Supabase è l'unica fonte.
async function ws(): Promise<string | null> {
  if (await isLocalRequest()) return getWorkspacePath()
  return null
}

// ── Dashboard Stats ────────────────────────────────────────────────
const EMPTY_STATS: DashboardStats = { total: 0, new: 0, checked: 0, scored: 0, writing: 0, review: 0, ready: 0, applied: 0, excluded: 0, response: 0 }

export async function getDashboardStats(): Promise<DashboardStats> {
  const w = await ws()
  if (w) {
    try { return local.getDashboardStatsLocal(w) } catch { return EMPTY_STATS }
  }
  if (!isSupabaseConfigured) return EMPTY_STATS

  const supabase = await createClient()
  const { data, error } = await supabase.from('positions').select('status')
  if (error || !data) return EMPTY_STATS

  const counts = data.reduce((acc: Record<string, number>, row: any) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  return {
    total: data.length, new: counts['new'] ?? 0, checked: counts['checked'] ?? 0,
    scored: counts['scored'] ?? 0, writing: counts['writing'] ?? 0, review: counts['review'] ?? 0,
    ready: counts['ready'] ?? 0, applied: counts['applied'] ?? 0, excluded: counts['excluded'] ?? 0,
    response: counts['response'] ?? 0,
  }
}

// ── Posizioni ordinate per ULTIMA azione qualsiasi ────────────────
export type RecentlyTouchedPosition = PositionWithScore & {
  last_action_at: string
  last_action_by: string
  last_action_actor: string
  voto: number | null
}

type CloudRecentEvent = {
  positionId: string
  ts: string
  role: string
  actor: string
}

function firstRelated<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function recordCloudEvent(
  events: Map<string, CloudRecentEvent>,
  positionId: string | null | undefined,
  ts: string | null | undefined,
  role: string,
  actor?: string | null,
) {
  if (!positionId || !ts) return
  const time = Date.parse(ts)
  if (!Number.isFinite(time)) return
  const prev = events.get(positionId)
  if (prev && Date.parse(prev.ts) >= time) return
  events.set(positionId, {
    positionId,
    ts,
    role,
    actor: actor || role,
  })
}

async function getRecentlyTouchedPositionsCloud(limit: number): Promise<RecentlyTouchedPosition[]> {
  if (!isSupabaseConfigured) return []
  const supabase = await createClient()
  const sampleLimit = Math.min(200, Math.max(40, limit * 5))

  const [
    foundRes,
    checkedRes,
    scoredRes,
    writtenRes,
    reviewedRes,
    appliedRes,
    responseRes,
  ] = await Promise.all([
    supabase
      .from('positions')
      .select('id, found_at, found_by')
      .not('found_at', 'is', null)
      .order('found_at', { ascending: false })
      .limit(sampleLimit),
    supabase
      .from('positions')
      .select('id, last_checked')
      .not('last_checked', 'is', null)
      .order('last_checked', { ascending: false })
      .limit(sampleLimit),
    supabase
      .from('scores')
      .select('position_id, scored_at, scored_by')
      .not('scored_at', 'is', null)
      .order('scored_at', { ascending: false })
      .limit(sampleLimit),
    supabase
      .from('applications')
      .select('position_id, written_at, written_by')
      .not('written_at', 'is', null)
      .order('written_at', { ascending: false })
      .limit(sampleLimit),
    supabase
      .from('applications')
      .select('position_id, critic_reviewed_at, reviewed_by')
      .not('critic_reviewed_at', 'is', null)
      .order('critic_reviewed_at', { ascending: false })
      .limit(sampleLimit),
    supabase
      .from('applications')
      .select('position_id, applied_at')
      .not('applied_at', 'is', null)
      .order('applied_at', { ascending: false })
      .limit(sampleLimit),
    supabase
      .from('applications')
      .select('position_id, response_at')
      .not('response_at', 'is', null)
      .order('response_at', { ascending: false })
      .limit(sampleLimit),
  ])

  if (
    foundRes.error ||
    checkedRes.error ||
    scoredRes.error ||
    writtenRes.error ||
    reviewedRes.error ||
    appliedRes.error ||
    responseRes.error
  ) {
    return getRecentPositions(limit) as Promise<RecentlyTouchedPosition[]>
  }

  const events = new Map<string, CloudRecentEvent>()
  for (const p of foundRes.data ?? []) {
    recordCloudEvent(events, p.id, p.found_at, 'scout', p.found_by)
  }
  for (const p of checkedRes.data ?? []) {
    recordCloudEvent(events, p.id, p.last_checked, 'analista', 'analista')
  }
  for (const s of scoredRes.data ?? []) {
    recordCloudEvent(events, s.position_id, s.scored_at, 'scorer', s.scored_by)
  }
  for (const a of writtenRes.data ?? []) {
    recordCloudEvent(events, a.position_id, a.written_at, 'scrittore', a.written_by)
  }
  for (const a of reviewedRes.data ?? []) {
    recordCloudEvent(events, a.position_id, a.critic_reviewed_at, 'critico', a.reviewed_by)
  }
  for (const a of appliedRes.data ?? []) {
    recordCloudEvent(events, a.position_id, a.applied_at, 'user', 'user')
  }
  for (const a of responseRes.data ?? []) {
    recordCloudEvent(events, a.position_id, a.response_at, 'user', 'user')
  }

  const ids = Array.from(events.keys())
  if (ids.length === 0) {
    return getRecentPositions(limit) as Promise<RecentlyTouchedPosition[]>
  }

  const { data, error } = await supabase
    .from('positions')
    .select(`
      id, legacy_id, title, company, location, remote_type,
      salary_declared_min, salary_declared_max, url, source,
      found_at, status, notes, last_checked, found_by, score,
      scores ( total_score, scored_at, scored_by ),
      applications (
        critic_score, written_at, written_by,
        critic_reviewed_at, reviewed_by, applied_at, response_at
      )
    `)
    .in('id', ids)

  if (error || !data) return []

  const positions = (data as any[]).map((p: any) => {
    const event = events.get(p.id)
    if (!event) return null
    const score = firstRelated<any>(p.scores)
    const application = firstRelated<any>(p.applications)
    return {
      ...p,
      scores: undefined,
      applications: undefined,
      score: p.score ?? score?.total_score ?? null,
      scored_at: score?.scored_at ?? null,
      last_action_at: event.ts,
      last_action_by: event.role,
      last_action_actor: event.actor,
      voto:
        typeof application?.critic_score === 'number'
          ? application.critic_score
          : null,
    } as RecentlyTouchedPosition
  })

  return positions
    .filter(
      (p: RecentlyTouchedPosition | null): p is RecentlyTouchedPosition =>
        p !== null,
    )
    .sort(
      (a: RecentlyTouchedPosition, b: RecentlyTouchedPosition) =>
        Date.parse(b.last_action_at) - Date.parse(a.last_action_at),
    )
    .slice(0, limit)
}

export async function getRecentlyTouchedPositions(limit = 15): Promise<RecentlyTouchedPosition[]> {
  const w = await ws()
  if (w) { try { return local.getRecentlyTouchedPositionsLocal(w, limit) } catch { return [] } }
  try { return getRecentlyTouchedPositionsCloud(limit) } catch { return [] }
}

// ── Recent positions with scores ───────────────────────────────────
export async function getRecentPositions(limit = 15): Promise<(PositionWithScore & { last_action_at?: string })[]> {
  const w = await ws()
  if (w) { try { return local.getRecentPositionsLocal(w, limit) } catch { return [] } }
  if (!isSupabaseConfigured) return []

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('positions')
    .select('id, legacy_id, title, company, location, remote_type, salary_declared_min, salary_declared_max, url, source, found_at, last_checked, status, notes, scores ( total_score, scored_at )')
    .not('status', 'eq', 'excluded')
    .order('found_at', { ascending: false })
    .limit(limit)
  if (error || !data) return []
  return data.map((p: any) => {
    // last_action_at = ULTIMA azione: scout / analista / scorer
    const score = Array.isArray(p.scores) ? p.scores[0] : p.scores
    const candidates = [p.found_at, p.last_checked, score?.scored_at].filter(Boolean) as string[]
    const last_action_at = candidates.length > 0
      ? candidates.reduce((acc, cur) => (cur > acc ? cur : acc))
      : p.found_at
    return { ...p, score: score?.total_score ?? undefined, last_action_at }
  })
}

// ── All positions with optional filters ────────────────────────────
// Sort: la dir base è applicata via supabase.order() per `found_at`
// (default). Per gli altri ordinamenti (score, critic, ecc.) il fetch
// resta su found_at e poi riordiniamo in memoria — limit 600 in chiamata
// è gestibile e tiene la logica fuori da PostgREST nested ordering.
const POSITION_SORT_KEYS = ['id', 'title', 'company', 'source', 'location', 'score', 'critic', 'found_at', 'status'] as const
type PositionSortKey = (typeof POSITION_SORT_KEYS)[number]

export async function getPositions(opts?: {
  status?: string; minScore?: number; maxScore?: number; noScore?: boolean
  remoteType?: string; limit?: number; offset?: number
  sort?: string; dir?: 'asc' | 'desc'
}): Promise<PositionWithScore[]> {
  const w = await ws()
  if (w) { try { return local.getPositionsLocal(w, opts) } catch { return [] } }
  if (!isSupabaseConfigured) return []

  const supabase = await createClient()
  let query = supabase
    .from('positions')
    .select('id, legacy_id, title, company, location, remote_type, salary_declared_min, salary_declared_max, salary_declared_currency, url, source, found_at, deadline, status, notes, score, scores ( total_score, stack_match, remote_fit, salary_fit, strategic_fit ), applications ( critic_score, critic_verdict )')
    .order('found_at', { ascending: false })

  if (opts?.status && opts.status !== 'all') query = query.eq('status', opts.status)
  if (opts?.remoteType && opts.remoteType !== 'all') query = query.eq('remote_type', opts.remoteType)
  if (opts?.noScore) { query = query.or('score.is.null,score.eq.0') }
  else {
    if (opts?.minScore) query = query.gte('score', opts.minScore)
    if (opts?.maxScore) query = query.lte('score', opts.maxScore)
  }
  if (opts?.limit) query = query.limit(opts.limit)
  if (opts?.offset) query = query.range(opts.offset, (opts.offset + (opts.limit ?? 50)) - 1)

  const { data, error } = await query
  if (error || !data) return []
  const mapped: PositionWithScore[] = data.map((p: any) => {
    const app = Array.isArray(p.applications) ? p.applications[0] : p.applications
    return {
      ...p,
      score: p.score ?? p.scores?.total_score ?? undefined,
      scores: p.scores ?? undefined,
      critic_score: app?.critic_score ?? null,
      critic_verdict: app?.critic_verdict ?? null,
    }
  })

  // Sort in memoria per le colonne richieste dalla UI.
  const sortKey: PositionSortKey | null = POSITION_SORT_KEYS.includes(opts?.sort as PositionSortKey)
    ? (opts!.sort as PositionSortKey)
    : null
  if (!sortKey) return mapped
  const dirMul = opts?.dir === 'asc' ? 1 : -1
  const getVal = (p: PositionWithScore): string | number | null => {
    switch (sortKey) {
      case 'score': return p.score ?? null
      case 'critic': return p.critic_score ?? null
      case 'found_at': return p.found_at ?? null
      default: return (p as any)[sortKey] ?? null
    }
  }
  return [...mapped].sort((a, b) => {
    const va = getVal(a), vb = getVal(b)
    // NULLS LAST in entrambe le direzioni
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dirMul
    return String(va).localeCompare(String(vb)) * dirMul
  })
}

// ── Single position with all details ───────────────────────────────
export async function getPositionById(id: string): Promise<{
  position: Position; score: Score | null; highlights: PositionHighlight[]; company: Company | null; application: Application | null
} | null> {
  const w = await ws()
  if (w) { try { return local.getPositionByIdLocal(w, id) } catch { return null } }
  if (!isSupabaseConfigured) return null

  const supabase = await createClient()
  const [posRes, scoreRes, hlRes, appRes] = await Promise.all([
    supabase.from('positions').select('*').eq('id', id).single(),
    supabase.from('scores').select('*').eq('position_id', id).maybeSingle(),
    supabase.from('position_highlights').select('*').eq('position_id', id).order('type'),
    supabase.from('applications').select('*').eq('position_id', id).maybeSingle(),
  ])
  if (posRes.error || !posRes.data) return null
  const position = posRes.data as Position
  let company: Company | null = null
  if (position.company_id) {
    const { data: compData } = await supabase.from('companies').select('*').eq('id', position.company_id).maybeSingle()
    company = compData ?? null
  }
  return { position, score: scoreRes.data ?? null, highlights: (hlRes.data ?? []) as PositionHighlight[], company, application: appRes.data ?? null }
}

// ── Applications with position info ────────────────────────────────
export async function getApplications(): Promise<ApplicationWithPosition[]> {
  const w = await ws()
  if (w) { try { return local.getApplicationsLocal(w) } catch { return [] } }
  if (!isSupabaseConfigured) return []

  const supabase = await createClient()
  const { data, error } = await supabase.from('applications').select('*, positions ( id, title, company, status, url )').order('written_at', { ascending: false })
  if (error || !data) return []
  return data as ApplicationWithPosition[]
}

// ── Applications filtered by status ────────────────────────────────
export async function getApplicationsByStatus(status: string): Promise<ApplicationWithPosition[]> {
  const w = await ws()
  if (w) { try { return local.getApplicationsByStatusLocal(w, status) } catch { return [] } }
  if (!isSupabaseConfigured) return []

  const supabase = await createClient()
  const { data, error } = await supabase.from('applications').select('*, positions ( id, title, company, status, url )').eq('status', status).order('response_at', { ascending: false })
  if (error || !data) return []
  return data as ApplicationWithPosition[]
}

// ── Risposte ────────────────────────────────────────────────────────
export async function getRisposte(): Promise<ApplicationWithPosition[]> {
  const w = await ws()
  if (w) { try { return local.getRisposteLocal(w) } catch { return [] } }
  if (!isSupabaseConfigured) return []

  const supabase = await createClient()
  const { data, error } = await supabase.from('applications').select('*, positions ( id, title, company, status, url )').or('status.eq.response,response.not.is.null').order('response_at', { ascending: false })
  if (error || !data) return []
  const seen = new Set<string>()
  return (data as ApplicationWithPosition[]).filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true })
}

// ── Risposte count ──────────────────────────────────────────────────
export async function getRisposteCount(): Promise<number> {
  const w = await ws()
  if (w) { try { return local.getRisposteCountLocal(w) } catch { return 0 } }
  if (!isSupabaseConfigured) return 0

  const supabase = await createClient()
  const { data, error } = await supabase.from('applications').select('id').or('status.eq.response,response.not.is.null')
  if (error || !data) return 0
  return new Set(data.map((r: any) => r.id)).size
}

// ── Score distribution ──────────────────────────────────────────────
export async function getScoreDistribution() {
  const w = await ws()
  if (w) { try { return local.getScoreDistributionLocal(w) } catch { /* fall through */ } }

  const empty = { buckets: [] as Array<{ label: string; count: number; color: string }>, total: 0, withScore: 0, avgScore: null as number | null, scores: [] as number[] }
  if (!isSupabaseConfigured) return empty

  const supabase = await createClient()
  const { data, error } = await supabase.from('positions').select('score, scores(total_score)').not('status', 'eq', 'excluded')
  if (error || !data) return empty

  const scores = data.map((r: any) => (r.score as number | null) ?? (r as any).scores?.total_score ?? null)
  const withScore = scores.filter((s: any): s is number => s != null && s > 0)
  const buckets = [
    { label: '76\u2013100', min: 76, max: 100, color: 'var(--color-green)' },
    { label: '61\u201375',  min: 61, max: 75,  color: 'var(--color-yellow)' },
    { label: '41\u201360',  min: 41, max: 60,  color: 'var(--color-orange)' },
    { label: '\u2264 40',   min: 0,  max: 40,  color: 'var(--color-red)' },
  ].map(b => ({ label: b.label, count: withScore.filter((s: number) => s >= b.min && s <= b.max).length, color: b.color }))
  const sum = withScore.reduce((a: number, s: number) => a + s, 0)
  return { buckets, total: scores.length, withScore: withScore.length, avgScore: withScore.length > 0 ? Math.round(sum / withScore.length) : null, scores: withScore }
}

// ── Source distribution ─────────────────────────────────────────────
export async function getSourceDistribution(): Promise<Array<{ source: string; count: number }>> {
  const w = await ws()
  if (w) { try { return local.getSourceDistributionLocal(w) } catch { return [] } }
  if (!isSupabaseConfigured) return []

  const supabase = await createClient()
  const { data, error } = await supabase.from('positions').select('source').not('status', 'eq', 'excluded')
  if (error || !data) return []
  const counts: Record<string, number> = {}
  for (const row of data) { const s = row.source ?? 'sconosciuta'; counts[s] = (counts[s] ?? 0) + 1 }
  return Object.entries(counts).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count).slice(0, 8)
}

// ── Positions con coordinate ufficio (per CompanyGlobe) ───────────────
export async function getPositionsWithCoords(): Promise<local.PositionCoord[]> {
  const w = await ws()
  if (w) { try { return local.getPositionsWithCoordsLocal(w) } catch { return [] } }
  if (!isSupabaseConfigured) return []

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('positions')
    .select('id, title, company, status, office_lat, office_lon, is_remote, scores ( total_score )')
    .not('status', 'eq', 'excluded')
    .not('office_lat', 'is', null)
  if (error || !data) return []
  return data.map((p: any) => {
    const score = Array.isArray(p.scores) ? p.scores[0] : p.scores
    return {
      id: String(p.id),
      title: p.title,
      company: p.company,
      status: p.status,
      score: typeof score?.total_score === 'number' ? score.total_score : null,
      lat: p.office_lat,
      lon: p.office_lon,
      is_remote: !!p.is_remote,
    }
  })
}

// ── Position state-history (timestamp delle transizioni) ──────────
// Restituisce per ogni posizione i timestamp delle transizioni di
// stato, sufficienti a ricostruire la composizione della pipeline a
// un istante T arbitrario (slider temporale nel dashboard).
export type PositionStateHistory = {
  id: string
  status: string
  critic_verdict: string | null
  found_at: string | null
  last_checked: string | null
  scored_at: string | null
  written_at: string | null
  critic_reviewed_at: string | null
  applied_at: string | null
  response_at: string | null
}

export async function getPositionStateHistory(): Promise<PositionStateHistory[]> {
  const w = await ws()
  if (w) { try { return local.getPositionStateHistoryLocal(w) } catch { return [] } }
  if (!isSupabaseConfigured) return []

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('positions')
    .select('id, status, found_at, last_checked, scores(scored_at), applications(written_at, critic_reviewed_at, critic_verdict, applied_at, response_at)')
  if (error || !data) return []
  return (data as any[]).map((p) => {
    const score = Array.isArray(p.scores) ? p.scores[0] : p.scores
    const app = Array.isArray(p.applications) ? p.applications[0] : p.applications
    return {
      id: String(p.id),
      status: p.status,
      critic_verdict: app?.critic_verdict ?? null,
      found_at: p.found_at ?? null,
      last_checked: p.last_checked ?? null,
      scored_at: score?.scored_at ?? null,
      written_at: app?.written_at ?? null,
      critic_reviewed_at: app?.critic_reviewed_at ?? null,
      applied_at: app?.applied_at ?? null,
      response_at: app?.response_at ?? null,
    }
  })
}

// ── Critic votes distribution ──────────────────────────────────────
export async function getCriticScores(): Promise<number[]> {
  const w = await ws()
  if (w) { try { return local.getCriticScoresLocal(w) } catch { return [] } }
  if (!isSupabaseConfigured) return []

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('applications')
    .select('critic_score, positions!inner(status)')
    .not('critic_score', 'is', null)
    .not('positions.status', 'eq', 'excluded')
  if (error || !data) return []
  return data
    .map((r: any) => r.critic_score)
    .filter((s: any): s is number => typeof s === 'number')
}

// ── Position type distribution ──────────────────────────────────────
export async function getPositionTypeDistribution(): Promise<PositionTypeCount[]> {
  const w = await ws()
  if (w) { try { return local.getPositionTypeDistributionLocal(w) } catch { return [] } }
  if (!isSupabaseConfigured) return []

  const supabase = await createClient()
  // Coerente con getScoreDistribution(): preferisci positions.score quando
  // presente, altrimenti fallback su scores.total_score via join.
  // critic_score sta in applications.
  const { data, error } = await supabase
    .from('positions')
    .select('title, score, scores(total_score), applications(critic_score)')
    .not('status', 'eq', 'excluded')
  if (error || !data) return []
  const rows = (data as any[]).map((r) => {
    const scoresRel = Array.isArray(r.scores) ? r.scores[0] : r.scores
    const appRel = Array.isArray(r.applications) ? r.applications[0] : r.applications
    return {
      title: r.title as string | null,
      score: (r.score as number | null) ?? (scoresRel?.total_score ?? null),
      critic: (appRel?.critic_score as number | null) ?? null,
    }
  })
  return aggregateTypes(rows)
}

// ── Positions count by status ───────────────────────────────────────
export async function getPositionsByStatus(): Promise<Record<string, number>> {
  const w = await ws()
  if (w) { try { return local.getPositionsByStatusLocal(w) } catch { return {} } }
  if (!isSupabaseConfigured) return {}

  const supabase = await createClient()
  const { data, error } = await supabase.from('positions').select('status')
  if (error || !data) return {}
  return data.reduce((acc: Record<string, number>, row: any) => { acc[row.status] = (acc[row.status] ?? 0) + 1; return acc }, {} as Record<string, number>)
}

// ── Scout stats ─────────────────────────────────────────────────────
export async function getScoutStats() {
  const w = await ws()
  if (w) { try { return local.getScoutStatsLocal(w) } catch { return [] } }
  if (!isSupabaseConfigured) return []

  const supabase = await createClient()
  const [posRes, appRes] = await Promise.all([
    supabase.from('positions').select('id, found_by, status'),
    supabase.from('applications').select('position_id').or('status.eq.response,response.not.is.null'),
  ])
  if (posRes.error || !posRes.data) return []
  const respondedPositionIds = new Set((appRes.data as any[] ?? []).map((a: any) => a.position_id))
  const grouped: Record<string, { total: number; excluded: number; applied: number; responded: number }> = {}
  for (const row of posRes.data) {
    const key = row.found_by ?? 'sconosciuto'
    if (!grouped[key]) grouped[key] = { total: 0, excluded: 0, applied: 0, responded: 0 }
    grouped[key].total++
    if (row.status === 'excluded') grouped[key].excluded++
    if (row.status === 'applied' || row.status === 'response') grouped[key].applied++
    if (respondedPositionIds.has(row.id)) grouped[key].responded++
  }
  return Object.entries(grouped).map(([scout, s]) => ({ scout, total: s.total, active: s.total - s.excluded, excluded: s.excluded, applied: s.applied, responded: s.responded })).sort((a, b) => b.total - a.total)
}

// ── Scorer stats ────────────────────────────────────────────────────
export async function getScorerStats() {
  const w = await ws()
  if (w) { try { return local.getScorerStatsLocal(w) } catch { return [] } }
  if (!isSupabaseConfigured) return []

  const supabase = await createClient()
  const { data, error } = await supabase.from('scores').select('scored_by, total_score')
  if (error || !data) return []
  const grouped: Record<string, number[]> = {}
  for (const row of data) { const key = row.scored_by ?? 'sconosciuto'; if (!grouped[key]) grouped[key] = []; grouped[key].push(row.total_score) }
  return Object.entries(grouped).map(([scorer, scores]) => ({
    scorer, total: scores.length, avgScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    high: scores.filter(s => s >= 70).length, mid: scores.filter(s => s >= 40 && s < 70).length, low: scores.filter(s => s < 40).length,
  })).sort((a, b) => b.total - a.total)
}

// ── Scrittore stats ─────────────────────────────────────────────────
export async function getScrittoreStats() {
  const w = await ws()
  if (w) { try { return local.getScrittoreStatsLocal(w) } catch { return [] } }
  if (!isSupabaseConfigured) return []

  const supabase = await createClient()
  const { data, error } = await supabase.from('applications').select('written_by, critic_verdict, applied')
  if (error || !data) return []
  const grouped: Record<string, { total: number; pass: number; needsWork: number; sent: number }> = {}
  for (const row of data) { const key = row.written_by ?? 'sconosciuto'; if (!grouped[key]) grouped[key] = { total: 0, pass: 0, needsWork: 0, sent: 0 }; grouped[key].total++; if (row.critic_verdict === 'PASS') grouped[key].pass++; if (row.critic_verdict === 'NEEDS_WORK') grouped[key].needsWork++; if (row.applied) grouped[key].sent++ }
  return Object.entries(grouped).map(([scrittore, s]) => ({ scrittore, ...s })).sort((a, b) => b.total - a.total)
}

// ── Analista stats ──────────────────────────────────────────────────
export async function getAnalistaStats() {
  const w = await ws()
  if (w) { try { return local.getAnalistaStatsLocal(w) } catch { return [] } }
  if (!isSupabaseConfigured) return []

  const supabase = await createClient()
  const { data, error } = await supabase.from('companies').select('analyzed_by, verdict').not('analyzed_by', 'is', null)
  if (error || !data) return []
  const grouped: Record<string, { total: number; go: number; cautious: number; noGo: number }> = {}
  for (const row of data) { const key = row.analyzed_by!; if (!grouped[key]) grouped[key] = { total: 0, go: 0, cautious: 0, noGo: 0 }; grouped[key].total++; if (row.verdict === 'GO') grouped[key].go++; if (row.verdict === 'CAUTIOUS') grouped[key].cautious++; if (row.verdict === 'NO_GO') grouped[key].noGo++ }
  return Object.entries(grouped).map(([analista, s]) => ({ analista, ...s })).sort((a, b) => b.total - a.total)
}

// ── Critico stats ───────────────────────────────────────────────────
export async function getCriticoStats() {
  const w = await ws()
  if (w) { try { return local.getCriticoStatsLocal(w) } catch { return [] } }
  if (!isSupabaseConfigured) return []

  const supabase = await createClient()
  const { data, error } = await supabase.from('applications').select('reviewed_by, critic_verdict').not('reviewed_by', 'is', null)
  if (error || !data) return []
  const grouped: Record<string, { total: number; pass: number; needsWork: number; reject: number }> = {}
  for (const row of data) { const key = row.reviewed_by!; if (!grouped[key]) grouped[key] = { total: 0, pass: 0, needsWork: 0, reject: 0 }; grouped[key].total++; if (row.critic_verdict === 'PASS') grouped[key].pass++; if (row.critic_verdict === 'NEEDS_WORK') grouped[key].needsWork++; if (row.critic_verdict === 'REJECT') grouped[key].reject++ }
  return Object.entries(grouped).map(([critico, s]) => ({ critico, ...s })).sort((a, b) => b.total - a.total)
}

// ── Critic verdict aggregate totals ─────────────────────────────────
// Per il widget "Conversion rate" della dashboard: somma PASS /
// NEEDS_WORK / REJECT su TUTTE le applications (non spezzate per critico).
export type CriticVerdictTotals = {
  pass: number
  needs_work: number
  reject: number
  total: number
}

export async function getCriticVerdictTotals(): Promise<CriticVerdictTotals> {
  const w = await ws()
  if (w) {
    try { return local.getCriticVerdictTotalsLocal(w) } catch { return { pass: 0, needs_work: 0, reject: 0, total: 0 } }
  }
  if (!isSupabaseConfigured) return { pass: 0, needs_work: 0, reject: 0, total: 0 }

  const supabase = await createClient()
  const { data, error } = await supabase.from('applications').select('critic_verdict').not('critic_verdict', 'is', null)
  if (error || !data) return { pass: 0, needs_work: 0, reject: 0, total: 0 }
  const out: CriticVerdictTotals = { pass: 0, needs_work: 0, reject: 0, total: 0 }
  for (const row of data as { critic_verdict: string | null }[]) {
    out.total++
    if (row.critic_verdict === 'PASS') out.pass++
    else if (row.critic_verdict === 'NEEDS_WORK') out.needs_work++
    else if (row.critic_verdict === 'REJECT') out.reject++
  }
  return out
}

// ── Pending user messages (V5) ──────────────────────────────────────
// Notifiche agente -> utente in fallback web. Cloud: filtra per user_id
// implicito via RLS. Local: legge SQLite via local-queries.
export async function getPendingMessages(limit = 20): Promise<PendingMessage[]> {
  const w = await ws()
  if (w) {
    try { return local.getPendingMessagesLocal(w, limit) } catch { return [] }
  }
  if (!isSupabaseConfigured) return []

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('pending_user_messages')
    .select(
      'id, agent, body, kind, related_position_id, delivered_via, delivered_at, ' +
      'acknowledged_at, user_reply, user_reply_at, agent_seen_reply_at, created_at'
    )
    .eq('delivered_via', 'web')
    .is('acknowledged_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error || !data) return []
  return data as PendingMessage[]
}

// ── Application stats ───────────────────────────────────────────────
export async function getApplicationStats(): Promise<Record<string, number>> {
  const w = await ws()
  if (w) { try { return local.getApplicationStatsLocal(w) } catch { return {} } }
  if (!isSupabaseConfigured) return {}

  const supabase = await createClient()
  const { data, error } = await supabase.from('applications').select('status, applied')
  if (error || !data) return {}
  const counts = data.reduce((acc: Record<string, number>, row: any) => { acc[row.status] = (acc[row.status] ?? 0) + 1; return acc }, {} as Record<string, number>)
  counts['_total'] = data.length
  counts['_sent'] = data.filter((r: any) => r.applied).length
  return counts
}
