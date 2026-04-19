import { NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execSync } from 'node:child_process'
import { JHT_HOME } from '@/lib/jht-paths'

export const dynamic = 'force-dynamic'

const IS_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.VERCEL_ENV)
const JHT_DIR = JHT_HOME
const startedAt = Date.now()

type Status = 'ok' | 'warn' | 'error'
type ModuleCheck = { id: string; label: string; status: Status; detail: string }

function fileExists(p: string): boolean { try { fs.accessSync(p); return true } catch { return false } }

function checkConfig(): ModuleCheck {
  const p = path.join(JHT_DIR, 'jht.config.json')
  if (!fileExists(p)) return { id: 'config', label: 'Configurazione', status: 'error', detail: 'jht.config.json non trovato' }
  try { JSON.parse(fs.readFileSync(p, 'utf-8')); return { id: 'config', label: 'Configurazione', status: 'ok', detail: 'Config valida' } }
  catch { return { id: 'config', label: 'Configurazione', status: 'error', detail: 'JSON non valido' } }
}

function checkSessions(): ModuleCheck {
  const p = path.join(JHT_DIR, 'sessions', 'sessions.json')
  if (!fileExists(p)) return { id: 'sessions', label: 'Sessioni', status: 'warn', detail: 'Nessun file sessioni' }
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'))
    const active = data.sessions?.filter((s: any) => s.state === 'active').length ?? 0
    return { id: 'sessions', label: 'Sessioni', status: 'ok', detail: `${data.sessions?.length ?? 0} sessioni, ${active} attive` }
  } catch { return { id: 'sessions', label: 'Sessioni', status: 'error', detail: 'File corrotto' } }
}

function checkAnalytics(): ModuleCheck {
  const p = path.join(JHT_DIR, 'analytics', 'analytics.json')
  if (!fileExists(p)) return { id: 'analytics', label: 'Analytics', status: 'warn', detail: 'Nessun dato analytics' }
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'))
    return { id: 'analytics', label: 'Analytics', status: 'ok', detail: `${data.entries?.length ?? 0} entry registrate` }
  } catch { return { id: 'analytics', label: 'Analytics', status: 'error', detail: 'File corrotto' } }
}

function checkCredentials(): ModuleCheck {
  const credsDir = path.join(JHT_DIR, 'credentials')
  if (!fileExists(credsDir)) return { id: 'credentials', label: 'Credenziali', status: 'warn', detail: 'Nessuna credenziale salvata' }
  try {
    const files = fs.readdirSync(credsDir).filter(f => f.endsWith('.json'))
    return { id: 'credentials', label: 'Credenziali', status: files.length > 0 ? 'ok' : 'warn', detail: `${files.length} provider configurati` }
  } catch { return { id: 'credentials', label: 'Credenziali', status: 'error', detail: 'Errore lettura directory' } }
}

function checkPlugins(): ModuleCheck {
  const pluginsDir = path.join(JHT_DIR, 'plugins')
  if (!fileExists(pluginsDir)) return { id: 'plugins', label: 'Plugin', status: 'warn', detail: 'Directory plugin assente' }
  try {
    const dirs = fs.readdirSync(pluginsDir).filter(d => { try { return fs.statSync(path.join(pluginsDir, d)).isDirectory() } catch { return false } })
    return { id: 'plugins', label: 'Plugin', status: 'ok', detail: `${dirs.length} plugin trovati` }
  } catch { return { id: 'plugins', label: 'Plugin', status: 'error', detail: 'Errore lettura directory' } }
}

function checkMemory(): ModuleCheck {
  const files = ['SOUL.md', 'IDENTITY.md', 'MEMORY.md']
  const found = files.filter(f => fileExists(path.join(JHT_DIR, f)))
  if (found.length === 0) return { id: 'memory', label: 'Memory', status: 'warn', detail: 'Nessun file bootstrap' }
  return { id: 'memory', label: 'Memory', status: found.length >= 2 ? 'ok' : 'warn', detail: `${found.length}/${files.length} file presenti` }
}

function checkAgents(): ModuleCheck {
  const sessions = ['CAPITANO', 'SCOUT-1', 'ANALISTA-1', 'SCORER-1', 'SCRITTORE-1', 'CRITICO', 'SENTINELLA', 'ASSISTENTE']
  let running = 0
  for (const s of sessions) { try { execSync(`tmux has-session -t "${s}" 2>/dev/null`, { stdio: 'pipe' }); running++ } catch { /* not running */ } }
  const status: Status = running === 0 ? 'warn' : running >= 3 ? 'ok' : 'warn'
  return { id: 'agents', label: 'Agenti', status, detail: `${running}/${sessions.length} attivi` }
}

function getVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'))
    return pkg.version ?? '0.0.0'
  } catch { return '0.0.0' }
}

/** GET — health check globale */
export async function GET() {
  // Su Vercel serverless non c'e' filesystem locale ne' tmux
  if (IS_SERVERLESS) {
    return NextResponse.json({
      status: 'ok' as Status,
      version: getVersion(),
      uptime: Date.now() - startedAt,
      timestamp: Date.now(),
      env: 'serverless',
      modules: [
        { id: 'runtime', label: 'Runtime', status: 'ok', detail: 'Vercel serverless' },
      ],
      counts: { ok: 1, warn: 0, error: 0 },
    })
  }

  const modules = [checkConfig(), checkSessions(), checkAnalytics(), checkCredentials(), checkPlugins(), checkMemory(), checkAgents()]
  const errors = modules.filter(m => m.status === 'error').length
  const warns = modules.filter(m => m.status === 'warn').length
  const overall: Status = errors > 0 ? 'error' : warns > 2 ? 'warn' : 'ok'

  return NextResponse.json({
    status: overall, version: getVersion(),
    uptime: Date.now() - startedAt,
    timestamp: Date.now(),
    env: 'local',
    modules,
    counts: { ok: modules.filter(m => m.status === 'ok').length, warn: warns, error: errors },
  })
}
