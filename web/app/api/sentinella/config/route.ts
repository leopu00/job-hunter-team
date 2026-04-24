import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import { requireAuth } from '@/lib/auth'
import { JHT_CONFIG_PATH } from '@/lib/jht-paths'

export const dynamic = 'force-dynamic'

// Limite minimo: 1 min. Massimo: 60 min. Default: 10 min.
// Il bridge (.launcher/sentinel-bridge.py) rilegge sentinella_tick_minutes
// dal config ad ogni tick (risoluzione ~15s tramite sleep_with_poll), quindi
// cambiare questo valore dalla UI ha effetto al tick successivo senza
// bisogno di restart.
const MIN_MINUTES = 1
const MAX_MINUTES = 60
const DEFAULT_MINUTES = 10

type Config = {
  active_provider?: string
  sentinella_tick_minutes?: number
  [key: string]: unknown
}

async function readConfig(): Promise<Config> {
  try {
    const raw = await fs.readFile(JHT_CONFIG_PATH, 'utf8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

async function writeConfig(cfg: Config): Promise<void> {
  await fs.writeFile(JHT_CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
}

export async function GET() {
  const authError = await requireAuth()
  if (authError) return authError
  const cfg = await readConfig()
  const minutes = typeof cfg.sentinella_tick_minutes === 'number'
    ? cfg.sentinella_tick_minutes
    : DEFAULT_MINUTES
  return NextResponse.json({ ok: true, tick_minutes: minutes })
}

export async function POST(req: NextRequest) {
  const authError = await requireAuth()
  if (authError) return authError

  let body: { tick_minutes?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'body non valido' }, { status: 400 }) }

  const n = Number(body.tick_minutes)
  if (!Number.isFinite(n) || n < MIN_MINUTES || n > MAX_MINUTES) {
    return NextResponse.json(
      { ok: false, error: `tick_minutes deve essere un numero tra ${MIN_MINUTES} e ${MAX_MINUTES}` },
      { status: 400 },
    )
  }

  const cfg = await readConfig()
  cfg.sentinella_tick_minutes = Math.round(n)
  await writeConfig(cfg)
  return NextResponse.json({ ok: true, tick_minutes: cfg.sentinella_tick_minutes })
}
