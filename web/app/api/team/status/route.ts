import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// Job Hunter agent definitions (session prefix → display info)
const JH_AGENTS: Record<string, { role: string; emoji: string; color: string; maxInstances: number }> = {
  ALFA:       { role: 'Capitano',  emoji: '👨‍✈️', color: '#ff9100', maxInstances: 1 },
  SCOUT:      { role: 'Scout',     emoji: '🕵️',  color: '#2196f3', maxInstances: 3 },
  ANALISTA:   { role: 'Analista',  emoji: '🔬',  color: '#00e676', maxInstances: 2 },
  SCORER:     { role: 'Scorer',    emoji: '📊',  color: '#b388ff', maxInstances: 3 },
  SCRITTORE:  { role: 'Scrittore', emoji: '✍️',  color: '#ffd600', maxInstances: 3 },
  CRITICO:    { role: 'Critico',   emoji: '⚖️',  color: '#f44336', maxInstances: 1 },
  SENTINELLA: { role: 'Sentinella', emoji: '🛡️', color: '#607d8b', maxInstances: 1 },
}

function getAgentInfo(session: string) {
  const s = session.toUpperCase()
  for (const [prefix, info] of Object.entries(JH_AGENTS)) {
    if (s === prefix || s.startsWith(`${prefix}-`)) {
      return { ...info, session }
    }
  }
  return null
}

export async function GET() {
  try {
    const { stdout } = await execAsync('tmux list-sessions -F "#{session_name}" 2>/dev/null || echo ""')
    const sessions = stdout.trim().split('\n').filter(Boolean)

    const agents = sessions
      .map(s => getAgentInfo(s))
      .filter(Boolean)
      .map(a => ({ ...a, active: true }))

    return NextResponse.json({ agents, isLocalhost: true })
  } catch {
    return NextResponse.json({ agents: [], isLocalhost: false })
  }
}
