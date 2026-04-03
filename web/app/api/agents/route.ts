/**
 * API Route — /api/agents
 *
 * GET  → lista agenti con stato (running/stopped)
 * POST → start o stop di un agente specifico
 */

import { NextRequest, NextResponse } from 'next/server'
import { execSync } from 'child_process'

// Agenti JHT con le relative sessioni tmux
const AGENTS = [
  { id: 'alfa',       name: 'Alfa (Capitano)',  session: 'ALFA' },
  { id: 'scout',      name: 'Scout',            session: 'SCOUT' },
  { id: 'analista',   name: 'Analista',         session: 'ANALISTA' },
  { id: 'scorer',     name: 'Scorer',           session: 'SCORER' },
  { id: 'scrittore',  name: 'Scrittore',        session: 'SCRITTORE' },
  { id: 'critico',    name: 'Critico',          session: 'CRITICO' },
  { id: 'sentinella', name: 'Sentinella',       session: 'SENTINELLA' },
  { id: 'assistente', name: 'Assistente',       session: 'ASSISTENTE' },
]

/** Verifica se una sessione tmux è attiva */
function isSessionRunning(session: string): boolean {
  try {
    execSync(`tmux has-session -t "${session}" 2>/dev/null`, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

export async function GET() {
  const agents = AGENTS.map((agent) => ({
    ...agent,
    status: isSessionRunning(agent.session) ? 'running' : 'stopped',
  }))
  return NextResponse.json({ agents })
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'body non valido' }, { status: 400 })
  }

  const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : ''
  const action = typeof body.action === 'string' ? body.action.trim() : ''

  if (!agentId || !action) {
    return NextResponse.json(
      { error: 'agentId e action obbligatori' },
      { status: 400 }
    )
  }

  if (action !== 'start' && action !== 'stop') {
    return NextResponse.json(
      { error: 'action deve essere "start" o "stop"' },
      { status: 400 }
    )
  }

  // Validazione: solo ID noti (previene injection)
  const agent = AGENTS.find((a) => a.id === agentId)
  if (!agent) {
    return NextResponse.json(
      { error: `Agente sconosciuto: ${agentId}` },
      { status: 404 }
    )
  }

  const running = isSessionRunning(agent.session)

  if (action === 'start' && running) {
    return NextResponse.json({ ok: true, message: 'Agente già attivo', status: 'running' })
  }

  if (action === 'stop' && !running) {
    return NextResponse.json({ ok: true, message: 'Agente già fermo', status: 'stopped' })
  }

  // Stop: invia SIGTERM alla sessione tmux
  if (action === 'stop') {
    try {
      execSync(`tmux send-keys -t "${agent.session}" C-c`, { stdio: 'pipe' })
      return NextResponse.json({ ok: true, message: 'Stop inviato', status: 'stopping' })
    } catch {
      return NextResponse.json(
        { error: 'Errore durante lo stop' },
        { status: 500 }
      )
    }
  }

  // Start: info — il lancio effettivo è gestito dal setup.sh o dal team manager
  return NextResponse.json({
    ok: true,
    message: `Avvio agente ${agent.name} richiesto. Usa "jht team start ${agent.id}" dalla CLI.`,
    status: 'pending',
  })
}
