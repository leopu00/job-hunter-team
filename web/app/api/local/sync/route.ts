import { NextResponse } from 'next/server'
import Database from 'better-sqlite3'
import { createClient } from '@/lib/supabase/server'
import { getLocalDbPath, localDbExists } from '@/lib/cloud-sync/local'
import { writeSyncState } from '@/lib/cloud-sync/state'

export const dynamic = 'force-dynamic'

const POSITIONS_COLUMNS = [
  'id', 'title', 'company', 'url', 'location', 'remote_type', 'status',
  'notes', 'source', 'jd_text', 'requirements', 'found_by', 'found_at',
  'deadline', 'last_checked',
  'salary_declared_min', 'salary_declared_max', 'salary_declared_currency',
  'salary_estimated_min', 'salary_estimated_max', 'salary_estimated_currency',
  'salary_estimated_source',
]

const SCORES_COLUMNS = [
  'position_id', 'total_score', 'experience_fit', 'salary_fit',
  'stack_match', 'remote_fit', 'strategic_fit', 'breakdown', 'notes',
  'scored_by', 'scored_at',
]

const APPLICATIONS_COLUMNS = [
  'position_id', 'cv_path', 'cv_pdf_path', 'cl_path', 'cl_pdf_path',
  'status', 'critic_score', 'critic_verdict', 'critic_notes',
  'written_at', 'applied_at', 'applied_via', 'response', 'response_at',
  'written_by', 'reviewed_by', 'critic_reviewed_at', 'applied',
  'cv_drive_id', 'cl_drive_id',
]

const ALLOWED_POSITION_STATUS = new Set([
  'new', 'checked', 'excluded', 'scored', 'writing', 'review', 'ready', 'applied', 'response',
])
const ALLOWED_APPLICATION_STATUS = new Set(['draft', 'review', 'approved', 'applied', 'response'])
const ALLOWED_CRITIC_VERDICT = new Set(['PASS', 'NEEDS_WORK', 'REJECT'])

interface PositionRow {
  id: number
  title: string
  company: string
  url: string | null
  location: string | null
  remote_type: string | null
  status: string | null
  notes: string | null
  source: string | null
  jd_text: string | null
  requirements: string | null
  found_by: string | null
  found_at: string | null
  deadline: string | null
  last_checked: string | null
  salary_declared_min: number | null
  salary_declared_max: number | null
  salary_declared_currency: string | null
  salary_estimated_min: number | null
  salary_estimated_max: number | null
  salary_estimated_currency: string | null
  salary_estimated_source: string | null
}

interface ScoreRow {
  position_id: number
  total_score: number
  experience_fit: number | null
  salary_fit: number | null
  stack_match: number | null
  remote_fit: number | null
  strategic_fit: number | null
  breakdown: string | null
  notes: string | null
  scored_by: string | null
  scored_at: string | null
}

interface ApplicationRow {
  position_id: number
  cv_path: string | null
  cv_pdf_path: string | null
  cl_path: string | null
  cl_pdf_path: string | null
  status: string | null
  critic_score: number | null
  critic_verdict: string | null
  critic_notes: string | null
  written_at: string | null
  applied_at: string | null
  applied_via: string | null
  response: string | null
  response_at: string | null
  written_by: string | null
  reviewed_by: string | null
  critic_reviewed_at: string | null
  applied: number | null
  cv_drive_id: string | null
  cl_drive_id: string | null
}

function readTable<T>(db: Database.Database, table: string, columns: string[]): T[] {
  try {
    return db.prepare(`SELECT ${columns.join(', ')} FROM ${table}`).all() as T[]
  } catch (err) {
    if (err instanceof Error && /no such table/i.test(err.message)) return []
    throw err
  }
}

function normalizePositionStatus(s: string | null): string {
  if (!s) return 'new'
  return ALLOWED_POSITION_STATUS.has(s) ? s : 'new'
}

function normalizeApplicationStatus(s: string | null): string | null {
  if (!s) return null
  return ALLOWED_APPLICATION_STATUS.has(s) ? s : 'draft'
}

function normalizeCriticVerdict(v: string | null): string | null {
  if (!v) return null
  return ALLOWED_CRITIC_VERDICT.has(v) ? v : null
}

