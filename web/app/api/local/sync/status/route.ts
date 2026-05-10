import { NextResponse } from 'next/server'
import Database from 'better-sqlite3'
import { createClient } from '@/lib/supabase/server'
import { getLocalDbPath, localDbExists } from '@/lib/cloud-sync/local'
import { readSyncState } from '@/lib/cloud-sync/state'

export const dynamic = 'force-dynamic'

interface Counts {
  positions: number
  scores: number
  applications: number
}

function readLocalCounts(): Counts {
  const counts: Counts = { positions: 0, scores: 0, applications: 0 }
  let db: Database.Database | null = null
  try {
    db = new Database(getLocalDbPath(), { readonly: true, fileMustExist: true })
    for (const t of ['positions', 'scores', 'applications'] as const) {
      try {
        const row = db.prepare(`SELECT count(*) AS c FROM ${t}`).get() as { c: number } | undefined
        counts[t] = row?.c ?? 0
      } catch {
        // tabella mancante: lascia 0
      }
    }
  } finally {
    db?.close()
  }
  return counts
}

export async function GET() {
  const local = await localDbExists()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const state = await readSyncState()
  // Se l'ultimo sync era di un altro utente sullo stesso desktop,
  // mostra come "mai sincronizzato" per l'utente corrente.
  const stateForCurrentUser = state && user && state.last_user_id === user.id ? state : null

  const localCounts: Counts = local ? readLocalCounts() : { positions: 0, scores: 0, applications: 0 }

  let cloudCounts: Counts = { positions: 0, scores: 0, applications: 0 }
  if (user) {
    const tables = ['positions', 'scores', 'applications'] as const
    const results = await Promise.all(
      tables.map((t) =>
        supabase.from(t).select('id', { count: 'exact', head: true }).eq('user_id', user.id)
      )
    )
    cloudCounts = {
      positions: results[0].count ?? 0,
      scores: results[1].count ?? 0,
      applications: results[2].count ?? 0,
    }
  }

  const inSync =
    !!stateForCurrentUser &&
    localCounts.positions === cloudCounts.positions &&
    localCounts.scores === cloudCounts.scores &&
    localCounts.applications === cloudCounts.applications

  return NextResponse.json({
    local,
    logged_in: !!user,
    user_id: user?.id ?? null,
    last_sync: stateForCurrentUser
      ? {
          at: stateForCurrentUser.last_synced_at,
          summary: stateForCurrentUser.last_sync_summary,
        }
      : null,
    local_counts: localCounts,
    cloud_counts: cloudCounts,
    in_sync: inSync,
  })
}
