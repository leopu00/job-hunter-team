import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

export const dynamic = 'force-dynamic'

const JHT_DIR = path.join(os.homedir(), '.jht')

type SearchResult = { type: string; id: string; title: string; detail: string; href: string }

function readJsonSafe<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return null }
}

function searchAgents(q: string): SearchResult[] {
  const agents = [
    { id: 'alfa', name: 'Alfa (Capitano)' }, { id: 'scout', name: 'Scout' },
    { id: 'analista', name: 'Analista' }, { id: 'scorer', name: 'Scorer' },
    { id: 'scrittore', name: 'Scrittore' }, { id: 'critico', name: 'Critico' },
    { id: 'sentinella', name: 'Sentinella' }, { id: 'assistente', name: 'Assistente' },
  ]
  return agents
    .filter(a => a.name.toLowerCase().includes(q) || a.id.includes(q))
    .map(a => ({ type: 'agent', id: a.id, title: a.name, detail: `Agente ${a.id}`, href: `/agents/${a.id}` }))
}

function searchSessions(q: string): SearchResult[] {
  const store = readJsonSafe<{ sessions?: any[] }>(path.join(JHT_DIR, 'sessions', 'sessions.json'))
  if (!store?.sessions) return []
  return store.sessions
    .filter((s: any) => (s.label ?? '').toLowerCase().includes(q) || s.id.includes(q) || (s.channelId ?? '').includes(q))
    .slice(0, 10)
    .map((s: any) => ({ type: 'session', id: s.id, title: s.label ?? s.id.slice(0, 12), detail: `${s.state} · ${s.channelId} · ${s.messageCount} msg`, href: `/sessions/${s.id}` }))
}

function searchTasks(q: string): SearchResult[] {
  const store = readJsonSafe<{ entries?: any[] }>(path.join(JHT_DIR, 'tasks', 'tasks.json'))
  if (!store?.entries) return []
  return store.entries
    .filter((t: any) => (t.name ?? '').toLowerCase().includes(q) || (t.id ?? '').includes(q))
    .slice(0, 10)
    .map((t: any) => ({ type: 'task', id: t.id, title: t.name ?? t.id, detail: `${t.status} · ${t.agentId ?? 'no agent'}`, href: `/tasks` }))
}

function searchPlugins(q: string): SearchResult[] {
  const pluginsDir = path.join(JHT_DIR, 'plugins')
  if (!fs.existsSync(pluginsDir)) return []
  const results: SearchResult[] = []
  try {
    for (const entry of fs.readdirSync(pluginsDir)) {
      const manifestPath = path.join(pluginsDir, entry, 'jht.plugin.json')
      const manifest = readJsonSafe<{ id: string; name: string; description?: string }>(manifestPath)
      if (!manifest) continue
      if (manifest.name.toLowerCase().includes(q) || manifest.id.includes(q) || (manifest.description ?? '').toLowerCase().includes(q)) {
        results.push({ type: 'plugin', id: manifest.id, title: manifest.name, detail: manifest.description ?? manifest.id, href: '/plugins' })
      }
    }
  } catch { /* ignore */ }
  return results.slice(0, 10)
}

function searchPages(q: string): SearchResult[] {
  const pages = [
    { title: 'Dashboard', href: '/dashboard', detail: 'Pipeline posizioni' },
    { title: 'Overview', href: '/overview', detail: 'Panoramica sistema' },
    { title: 'Analytics', href: '/analytics', detail: 'Metriche API e costi' },
    { title: 'Credenziali', href: '/credentials', detail: 'API key e OAuth' },
    { title: 'Plugin', href: '/plugins', detail: 'Gestione plugin' },
    { title: 'Memory', href: '/memory', detail: 'Soul, Identity, Memory' },
    { title: 'Tool', href: '/tools', detail: 'Tool registrati' },
    { title: 'Health', href: '/health', detail: 'Health check sistema' },
    { title: 'Sessioni', href: '/sessions', detail: 'Lista sessioni' },
    { title: 'Circuit Breaker', href: '/retry', detail: 'Stato circuit breaker' },
    { title: 'Impostazioni', href: '/settings', detail: 'Configurazione' },
    { title: 'Config', href: '/config', detail: 'Editor JSON config' },
    { title: 'Secrets', href: '/secrets', detail: 'API key e token cifrati' },
    { title: 'Context Engine', href: '/context', detail: 'Budget token e sezioni contesto' },
    { title: 'Attività', href: '/activity', detail: 'Feed timeline attività team' },
    { title: 'Team', href: '/team', detail: 'Stato agenti e sessioni tmux' },
    { title: 'Validators', href: '/validators', detail: 'Validatori schema' },
    { title: 'Skills', href: '/skills', detail: 'Skill registrate' },
    { title: 'Task', href: '/tasks', detail: 'Task degli agenti' },
    { title: 'Backup', href: '/backup', detail: 'Backup e ripristino' },
    { title: 'Monitoring', href: '/monitoring', detail: 'Metriche sistema' },
    { title: 'Cron', href: '/cron', detail: 'Job schedulati' },
    { title: 'Notifiche', href: '/notifications', detail: 'Centro notifiche' },
    { title: 'Template', href: '/templates', detail: 'Template messaggi' },
    { title: 'Export', href: '/export', detail: 'Esporta dati' },
    { title: 'Import', href: '/import', detail: 'Importa dati' },
    { title: 'Logs', href: '/logs', detail: 'Log di sistema' },
    { title: 'Providers', href: '/providers', detail: 'Provider AI (Anthropic, OpenAI)' },
    { title: 'Profilo', href: '/profile', detail: 'Profilo candidato' },
  ]
  return pages
    .filter(p => p.title.toLowerCase().includes(q) || p.detail.toLowerCase().includes(q))
    .map(p => ({ type: 'page', id: p.href, ...p }))
}

/** GET /api/search?q=query — ricerca globale */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().toLowerCase()
  if (!q || q.length < 2) return NextResponse.json({ results: [], query: q })

  const results = [
    ...searchPages(q),
    ...searchAgents(q),
    ...searchSessions(q),
    ...searchTasks(q),
    ...searchPlugins(q),
  ].slice(0, 20)

  return NextResponse.json({ results, query: q, total: results.length })
}
