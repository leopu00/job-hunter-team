import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { JHT_HOME } from '@/lib/jht-paths'

export const dynamic = 'force-dynamic'

const JHT_DIR = JHT_HOME
const TOOLS_CONFIG_PATH = path.join(JHT_DIR, 'tools-config.json')
const TOOLS_LOG_PATH = path.join(JHT_DIR, 'tools', 'executions.jsonl')

type ToolProfileId = 'minimal' | 'coding' | 'full'

type ToolDef = {
  id: string; label: string; description: string
  sectionId: string; profiles: ToolProfileId[]
}

type ToolExec = { ts: number; toolId: string; status: 'ok' | 'error'; durationMs: number; error?: string }

type ToolsConfig = { disabled: string[] }

const CORE_TOOLS: ToolDef[] = [
  { id: 'read', label: 'Read', description: 'Lettura file dal filesystem', sectionId: 'fs', profiles: ['coding', 'full'] },
  { id: 'write', label: 'Write', description: 'Scrittura file sul filesystem', sectionId: 'fs', profiles: ['coding', 'full'] },
  { id: 'edit', label: 'Edit', description: 'Modifica parziale file esistenti', sectionId: 'fs', profiles: ['coding', 'full'] },
  { id: 'exec', label: 'Exec', description: 'Esecuzione comandi bash', sectionId: 'runtime', profiles: ['coding', 'full'] },
  { id: 'process', label: 'Process', description: 'Gestione processi in background', sectionId: 'runtime', profiles: ['coding', 'full'] },
  { id: 'web_search', label: 'Web Search', description: 'Ricerca sul web', sectionId: 'web', profiles: ['coding', 'full'] },
  { id: 'web_fetch', label: 'Web Fetch', description: 'Fetch di URL', sectionId: 'web', profiles: ['coding', 'full'] },
  { id: 'memory_search', label: 'Memory Search', description: 'Ricerca nella memoria agente', sectionId: 'memory', profiles: ['coding', 'full'] },
  { id: 'sessions_list', label: 'Sessions', description: 'Lista sessioni attive', sectionId: 'sessions', profiles: ['coding', 'full'] },
  { id: 'cron', label: 'Cron', description: 'Automazione task periodici', sectionId: 'automation', profiles: ['coding', 'full'] },
]

const SECTIONS = [
  { id: 'fs', label: 'Filesystem' }, { id: 'runtime', label: 'Runtime' },
  { id: 'web', label: 'Web' }, { id: 'memory', label: 'Memory' },
  { id: 'sessions', label: 'Sessioni' }, { id: 'automation', label: 'Automazione' },
]

function loadConfig(): ToolsConfig {
  try { const raw = JSON.parse(fs.readFileSync(TOOLS_CONFIG_PATH, 'utf-8')); return { disabled: Array.isArray(raw.disabled) ? raw.disabled : [] } }
  catch { return { disabled: [] } }
}

function saveConfig(config: ToolsConfig) {
  fs.mkdirSync(path.dirname(TOOLS_CONFIG_PATH), { recursive: true })
  fs.writeFileSync(TOOLS_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
}

function loadRecentExecs(tail: number): ToolExec[] {
  try {
    const lines = fs.readFileSync(TOOLS_LOG_PATH, 'utf-8').trim().split('\n').slice(-tail)
    return lines.map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

/** GET — lista tool con stato e log esecuzioni recenti */
export async function GET(req: NextRequest) {
  const config = loadConfig()
  const tail = parseInt(req.nextUrl.searchParams.get('logs') ?? '50', 10) || 50
  const tools = CORE_TOOLS.map(t => ({
    ...t, enabled: !config.disabled.includes(t.id),
  }))
  const execs = loadRecentExecs(Math.min(tail, 200))
  const sections = SECTIONS.map(s => ({
    ...s, tools: tools.filter(t => t.sectionId === s.id),
  })).filter(s => s.tools.length > 0)

  return NextResponse.json({
    tools, sections, executions: execs,
    total: tools.length, enabled: tools.filter(t => t.enabled).length,
    execCount: execs.length,
  })
}

/** POST — toggle tool: { id: string, enabled: boolean } */
export async function POST(req: NextRequest) {
  let body: { id?: string; enabled?: boolean } = {}
  try { body = await req.json() } catch { /* ignore */ }
  if (!body.id || typeof body.enabled !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'id e enabled obbligatori' }, { status: 400 })
  }
  if (!CORE_TOOLS.find(t => t.id === body.id)) {
    return NextResponse.json({ ok: false, error: 'Tool non trovato' }, { status: 404 })
  }
  const config = loadConfig()
  if (body.enabled) {
    config.disabled = config.disabled.filter(id => id !== body.id)
  } else {
    if (!config.disabled.includes(body.id!)) config.disabled.push(body.id!)
  }
  saveConfig(config)
  return NextResponse.json({ ok: true, id: body.id, enabled: body.enabled })
}
