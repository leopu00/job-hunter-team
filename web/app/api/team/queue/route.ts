import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

export const dynamic = 'force-dynamic'

// Stato della "deviazione messaggi" durante throttle attivo (Soluzione 3).
// Per ogni agente con throttle attivo o coda non vuota, ritorna:
//   - queued: numero di righe in $JHT_HOME/queue/<agent>.jsonl
//   - throttleUntil: ISO timestamp del fine pausa, da
//     $JHT_HOME/state/throttle-<agent>.json (campo `until`, unix sec)
// L'UI usa questa info per fermare i pallini in transito sul nodo
// destinatario finché il throttle non scade.

const JHT_HOME = process.env.JHT_HOME || path.join(os.homedir(), '.jht')
const QUEUE_DIR = path.join(JHT_HOME, 'queue')
const STATE_DIR = path.join(JHT_HOME, 'state')

type AgentQueue = {
  agent: string
  queued: number
  throttleUntil: string | null
}

async function countLines(filePath: string): Promise<number> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return raw.split('\n').filter(Boolean).length
  } catch {
    return 0
  }
}

async function readUntil(agent: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(STATE_DIR, `throttle-${agent}.json`), 'utf-8')
    const obj = JSON.parse(raw) as { until?: number }
    if (typeof obj.until !== 'number') return null
    if (obj.until * 1000 <= Date.now()) return null
    return new Date(obj.until * 1000).toISOString()
  } catch {
    return null
  }
}

export async function GET() {
  // Set di agenti da indagare: chiunque abbia un file in queue/ OPPURE
  // uno state file di throttle attivo. L'union evita di perdere agenti
  // throttled senza coda (caso normale appena partito) o con coda
  // residua post-fail.
  const agents = new Set<string>()
  try {
    for (const f of await fs.readdir(QUEUE_DIR)) {
      // accetto solo i file "vivi", non .processing né .orphan-*
      if (f.endsWith('.jsonl')) agents.add(f.slice(0, -'.jsonl'.length))
    }
  } catch { /* dir mancante: ok */ }
  try {
    for (const f of await fs.readdir(STATE_DIR)) {
      if (f.startsWith('throttle-') && f.endsWith('.json')) {
        agents.add(f.slice('throttle-'.length, -'.json'.length))
      }
    }
  } catch { /* idem */ }

  const out: AgentQueue[] = []
  for (const agent of agents) {
    const [queued, throttleUntil] = await Promise.all([
      countLines(path.join(QUEUE_DIR, `${agent}.jsonl`)),
      readUntil(agent),
    ])
    if (queued === 0 && throttleUntil === null) continue
    out.push({ agent, queued, throttleUntil })
  }

  return NextResponse.json({ agents: out, ts: new Date().toISOString() })
}
