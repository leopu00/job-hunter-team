import { NextResponse } from 'next/server'
import { runBash } from '@/lib/shell'

export const dynamic = 'force-dynamic'

const AGENT_MAP: Record<string, { role: string; effort: string }> = {
  ALFA:        { role: 'alfa',       effort: 'high' },
  'SCOUT-1':   { role: 'scout',      effort: 'high' },
  'ANALISTA-1':{ role: 'analista',   effort: 'high' },
  'SCORER-1':  { role: 'scorer',     effort: 'medium' },
  'SCRITTORE-1':{ role: 'scrittore', effort: 'high' },
  CRITICO:     { role: 'critico',    effort: 'high' },
  SENTINELLA:  { role: 'sentinella', effort: 'low' },
}

async function sessionExists(session: string): Promise<boolean> {
  const { stdout } = await runBash(
    `tmux has-session -t "${session}" 2>&1 && echo EXISTS || echo NONE`
  )
  return stdout.trim() === 'EXISTS'
}

export async function GET(_req: Request, { params }: { params: Promise<{ session: string }> }) {
  const { session } = await params
  const active = await sessionExists(session).catch(() => false)
  return NextResponse.json({ session, active })
}

export async function POST(req: Request, { params }: { params: Promise<{ session: string }> }) {
  const { session } = await params
  const body = await req.json().catch(() => ({})) as { action?: string; workspaceDir?: string }
  const action = body.action

  if (action === 'stop') {
    const exists = await sessionExists(session)
    if (!exists) return NextResponse.json({ ok: true, status: 'not_active' })
    await runBash(`tmux kill-session -t "${session}"`)
    return NextResponse.json({ ok: true, status: 'killed' })
  }

  if (action === 'start') {
    const info = AGENT_MAP[session]
    if (!info) return NextResponse.json({ ok: false, error: 'Agente sconosciuto' }, { status: 400 })

    const exists = await sessionExists(session)
    if (exists) return NextResponse.json({ ok: true, status: 'already_active' })

    const dir = body.workspaceDir ?? process.cwd()
    await runBash(`tmux new-session -d -s "${session}" -c "${dir}"`)
    await runBash(
      `tmux send-keys -t "${session}" "claude --dangerously-skip-permissions --effort ${info.effort}" C-m`
    )
    runBash(
      `(sleep 4 && tmux send-keys -t "${session}" Enter && sleep 3 && tmux send-keys -t "${session}" Enter) &>/dev/null &`
    ).catch(() => {})
    return NextResponse.json({ ok: true, status: 'started' })
  }

  return NextResponse.json({ ok: false, error: 'Azione non valida' }, { status: 400 })
}
