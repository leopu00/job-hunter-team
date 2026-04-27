import { NextResponse } from 'next/server'
import { runScript } from '@/lib/shell'

export const dynamic = 'force-dynamic'

// POST /api/bridge/stop — uccide sentinel-bridge.py + rimuove pidfile.
export async function POST() {
  try {
    await runScript('/app/.launcher/bridge-control.sh', 'stop')
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    return NextResponse.json(
      { ok: false, error: (err as Error)?.message ?? 'bridge stop fallito' },
      { status: 500 },
    )
  }
}
