import { NextResponse } from 'next/server'
import { runScript } from '@/lib/shell'

export const dynamic = 'force-dynamic'

// POST /api/bridge/start — avvia sentinel-bridge.py.
export async function POST() {
  try {
    await runScript('/app/.launcher/bridge-control.sh', 'start')
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    return NextResponse.json(
      { ok: false, error: (err as Error)?.message ?? 'bridge start fallito' },
      { status: 500 },
    )
  }
}
