import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

export const dynamic = 'force-dynamic'

const CONFIG_DIR  = path.join(os.homedir(), '.jht')
const CONFIG_PATH = path.join(CONFIG_DIR, 'jht.config.json')

const VALID_PROVIDERS = ['anthropic', 'claude', 'openai', 'kimi', 'minimax'] as const

function sanitizeString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  return s.length > 0 ? s : undefined
}

export async function GET() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return NextResponse.json({ exists: false, config: null })
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const config = JSON.parse(raw)
    // Maschera le API key prima di esporle
    const safe = JSON.parse(JSON.stringify(config))
    for (const k of VALID_PROVIDERS) {
      if (safe.providers?.[k]?.api_key) {
        const key: string = safe.providers[k].api_key
        safe.providers[k].api_key = key.slice(0, 8) + '••••••••'
      }
    }
    return NextResponse.json({ exists: true, config: safe })
  } catch {
    return NextResponse.json({ exists: true, config: null, error: 'config corrotta' })
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'body non valido' }, { status: 400 }) }

  const activeProvider = sanitizeString(body.active_provider)
  if (!activeProvider || !(VALID_PROVIDERS as readonly string[]).includes(activeProvider)) {
    return NextResponse.json({ error: 'active_provider non valido' }, { status: 400 })
  }

  const providers = body.providers as Record<string, unknown> | undefined
  if (!providers || typeof providers !== 'object') {
    return NextResponse.json({ error: 'providers obbligatorio' }, { status: 400 })
  }

  const activeConf = providers[activeProvider] as Record<string, unknown> | undefined
  if (!activeConf) {
    return NextResponse.json({ error: 'configurazione per il provider attivo mancante' }, { status: 400 })
  }

  const authMethod = sanitizeString(activeConf.auth_method)
  if (authMethod === 'api_key') {
    const key = sanitizeString(activeConf.api_key as string)
    if (!key) return NextResponse.json({ error: 'api_key obbligatoria' }, { status: 400 })
    if (/[\n\r\0]/.test(key)) return NextResponse.json({ error: 'api_key contiene caratteri non validi' }, { status: 400 })
  } else if (authMethod === 'subscription') {
    const sub = activeConf.subscription as Record<string, unknown> | undefined
    if (!sub?.email) return NextResponse.json({ error: 'email obbligatoria per subscription' }, { status: 400 })
  } else {
    return NextResponse.json({ error: 'auth_method non valido' }, { status: 400 })
  }

  const workspace = sanitizeString(body.workspace as string) ?? CONFIG_DIR
  if (/[\n\r\0]/.test(workspace)) {
    return NextResponse.json({ error: 'workspace contiene caratteri non validi' }, { status: 400 })
  }

  const config = {
    version: 1,
    active_provider: activeProvider,
    providers,
    channels: body.channels ?? {},
    workspace,
  }

  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8')
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'errore scrittura'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
