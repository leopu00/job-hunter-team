import { NextResponse } from 'next/server'
import fs from 'fs'
import { initDb } from '@/lib/db'
import {
  JHT_DB_PATH,
  JHT_HOME,
  JHT_PROFILE_DIR,
  JHT_USER_DIR,
  JHT_USER_CV_DIR,
  JHT_USER_UPLOADS_DIR,
  JHT_USER_OUTPUT_DIR,
} from '@/lib/jht-paths'

export const dynamic = 'force-dynamic'

export async function POST() {
  const created = { home: false, userDir: false, db: false }

  try {
    if (!fs.existsSync(JHT_HOME)) created.home = true
    fs.mkdirSync(JHT_HOME, { recursive: true })
    fs.mkdirSync(JHT_PROFILE_DIR, { recursive: true })

    if (!fs.existsSync(JHT_USER_DIR)) created.userDir = true
    fs.mkdirSync(JHT_USER_DIR, { recursive: true })
    fs.mkdirSync(JHT_USER_CV_DIR, { recursive: true })
    fs.mkdirSync(JHT_USER_UPLOADS_DIR, { recursive: true })
    fs.mkdirSync(JHT_USER_OUTPUT_DIR, { recursive: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Impossibile creare le cartelle JHT'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  if (!fs.existsSync(JHT_DB_PATH)) {
    try {
      initDb()
      created.db = true
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Errore creazione DB'
      return NextResponse.json({ error: msg }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true, created })
}
