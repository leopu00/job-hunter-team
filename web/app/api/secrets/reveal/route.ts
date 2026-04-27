import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { JHT_HOME } from '@/lib/jht-paths'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const SECRETS_PATH = path.join(JHT_HOME, 'secrets.json')

/**
 * POST /api/secrets/reveal — restituisce il valore in chiaro di un secret.
 *
 * Endpoint separato dal GET di lista per evitare il pattern "enumera +
 * reveal" sullo stesso URL (finding H1). Body richiesto: `{ id, confirm:
 * true }`. Senza `confirm:true` la richiesta viene rifiutata: e' un
 * doppio click esplicito dell'utente, non un effetto collaterale di una
 * GET ad un URL conoscibile.
 */
export async function POST(req: NextRequest) {
  const denied = await requireAuth()
  if (denied) return denied

  let body: { id?: string; confirm?: boolean } = {}
  try { body = await req.json() } catch { /* ignore */ }

  if (!body.id) {
    return NextResponse.json({ ok: false, error: 'id obbligatorio' }, { status: 400 })
  }
  if (body.confirm !== true) {
    return NextResponse.json({ ok: false, error: 'confirm:true obbligatorio' }, { status: 400 })
  }

  let raw: string
  try { raw = fs.readFileSync(SECRETS_PATH, 'utf-8') }
  catch (e: any) {
    if (e.code === 'ENOENT') return NextResponse.json({ ok: false, error: 'nessun secret salvato' }, { status: 404 })
    throw e
  }

  const store = JSON.parse(raw) as { secrets?: Array<{ id: string; value: string }> }
  const secret = store.secrets?.find(s => s.id === body.id)
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'secret non trovato' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, value: secret.value })
}
