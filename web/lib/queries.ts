import { createClient } from '@/lib/supabase/server'
import type {
  DashboardStats,
  PositionWithScore,
  Position,
  Score,
  PositionHighlight,
  Company,
  ApplicationWithPosition,
  Application,
} from '@/lib/types'

// ── Dashboard Stats ────────────────────────────────────────────────
export async function getDashboardStats(): Promise<DashboardStats> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('positions')
    .select('status')

  if (error || !data) {
    console.error('[getDashboardStats] error:', error?.message, error?.code)
    return { total: 0, new: 0, checked: 0, scored: 0, writing: 0, review: 0, ready: 0, applied: 0, excluded: 0, response: 0 }
  }

  const counts = data.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  return {
    total: data.length,
    new: counts['new'] ?? 0,
    checked: counts['checked'] ?? 0,
    scored: counts['scored'] ?? 0,
    writing: counts['writing'] ?? 0,
    review: counts['review'] ?? 0,
    ready: counts['ready'] ?? 0,
    applied: counts['applied'] ?? 0,
    excluded: counts['excluded'] ?? 0,
    response: counts['response'] ?? 0,
  }
}

// ── Recent positions with scores (for dashboard) ───────────────────
export async function getRecentPositions(limit = 15): Promise<PositionWithScore[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('positions')
    .select(`
      id, legacy_id, title, company, location, remote_type,
      salary_declared_min, salary_declared_max,
      url, source, found_at, status, notes,
      scores ( total_score )
    `)
    .not('status', 'eq', 'excluded')
    .order('found_at', { ascending: false })
    .limit(limit)

  if (error || !data) return []

  return data.map((p: any) => ({
    ...p,
    score: p.scores?.total_score ?? undefined,
  }))
}

// ── All positions with optional filters ───────────────────────────
export async function getPositions(opts?: {
  status?: string
  minScore?: number
  maxScore?: number
  noScore?: boolean
  remoteType?: string
  limit?: number
  offset?: number
}): Promise<PositionWithScore[]> {
  const supabase = await createClient()

  let query = supabase
    .from('positions')
    .select(`
      id, legacy_id, title, company, location, remote_type,
      salary_declared_min, salary_declared_max, salary_declared_currency,
      url, source, found_at, deadline, status, notes, score,
      scores ( total_score, stack_match, remote_fit, salary_fit, strategic_fit )
    `)
    .order('found_at', { ascending: false })

  if (opts?.status && opts.status !== 'all') {
    query = query.eq('status', opts.status)
  }
  if (opts?.remoteType && opts.remoteType !== 'all') {
    query = query.eq('remote_type', opts.remoteType)
  }
  if (opts?.noScore) {
    query = query.or('score.is.null,score.eq.0')
  } else {
    if (opts?.minScore) {
      query = query.gte('score', opts.minScore)
    }
    if (opts?.maxScore) {
      query = query.lte('score', opts.maxScore)
    }
  }
  if (opts?.limit) {
    query = query.limit(opts.limit)
  }
  if (opts?.offset) {
    query = query.range(opts.offset, (opts.offset + (opts.limit ?? 50)) - 1)
  }

  const { data, error } = await query
  if (error || !data) return []

  return data.map((p: any) => ({
    ...p,
    score: p.score ?? p.scores?.total_score ?? undefined,
    scores: p.scores ?? undefined,
  }))
}

// ── Single position with all details ──────────────────────────────
export async function getPositionById(id: string): Promise<{
  position: Position
  score: Score | null
  highlights: PositionHighlight[]
  company: Company | null
  application: Application | null
} | null> {
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
    const { data: compData } = await supabase
      .from('companies')
      .select('*')
      .eq('id', position.company_id)
      .maybeSingle()
    company = compData ?? null
  }

  return {
    position,
    score: scoreRes.data ?? null,
    highlights: (hlRes.data ?? []) as PositionHighlight[],
    company,
    application: appRes.data ?? null,
  }
}

// ── Applications with position info ───────────────────────────────
export async function getApplications(): Promise<ApplicationWithPosition[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('applications')
    .select(`
      *,
      positions ( id, title, company, status, url )
    `)
    .order('written_at', { ascending: false })

  if (error || !data) return []
  return data as ApplicationWithPosition[]
}

