import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getWorkspacePath } from '@/lib/workspace'
import { isLocalRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// Per ogni agente, restituisce il timestamp UTC dell'ultima scrittura
// che gli è attribuibile guardando direttamente le tabelle del DB (zero
// modifiche alle skill). La pagina /team/v2 polla questo endpoint e
// quando un timestamp avanza anima il pallino dall'agente al nodo DB.
//
//   scout    → MAX(positions.found_at)
//   scorer   → MAX(scores.scored_at)
//   analista → MAX(positions.last_checked)
//
// scrittore e critico mancano perché lo schema attuale non ha un
// timestamp dedicato (entrambi cambiano `positions.status` ma senza
// aggiornare un campo datetime per ruolo).

type Row = { ts: string | null }

function toUtcIso(s: string | null | undefined): string | null {
  if (typeof s !== 'string' || s.length < 10) return null
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return s
  return s.replace(' ', 'T') + 'Z'
}

export async function GET() {
  const denied = await requireAuth()
  if (denied) return denied

  if (!(await isLocalRequest())) {
    return NextResponse.json({ writes: {} })
  }
  const ws = getWorkspacePath()
  if (!ws) return NextResponse.json({ writes: {} })

  const db = getDb(ws)
  const writes: Record<string, string | null> = {}

  try {
    const r = db.prepare('SELECT MAX(found_at) AS ts FROM positions').get() as Row
    writes.scout = toUtcIso(r?.ts)
  } catch { writes.scout = null }

  try {
    const r = db.prepare('SELECT MAX(scored_at) AS ts FROM scores').get() as Row
    writes.scorer = toUtcIso(r?.ts)
  } catch { writes.scorer = null }

  try {
    const r = db.prepare('SELECT MAX(last_checked) AS ts FROM positions').get() as Row
    writes.analista = toUtcIso(r?.ts)
  } catch { writes.analista = null }

  return NextResponse.json({ writes })
}
