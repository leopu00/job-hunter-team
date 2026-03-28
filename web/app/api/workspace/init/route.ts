import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { initDb } from '@/lib/db'

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

  // Copia template profilo se non esiste
  const profilePath = path.join(wsPath, 'candidate_profile.yml')
  if (!fs.existsSync(profilePath)) {
    const templatePath = path.resolve(process.cwd(), '..', 'candidate_profile.yml.example')
    if (fs.existsSync(templatePath)) {
      fs.copyFileSync(templatePath, profilePath)
      created.profile = true
    }
  }

  return NextResponse.json({ ok: true, created })
}