// ── Applications filtered by status ───────────────────────────────
export async function getApplicationsByStatus(status: string): Promise<ApplicationWithPosition[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('applications')
    .select(`
      *,
      positions ( id, title, company, status, url )
    `)
    .eq('status', status)
    .order('response_at', { ascending: false })

  if (error || !data) return []
  return data as ApplicationWithPosition[]
}

// ── Risposte: status='response' O campo response non-null ──────────
// Nel legacy le risposte includono qualsiasi applicazione che ha
// ricevuto un feedback (response non-null), non solo status='response'.
export async function getRisposte(): Promise<ApplicationWithPosition[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('applications')
    .select(`
      *,
      positions ( id, title, company, status, url )
    `)
    .or('status.eq.response,response.not.is.null')
    .order('response_at', { ascending: false })

  if (error || !data) return []
  const seen = new Set<string>()
  return (data as ApplicationWithPosition[]).filter(a => {
    if (seen.has(a.id)) return false
    seen.add(a.id)
    return true
  })
}

// ── Conteggio risposte (OR: status='response' | response non-null) ─
export async function getRisposteCount(): Promise<number> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('applications')
    .select('id')
    .or('status.eq.response,response.not.is.null')
  if (error || !data) return 0
  const seen = new Set(data.map(r => r.id))
  return seen.size
}

// ── Score distribution (for dashboard charts) ─────────────────────
export async function getScoreDistribution(): Promise<{
  buckets: Array<{ label: string; count: number; color: string }>
  total: number
  withScore: number
  avgScore: number | null
}> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('positions')
    .select('score, scores(total_score)')
    .not('status', 'eq', 'excluded')

  if (error || !data) return { buckets: [], total: 0, withScore: 0, avgScore: null }

  // Usa positions.score se presente, altrimenti scores.total_score dalla tabella relazionale
  const scores = data.map(r => (r.score as number | null) ?? (r as any).scores?.total_score ?? null)
  const withScore = scores.filter((s): s is number => s != null && s > 0)

  const buckets = [
    { label: '76–100', min: 76, max: 100, color: 'var(--color-green)' },
    { label: '61–75',  min: 61, max: 75,  color: 'var(--color-yellow)' },
    { label: '41–60',  min: 41, max: 60,  color: 'var(--color-orange)' },
    { label: '≤ 40',   min: 0,  max: 40,  color: 'var(--color-red)' },
  ].map(b => ({
    label: b.label,
    count: withScore.filter(s => s >= b.min && s <= b.max).length,
    color: b.color,
  }))

  const sum = withScore.reduce((a, s) => a + s, 0)
  const avgScore = withScore.length > 0 ? Math.round(sum / withScore.length) : null

  return { buckets, total: scores.length, withScore: withScore.length, avgScore }
}

// ── Source distribution ────────────────────────────────────────────
export async function getSourceDistribution(): Promise<Array<{ source: string; count: number }>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('positions')
    .select('source')
    .not('status', 'eq', 'excluded')

  if (error || !data) return []

  const counts: Record<string, number> = {}
  for (const row of data) {
    const s = row.source ?? 'sconosciuta'
    counts[s] = (counts[s] ?? 0) + 1
  }

  return Object.entries(counts)
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
}

// ── Analytics: positions count by status ──────────────────────────
export async function getPositionsByStatus(): Promise<Record<string, number>> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('positions').select('status')
  if (error || !data) return {}
  return data.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)
}

// ── Scout stats (grouped by found_by) ─────────────────────────────
export async function getScoutStats(): Promise<Array<{
  scout: string; total: number; active: number; excluded: number; applied: number; responded: number
}>> {
  const supabase = await createClient()
  const [posRes, appRes] = await Promise.all([
    supabase.from('positions').select('id, found_by, status'),
    supabase.from('applications').select('position_id').or('status.eq.response,response.not.is.null'),
  ])
  if (posRes.error || !posRes.data) return []

  // Set di position_id che hanno ricevuto una risposta (stessa logica di getRisposte)
  const respondedPositionIds = new Set((appRes.data ?? []).map(a => a.position_id))

  const grouped: Record<string, { total: number; excluded: number; applied: number; responded: number }> = {}
  for (const row of posRes.data) {
    const key = row.found_by ?? 'sconosciuto'
    if (!grouped[key]) grouped[key] = { total: 0, excluded: 0, applied: 0, responded: 0 }
    grouped[key].total++
    if (row.status === 'excluded') grouped[key].excluded++
    if (row.status === 'applied' || row.status === 'response') grouped[key].applied++
    if (respondedPositionIds.has(row.id)) grouped[key].responded++
  }
  return Object.entries(grouped).map(([scout, s]) => ({
    scout, total: s.total, active: s.total - s.excluded, excluded: s.excluded, applied: s.applied, responded: s.responded,
  })).sort((a, b) => b.total - a.total)
}

