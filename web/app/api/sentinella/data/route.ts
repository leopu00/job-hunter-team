import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import fs from 'node:fs/promises'
import path from 'node:path'

export const dynamic = 'force-dynamic'

// Legge lo storico scritto dalla Sentinella (Vigil-style) a ogni tick.
// Una riga per check, formato:
//   {"ts":"2026-04-20T16:30:05+02:00","provider":"openai","usage":45,
//    "delta":3,"velocity":60,"velocity_smooth":40,"velocity_ideal":23,
//    "projection":84,"status":"OK","throttle":0,"reset_at":"18:00"}
//
// Fallback: se il file non esiste o è vuoto → [].

type Entry = {
  ts: string
  provider: string
  usage: number
  delta?: number
  velocity?: number
  velocity_smooth?: number
  velocity_ideal?: number
  projection?: number
  status: 'OK' | 'ATTENZIONE' | 'CRITICO' | 'SOTTOUTILIZZO' | 'RESET' | 'ANOMALIA' | string
  throttle?: number
  reset_at?: string
}

function resolveDataFile(): string {
  // La Sentinella scrive in $JHT_HOME/logs/sentinel-data.jsonl.
  // Nel container $JHT_HOME = /jht_home. Nel dev-server fuori dal
  // container leggiamo il bind-mount su ~/.jht (equivalente).
  const jhtHome = process.env.JHT_HOME
    || path.join(process.env.HOME || process.env.USERPROFILE || '', '.jht')
  return path.join(jhtHome, 'logs', 'sentinel-data.jsonl')
}

export async function GET() {
  const authError = await requireAuth()
  if (authError) return authError

  const file = resolveDataFile()
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return NextResponse.json({ ok: true, entries: [], file, note: 'no data yet' })
    }
    return NextResponse.json({ ok: false, error: err?.message ?? 'read error' }, { status: 500 })
  }

  const entries: Entry[] = []
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      entries.push(JSON.parse(trimmed))
    } catch {
      // skip malformed line
    }
  }

  // Mostra solo la sessione corrente: dal piu' recente RESET in poi.
  // Senza questo filtro il grafico trascina sample di sessioni vecchie
  // (anche di giorni fa) comprimendo l'asse x su gap enormi.
  let lastResetIdx = -1
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].status === 'RESET') { lastResetIdx = i; break }
  }
  const sessionEntries = lastResetIdx >= 0 ? entries.slice(lastResetIdx) : entries
  const trimmed = sessionEntries.slice(-500)
  return NextResponse.json({ ok: true, entries: trimmed, file, count: trimmed.length })
}
