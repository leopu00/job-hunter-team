import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { initDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const wsPath = body.path as string | undefined

  if (!wsPath) {
    return NextResponse.json({ error: 'path richiesto' }, { status: 400 })
  }

  // Crea la directory se non esiste
  try {
    fs.mkdirSync(wsPath, { recursive: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Impossibile creare la directory'
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  const created = { db: false, profile: false }

  // Inizializza il database se non esiste
  const dbPath = path.join(wsPath, 'jobs.db')
  if (!fs.existsSync(dbPath)) {
    try {
      initDb(wsPath)
      created.db = true
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Errore creazione DB'
      return NextResponse.json({ error: msg }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true, created })
}
