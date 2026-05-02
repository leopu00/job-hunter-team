import { stat } from 'node:fs/promises'
import { NextResponse } from 'next/server'
import Database from 'better-sqlite3'
import { getLocalDbPath, loadLocalCloudConfig } from '@/lib/cloud-sync/local'

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

function readTable(db: Database.Database, table: string, columns: string[]): unknown[] {
  try {
    return db.prepare(`SELECT ${columns.join(', ')} FROM ${table}`).all()
  } catch (err) {
    if (err instanceof Error && /no such table/i.test(err.message)) return []
    throw err
  }
}

export async function POST() {
  const config = await loadLocalCloudConfig()
  if (!config) {
    return NextResponse.json(
      { error: 'Cloud sync non abilitato o non in modalità locale' },
      { status: 503 }
    )
  }

  const dbPath = getLocalDbPath()
  try {
    await stat(dbPath)
  } catch {
    return NextResponse.json(
      { error: `Database non trovato: ${dbPath}` },
      { status: 404 }
    )
  }

  let positions: unknown[] = []
  let scores: unknown[] = []
  let applications: unknown[] = []
  let db: Database.Database | null = null
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true })
    positions = readTable(db, 'positions', POSITIONS_COLUMNS)
    scores = readTable(db, 'scores', SCORES_COLUMNS)
    applications = readTable(db, 'applications', APPLICATIONS_COLUMNS)
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

  const pushUrl = `${config.base_url.replace(/\/+$/, '')}/api/cloud-sync/push`
  let res: Response
  try {
    res = await fetch(pushUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ positions, scores, applications }),
    })
  } catch (err) {
    return NextResponse.json(
      { error: `Errore di rete verso ${pushUrl}: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    )
  }

  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    return NextResponse.json(
      { error: body.error || `Push fallito (HTTP ${res.status})` },
      { status: res.status }
    )
  }

  return NextResponse.json({
    empty: false,
    positions: body.positions ?? { upserted: 0 },
    scores: body.scores ?? { upserted: 0 },
    applications: body.applications ?? { upserted: 0 },
    payload: {
      positions: positions.length,
      scores: scores.length,
      applications: applications.length,
    },
  })
}
