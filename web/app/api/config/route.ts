import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { JHT_HOME } from '@/lib/jht-paths'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const CONFIG_DIR  = JHT_HOME
const CONFIG_PATH = path.join(CONFIG_DIR, 'jht.config.json')
const PROVIDERS   = ['anthropic', 'claude', 'openai', 'kimi', 'minimax'] as const

type ValidationIssue = { path: string; message: string }

function validateConfig(cfg: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (typeof cfg !== 'object' || cfg === null) return [{ path: 'root', message: 'Config deve essere un oggetto JSON' }]
  const c = cfg as Record<string, unknown>

  if (!c.version || typeof c.version !== 'number') issues.push({ path: 'version', message: 'version deve essere un numero' })
  if (!PROVIDERS.includes(c.active_provider as typeof PROVIDERS[number])) issues.push({ path: 'active_provider', message: `Deve essere uno di: ${PROVIDERS.join(', ')}` })
  if (typeof c.workspace !== 'string' || !c.workspace) issues.push({ path: 'workspace', message: 'workspace obbligatorio' })

  const providers = c.providers as Record<string, unknown> | undefined
  if (!providers || typeof providers !== 'object') {
    issues.push({ path: 'providers', message: 'providers deve essere un oggetto' })
  } else {
    for (const [name, p] of Object.entries(providers)) {
      if (typeof p !== 'object' || p === null) { issues.push({ path: `providers.${name}`, message: 'configurazione non valida' }); continue }
      const prov = p as Record<string, unknown>
      if (prov.auth_method === 'api_key' && !prov.api_key) issues.push({ path: `providers.${name}.api_key`, message: 'api_key obbligatoria' })
      if (prov.auth_method === 'subscription') {
        const sub = prov.subscription as Record<string, unknown> | undefined
        if (!sub?.email) issues.push({ path: `providers.${name}.subscription.email`, message: 'email obbligatoria' })
      }
    }
    const active = c.active_provider as string
    if (active && !(providers as Record<string, unknown>)[active]) {
      issues.push({ path: 'active_provider', message: `Provider attivo '${active}' non configurato in providers` })
    }
  }

  const channels = c.channels as Record<string, unknown> | undefined
  if (channels?.telegram) {
    const tg = channels.telegram as Record<string, unknown>
    if (!tg.bot_token) issues.push({ path: 'channels.telegram.bot_token', message: 'bot_token obbligatorio' })
  }

  return issues
}

function maskKeys(cfg: Record<string, unknown>): Record<string, unknown> {
  const safe = JSON.parse(JSON.stringify(cfg))
  for (const p of PROVIDERS) {
    if (safe.providers?.[p]?.api_key) safe.providers[p].api_key = (safe.providers[p].api_key as string).slice(0, 8) + '••••••••'
  }
  return safe
}

export async function GET() {
  const denied = await requireAuth()
  if (denied) return denied
  if (!fs.existsSync(CONFIG_PATH)) return NextResponse.json({ exists: false, config: null, issues: [], valid: false })
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
    const issues = validateConfig(raw)
    return NextResponse.json({ exists: true, config: maskKeys(raw), issues, valid: issues.length === 0 })
  } catch {
    return NextResponse.json({ exists: true, config: null, issues: [{ path: 'root', message: 'JSON non valido' }], valid: false }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth()
  if (denied) return denied
  let body: { config?: unknown; validateOnly?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'body non valido' }, { status: 400 }) }

  const issues = validateConfig(body.config)
  if (body.validateOnly) return NextResponse.json({ issues, valid: issues.length === 0 })
  if (issues.length > 0) return NextResponse.json({ ok: false, issues }, { status: 422 })

  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
    const tmp = CONFIG_PATH + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(body.config, null, 2) + '\n', 'utf-8')
    fs.renameSync(tmp, CONFIG_PATH)
    return NextResponse.json({ ok: true, issues: [] })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'errore scrittura' }, { status: 500 })
  }
}
