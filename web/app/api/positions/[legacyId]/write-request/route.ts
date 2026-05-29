import { NextRequest, NextResponse } from 'next/server'
import Database from 'better-sqlite3'
import fs from 'fs'
import { resolveUser } from '@/lib/team-state/auth'
import { JHT_DB_PATH } from '@/lib/jht-paths'

export const dynamic = 'force-dynamic'

// Writer-on-demand: l'utente "richiede" il CV per una posizione cliccando
// il pulsante "Scrivi CV" sul dashboard (o `/cv <id>` su Telegram, vedi
// telegram-bridge). Setta `positions.write_requested = 1` sul SQLite locale
// in modo che il Capitano (che monitora il flag) spawni uno Scrittore.
//
// Scrittura double-target:
//   - SQLite locale (source of truth per il Capitano, propagato a cloud
//     dal push delta-only daemon di cli/src/commands/cloud.js)
//   - Supabase (best-effort, per UI cross-device immediato). Se Supabase
//     fallisce non blocchiamo: SQLite e' gia' aggiornato e il push daemon
//     recupera la coerenza alla prossima cadenza.
//
// Vedi BACKLOG [JHT-WRITER-ON-DEMAND] (2026-05-29) e migration V6 in
// `shared/skills/_db.py::_migrate_positions_write_requested`.

interface PositionRow {
  id: number
  title: string
  company: string
  status: string | null
  score: number | null
  write_requested: number
  write_requested_at: string | null
  has_application: number
}

async function handleToggle(
  req: NextRequest,
  legacyIdParam: string,
  requested: boolean,
): Promise<NextResponse> {
  const resolved = await resolveUser(req)
  if (!resolved.ok) return resolved.res
  if (resolved.user.source !== 'session') {
    return NextResponse.json(
      { error: 'Solo il browser puo\' richiedere CV (no Bearer token)' },
      { status: 403 },
    )
  }
  const { userId, supabase } = resolved.user

  const legacyId = Number.parseInt(legacyIdParam, 10)
  if (!Number.isInteger(legacyId) || legacyId <= 0) {
    return NextResponse.json({ error: 'legacyId non valido' }, { status: 400 })
  }

  if (!fs.existsSync(JHT_DB_PATH)) {
    return NextResponse.json(
      { error: `Database locale non trovato: ${JHT_DB_PATH}` },
      { status: 500 },
    )
  }

  // Connessione write dedicata (la getDb cached e' readonly). WAL mode +
  // foreign_keys per coerenza con il resto della pipeline.
  const db = new Database(JHT_DB_PATH)
  try {
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')

    const row = db
      .prepare<[number], PositionRow>(`
        SELECT
          p.id, p.title, p.company, p.status,
          s.total_score AS score,
          p.write_requested,
          p.write_requested_at,
          CASE WHEN a.id IS NULL THEN 0 ELSE 1 END AS has_application
        FROM positions p
        LEFT JOIN scores s ON s.position_id = p.id
        LEFT JOIN applications a ON a.position_id = p.id
        WHERE p.id = ?
      `)
      .get(legacyId)

    if (!row) {
      return NextResponse.json(
        { error: `Posizione #${legacyId} non trovata` },
        { status: 404 },
      )
    }

    if (requested) {
      // Guard: solo posizioni scored e senza application possono ricevere
      // una richiesta CV. Le altre sono o premature (no score) o gia'
      // gestite (writing/ready/applied).
      if (row.status !== 'scored') {
        return NextResponse.json(
          {
            error: `Posizione in stato '${row.status}': richiesta CV ammessa solo per 'scored'`,
            position: { id: row.id, status: row.status },
          },
          { status: 409 },
        )
      }
      if (row.has_application === 1) {
        return NextResponse.json(
          {
            error: `Application gia' esistente per posizione #${legacyId}`,
            position: { id: row.id, status: row.status },
          },
          { status: 409 },
        )
      }
    }

    // UPDATE atomico — il trigger positions_touch_updated_at aggiorna
    // updated_at e quindi il push delta-only lo rilevera' alla prossima
    // cadenza (vedi cli/src/commands/cloud.js readSqliteTableDelta).
    db.prepare(`
      UPDATE positions
         SET write_requested = ?,
             write_requested_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END
       WHERE id = ?
    `).run(requested ? 1 : 0, requested ? 1 : 0, legacyId)

    const updated = db
      .prepare<[number], PositionRow>(`
        SELECT
          p.id, p.title, p.company, p.status,
          s.total_score AS score,
          p.write_requested,
          p.write_requested_at,
          CASE WHEN a.id IS NULL THEN 0 ELSE 1 END AS has_application
        FROM positions p
        LEFT JOIN scores s ON s.position_id = p.id
        LEFT JOIN applications a ON a.position_id = p.id
        WHERE p.id = ?
      `)
      .get(legacyId)!

    // Best-effort cloud write (Supabase). Se fallisce, SQLite e' gia'
    // aggiornato — il push daemon recupera la coerenza alla prossima
    // cadenza. Niente rollback: il single source of truth per il Capitano
    // e' SQLite locale.
    let cloudWriteOk: boolean | null = null
    try {
      const { error } = await supabase
        .from('positions')
        .update({
          write_requested: requested,
          write_requested_at: requested ? new Date().toISOString() : null,
        })
        .eq('user_id', userId)
        .eq('legacy_id', legacyId)
      cloudWriteOk = !error
    } catch {
      cloudWriteOk = false
    }

    return NextResponse.json({
      position: {
        id: String(updated.id),
        title: updated.title,
        company: updated.company,
        status: updated.status,
        score: updated.score,
        write_requested: updated.write_requested === 1,
        write_requested_at: updated.write_requested_at,
      },
      cloud_synced: cloudWriteOk,
    })
  } finally {
    db.close()
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ legacyId: string }> },
) {
  const { legacyId } = await params
  return handleToggle(req, legacyId, true)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ legacyId: string }> },
) {
  const { legacyId } = await params
  return handleToggle(req, legacyId, false)
}
