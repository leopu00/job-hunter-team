import { getDb } from './db'
import type {
  DashboardStats,
  PositionWithScore,
  Position,
  Score,
  PositionHighlight,
  Company,
  ApplicationWithPosition,
  Application,
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
  }
}

// ── Recent positions with scores ───────────────────────────────────
export function getRecentPositionsLocal(ws: string, limit = 15): PositionWithScore[] {
  const db = getDb(ws)
  const rows = db.prepare(`
    SELECT p.*, s.total_score as score
    FROM positions p
    LEFT JOIN scores s ON s.position_id = p.id
    WHERE p.status != 'excluded'
    ORDER BY p.found_at DESC
    LIMIT ?
  `).all(limit) as any[]

  return rows.map(r => mapPosition(r))
}

// ── All positions with optional filters ────────────────────────────
export function getPositionsLocal(ws: string, opts?: {
  status?: string; minScore?: number; maxScore?: number; noScore?: boolean
  remoteType?: string; limit?: number; offset?: number
}): PositionWithScore[] {
  const db = getDb(ws)
  const where: string[] = []
  const params: any[] = []

  if (opts?.status && opts.status !== 'all') {
    where.push('p.status = ?')
    params.push(opts.status)
  }
  if (opts?.remoteType && opts.remoteType !== 'all') {
    where.push('p.remote_type = ?')
    params.push(opts.remoteType)
  }
  if (opts?.noScore) {
    where.push('(s.total_score IS NULL OR s.total_score = 0)')
  } else {
    if (opts?.minScore) { where.push('s.total_score >= ?'); params.push(opts.minScore) }
    if (opts?.maxScore) { where.push('s.total_score <= ?'); params.push(opts.maxScore) }
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const limitClause = opts?.limit ? `LIMIT ?` : ''
  const offsetClause = opts?.offset ? `OFFSET ?` : ''
  if (opts?.limit) params.push(opts.limit)
  if (opts?.offset) params.push(opts.offset)

  const sql = `
    SELECT p.*, s.total_score as score,
      s.stack_match, s.remote_fit, s.salary_fit, s.strategic_fit
    FROM positions p
    LEFT JOIN scores s ON s.position_id = p.id
    ${whereClause}
    ORDER BY p.found_at DESC
    ${limitClause} ${offsetClause}
  `
  const rows = db.prepare(sql).all(...params) as any[]
  return rows.map(r => mapPosition(r))
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

  return { buckets, total: allScores.length, withScore: withScore.length, avgScore }
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
    avgScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
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
    score: r.score ?? undefined,
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