// ── Scorer stats (grouped by scored_by) ────────────────────────────
export async function getScorerStats(): Promise<Array<{
  scorer: string; total: number; avgScore: number; high: number; mid: number; low: number
}>> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('scores').select('scored_by, total_score')
  if (error || !data) return []
  const grouped: Record<string, number[]> = {}
  for (const row of data) {
    const key = row.scored_by ?? 'sconosciuto'
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(row.total_score)
  }
  return Object.entries(grouped).map(([scorer, scores]) => ({
    scorer,
    total: scores.length,
    avgScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    high: scores.filter(s => s >= 70).length,
    mid: scores.filter(s => s >= 40 && s < 70).length,
    low: scores.filter(s => s < 40).length,
  })).sort((a, b) => b.total - a.total)
}

// ── Scrittore stats (grouped by written_by) ────────────────────────
export async function getScrittoreStats(): Promise<Array<{
  scrittore: string; total: number; pass: number; needsWork: number; sent: number
}>> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('applications').select('written_by, critic_verdict, applied')
  if (error || !data) return []
  const grouped: Record<string, { total: number; pass: number; needsWork: number; sent: number }> = {}
  for (const row of data) {
    const key = row.written_by ?? 'sconosciuto'
    if (!grouped[key]) grouped[key] = { total: 0, pass: 0, needsWork: 0, sent: 0 }
    grouped[key].total++
    if (row.critic_verdict === 'PASS') grouped[key].pass++
    if (row.critic_verdict === 'NEEDS_WORK') grouped[key].needsWork++
    if (row.applied) grouped[key].sent++
  }
  return Object.entries(grouped).map(([scrittore, s]) => ({ scrittore, ...s })).sort((a, b) => b.total - a.total)
}

// ── Analista stats (grouped by analyzed_by) ────────────────────────
export async function getAnalistaStats(): Promise<Array<{
  analista: string; total: number; go: number; cautious: number; noGo: number
}>> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('companies').select('analyzed_by, verdict').not('analyzed_by', 'is', null)
  if (error || !data) return []
  const grouped: Record<string, { total: number; go: number; cautious: number; noGo: number }> = {}
  for (const row of data) {
    const key = row.analyzed_by!
    if (!grouped[key]) grouped[key] = { total: 0, go: 0, cautious: 0, noGo: 0 }
    grouped[key].total++
    if (row.verdict === 'GO') grouped[key].go++
    if (row.verdict === 'CAUTIOUS') grouped[key].cautious++
    if (row.verdict === 'NO_GO') grouped[key].noGo++
  }
  return Object.entries(grouped).map(([analista, s]) => ({ analista, ...s })).sort((a, b) => b.total - a.total)
}

// ── Critico stats (grouped by reviewed_by) ─────────────────────────
export async function getCriticoStats(): Promise<Array<{
  critico: string; total: number; pass: number; needsWork: number; reject: number
}>> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('applications').select('reviewed_by, critic_verdict').not('reviewed_by', 'is', null)
  if (error || !data) return []
  const grouped: Record<string, { total: number; pass: number; needsWork: number; reject: number }> = {}
  for (const row of data) {
    const key = row.reviewed_by!
    if (!grouped[key]) grouped[key] = { total: 0, pass: 0, needsWork: 0, reject: 0 }
    grouped[key].total++
    if (row.critic_verdict === 'PASS') grouped[key].pass++
    if (row.critic_verdict === 'NEEDS_WORK') grouped[key].needsWork++
    if (row.critic_verdict === 'REJECT') grouped[key].reject++
  }
  return Object.entries(grouped).map(([critico, s]) => ({ critico, ...s })).sort((a, b) => b.total - a.total)
}

// ── Analytics: applications count by status ────────────────────────
export async function getApplicationStats(): Promise<Record<string, number>> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('applications').select('status, applied')
  if (error || !data) return {}
  const counts = data.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)
  counts['_total'] = data.length
  counts['_sent'] = data.filter(r => r.applied).length
  return counts
}
