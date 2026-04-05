import { NextResponse } from 'next/server'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

export const dynamic = 'force-dynamic'

const TASKS_DIR = path.join(os.homedir(), '.jht-dev', 'tasks')

const TEAM = [
  { id: 'ace',    name: 'Ace',    role: 'Coordinatore', sessions: ['JHT-COORD', 'JHT-COORD-2'] },
  { id: 'dot',    name: 'Dot',    role: 'Frontend',     sessions: ['JHT-FRONTEND', 'JHT-FRONTEND-2', 'JHT-FRONTEND-3', 'JHT-FRONTEND-4'] },
  { id: 'leo',    name: 'Leo',    role: 'Backend/CLI',  sessions: ['JHT-BACKEND-3'] },
  { id: 'gus',    name: 'Gus',    role: 'Test',         sessions: ['JHT-BACKEND-2'] },
  { id: 'rex',    name: 'Rex',    role: 'Web Pages',    sessions: ['JHT-BACKEND-4', 'JHT-FULLSTACK', 'JHT-FULLSTACK-2', 'JHT-FULLSTACK-3'] },
  { id: 'pip',    name: 'Pip',    role: 'UI Polish',    sessions: ['JHT-FRONTEND-2', 'JHT-FRONTEND-3', 'JHT-FRONTEND-4'] },
  { id: 'dan',    name: 'Dan',    role: 'E2E',          sessions: ['JHT-E2E', 'JHT-E2E-2'] },
  { id: 'master', name: 'Master', role: 'Gatekeeper',   sessions: ['JHT-GATEKEEPER', 'JHT-GATEKEEPER-2', 'JHT-GATEKEEPER-3'] },
]

function isRunning(sessions: string[]): boolean {
  return sessions.some(s => {
    try { execSync(`tmux has-session -t "${s}" 2>/dev/null`, { stdio: 'pipe' }); return true }
    catch { return false }
  })
}

function getLastTask(name: string): { id: string; stato: string } | null {
  if (!fs.existsSync(TASKS_DIR)) return null
  try {
    const files = fs.readdirSync(TASKS_DIR)
      .filter(f => f.endsWith('.md') && f !== '_template.md')
      .sort((a, b) => b.localeCompare(a))
    for (const file of files.slice(0, 150)) {
      const content = fs.readFileSync(path.join(TASKS_DIR, file), 'utf-8')
      const lines = content.split('\n')
      const assignLine = lines.find(l => l.startsWith('assegnato_a:'))
      if (!assignLine?.toLowerCase().includes(name.toLowerCase())) continue
      const id    = lines.find(l => l.startsWith('id:'))?.replace('id:', '').trim() ?? file.replace('.md', '')
      const stato = lines.find(l => l.startsWith('stato:'))?.replace('stato:', '').trim() ?? 'unknown'
      return { id, stato }
    }
  } catch { /* ignore */ }
  return null
}

export async function GET() {
  const team = TEAM.map(m => ({
    id:        m.id,
    name:      m.name,
    role:      m.role,
    session:   m.sessions[0],
    online:    isRunning(m.sessions),
    last_task: getLastTask(m.name),
  }))
  return NextResponse.json({ team })
}