export async function POST() {
  if (!(await localDbExists())) {
    return NextResponse.json(
      { error: 'Database locale non trovato (~/.jht/jobs.db). Avvia il team almeno una volta.' },
      { status: 404 }
    )
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(
      { error: 'Non autenticato. Effettua il login per sincronizzare.' },
      { status: 401 }
    )
  }
  const userId = user.id

  let positions: PositionRow[] = []
  let scores: ScoreRow[] = []
  let applications: ApplicationRow[] = []
  let db: Database.Database | null = null
  try {
    db = new Database(getLocalDbPath(), { readonly: true, fileMustExist: true })
    positions = readTable<PositionRow>(db, 'positions', POSITIONS_COLUMNS)
    scores = readTable<ScoreRow>(db, 'scores', SCORES_COLUMNS)
    applications = readTable<ApplicationRow>(db, 'applications', APPLICATIONS_COLUMNS)
  } catch (err) {
    return NextResponse.json(
      { error: `Errore lettura SQLite: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  } finally {
    db?.close()
  }

  if (positions.length === 0 && scores.length === 0 && applications.length === 0) {
    return NextResponse.json({
      empty: true,
      positions: { upserted: 0 },
      scores: { upserted: 0 },
      applications: { upserted: 0 },
    })
  }

  const legacyToUuid = new Map<number, string>()
  let positionsUpserted = 0
  let scoresUpserted = 0
  let applicationsUpserted = 0

  // 1. Upsert positions via (user_id, legacy_id)
  if (positions.length > 0) {
    const payload = positions
      .filter((p) => typeof p.id === 'number' && p.title && p.company)
      .map((p) => ({
        user_id: userId,
        legacy_id: p.id,
        title: p.title,
        company: p.company,
        url: p.url,
        location: p.location,
        remote_type: p.remote_type,
        status: normalizePositionStatus(p.status),
        notes: p.notes,
        source: p.source,
        jd_text: p.jd_text,
        requirements: p.requirements,
        found_by: p.found_by,
        found_at: p.found_at,
        deadline: p.deadline,
        last_checked: p.last_checked,
        salary_declared_min: p.salary_declared_min,
        salary_declared_max: p.salary_declared_max,
        salary_declared_currency: p.salary_declared_currency,
        salary_estimated_min: p.salary_estimated_min,
        salary_estimated_max: p.salary_estimated_max,
        salary_estimated_currency: p.salary_estimated_currency,
        salary_estimated_source: p.salary_estimated_source,
      }))

    const { data: upserted, error } = await supabase
      .from('positions')
      .upsert(payload, { onConflict: 'user_id,legacy_id' })
      .select('id, legacy_id')

    if (error) {
      return NextResponse.json(
        { error: `positions upsert: ${error.message}` },
        { status: 500 }
      )
    }
    positionsUpserted = upserted?.length ?? 0
    for (const row of upserted ?? []) {
      if (row.legacy_id != null) legacyToUuid.set(row.legacy_id, row.id)
    }
  }

  // 2. Upsert scores via position_id UUID
  if (scores.length > 0 && legacyToUuid.size > 0) {
    const payload = scores
      .map((s) => {
        const uuid = legacyToUuid.get(s.position_id)
        if (!uuid || typeof s.total_score !== 'number') return null
        return {
          user_id: userId,
          position_id: uuid,
          total_score: Math.max(0, Math.min(100, Math.round(s.total_score))),
          experience_fit: s.experience_fit,
          salary_fit: s.salary_fit,
          stack_match: s.stack_match,
          remote_fit: s.remote_fit,
          strategic_fit: s.strategic_fit,
          breakdown: s.breakdown,
          notes: s.notes,
          scored_by: s.scored_by,
          scored_at: s.scored_at,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    if (payload.length > 0) {
      const { data: upserted, error } = await supabase
        .from('scores')
        .upsert(payload, { onConflict: 'position_id' })
        .select('id')
      if (error) {
        return NextResponse.json(
          { error: `scores upsert: ${error.message}` },
          { status: 500 }
        )
      }
      scoresUpserted = upserted?.length ?? 0
    }
  }

  // 3. Upsert applications via position_id UUID
  if (applications.length > 0 && legacyToUuid.size > 0) {
    const payload = applications
      .map((a) => {
        const uuid = legacyToUuid.get(a.position_id)
        if (!uuid) return null
        return {
          user_id: userId,
          position_id: uuid,
          cv_path: a.cv_path,
          cv_pdf_path: a.cv_pdf_path,
          cl_path: a.cl_path,
          cl_pdf_path: a.cl_pdf_path,
          status: normalizeApplicationStatus(a.status),
          critic_score: a.critic_score,
          critic_verdict: normalizeCriticVerdict(a.critic_verdict),
          critic_notes: a.critic_notes,
          written_at: a.written_at,
          applied_at: a.applied_at,
          applied_via: a.applied_via,
          response: a.response,
          response_at: a.response_at,
          written_by: a.written_by,
          reviewed_by: a.reviewed_by,
          critic_reviewed_at: a.critic_reviewed_at,
          applied: a.applied != null ? Boolean(a.applied) : null,
          cv_drive_id: a.cv_drive_id,
          cl_drive_id: a.cl_drive_id,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    if (payload.length > 0) {
      const { data: upserted, error } = await supabase
        .from('applications')
        .upsert(payload, { onConflict: 'position_id' })
        .select('id')
      if (error) {
        return NextResponse.json(
          { error: `applications upsert: ${error.message}` },
          { status: 500 }
        )
      }
      applicationsUpserted = upserted?.length ?? 0
    }
  }

  const summary = {
    positions: { upserted: positionsUpserted, payload: positions.length },
    scores: { upserted: scoresUpserted, payload: scores.length },
    applications: { upserted: applicationsUpserted, payload: applications.length },
  }

  // Persisti lo stato della sync per la UI "ultimo sync alle X".
  // Errore di scrittura = non-fatale: il sync è già completato lato Supabase.
  try {
    await writeSyncState({
      last_synced_at: new Date().toISOString(),
      last_user_id: userId,
      last_sync_summary: summary,
    })
  } catch (err) {
    console.warn('[sync] writeSyncState failed (non-fatal):', err)
  }

  return NextResponse.json({
    empty: false,
    positions: { upserted: positionsUpserted },
    scores: { upserted: scoresUpserted },
    applications: { upserted: applicationsUpserted },
    payload: {
      positions: positions.length,
      scores: scores.length,
      applications: applications.length,
    },
  })
}
