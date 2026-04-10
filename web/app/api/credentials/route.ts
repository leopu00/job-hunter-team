import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { JHT_HOME } from '@/lib/jht-paths'

export const dynamic = 'force-dynamic'

const CREDS_DIR = path.join(JHT_HOME, 'credentials')

const API_KEY_PROVIDERS = ['claude', 'openai', 'minimax'] as const
const OAUTH_PROVIDERS = ['chatgpt_pro', 'claude_max'] as const
const ALL_PROVIDERS = [...API_KEY_PROVIDERS, ...OAUTH_PROVIDERS] as const
type Provider = (typeof ALL_PROVIDERS)[number]

const ENV_VAR_MAP: Record<string, string> = {
  claude: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', minimax: 'MINIMAX_API_KEY',
}

const KEY_PREFIXES: Record<string, string> = {
  claude: 'sk-ant-', openai: 'sk-', minimax: 'mm-',
}

function isValidProvider(p: string): p is Provider {
  return (ALL_PROVIDERS as readonly string[]).includes(p)
}

function hasEnvKey(provider: string): boolean {
  const envVar = ENV_VAR_MAP[provider]
  return !!(envVar && process.env[envVar]?.trim())
}

function hasStoredCredential(provider: string): boolean {
  return fs.existsSync(path.join(CREDS_DIR, `${provider}.json`))
}

function readCredentialMeta(provider: string): { type: string; savedAt: number; source: string } | null {
  if (hasEnvKey(provider)) {
    return { type: 'api_key', savedAt: 0, source: 'env' }
  }
  const filePath = path.join(CREDS_DIR, `${provider}.json`)
  if (!fs.existsSync(filePath)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    return { type: raw.type ?? 'api_key', savedAt: raw.savedAt ?? 0, source: 'file' }
  } catch { return null }
}

function validateApiKey(provider: string, key: string): string | null {
  if (!key.trim()) return 'API key vuota'
  const prefix = KEY_PREFIXES[provider]
  if (prefix && !key.startsWith(prefix)) return `API key deve iniziare con ${prefix}`
  if (key.trim().length < 10) return 'API key troppo corta'
  return null
}

/** GET — lista provider con stato credenziali (mai espone chiavi reali) */
export async function GET() {
  const providers = ALL_PROVIDERS.map(p => {
    const meta = readCredentialMeta(p)
    const isApiKey = (API_KEY_PROVIDERS as readonly string[]).includes(p)
    return {
      provider: p,
      type: isApiKey ? 'api_key' : 'oauth',
      configured: meta !== null,
      source: meta?.source ?? 'none',
      savedAt: meta?.savedAt ?? null,
      envVar: ENV_VAR_MAP[p] ?? null,
    }
  })
  return NextResponse.json({ providers })
}

/** POST — salva una credenziale (API key o OAuth token) */
export async function POST(req: NextRequest) {
  let body: { provider?: string; apiKey?: string; accessToken?: string } = {}
  try { body = await req.json() } catch { /* ignore */ }

  if (!body.provider || !isValidProvider(body.provider)) {
    return NextResponse.json({ ok: false, error: 'Provider non valido' }, { status: 400 })
  }

  const isApiKey = (API_KEY_PROVIDERS as readonly string[]).includes(body.provider)

  if (isApiKey) {
    if (!body.apiKey) return NextResponse.json({ ok: false, error: 'apiKey obbligatoria' }, { status: 400 })
    const err = validateApiKey(body.provider, body.apiKey)
    if (err) return NextResponse.json({ ok: false, error: err }, { status: 400 })
    const credential = { type: 'api_key', provider: body.provider, savedAt: Date.now() }
    fs.mkdirSync(CREDS_DIR, { recursive: true })
    fs.writeFileSync(path.join(CREDS_DIR, `${body.provider}.json`), JSON.stringify(credential, null, 2), 'utf-8')
    return NextResponse.json({ ok: true, provider: body.provider, type: 'api_key' }, { status: 201 })
  }

  if (!body.accessToken) return NextResponse.json({ ok: false, error: 'accessToken obbligatorio' }, { status: 400 })
  const credential = { type: 'oauth', provider: body.provider, savedAt: Date.now() }
  fs.mkdirSync(CREDS_DIR, { recursive: true })
  fs.writeFileSync(path.join(CREDS_DIR, `${body.provider}.json`), JSON.stringify(credential, null, 2), 'utf-8')
  return NextResponse.json({ ok: true, provider: body.provider, type: 'oauth' }, { status: 201 })
}

/** DELETE — rimuove credenziale per provider: ?provider=claude */
export async function DELETE(req: NextRequest) {
  const provider = req.nextUrl.searchParams.get('provider')
  if (!provider || !isValidProvider(provider)) {
    return NextResponse.json({ ok: false, error: 'Provider non valido' }, { status: 400 })
  }
  if (hasEnvKey(provider)) {
    return NextResponse.json({ ok: false, error: 'Credenziale da variabile ambiente — rimuovi dalla shell' }, { status: 400 })
  }
  const filePath = path.join(CREDS_DIR, `${provider}.json`)
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ ok: false, error: 'Nessuna credenziale salvata' }, { status: 404 })
  }
  fs.unlinkSync(filePath)
  return NextResponse.json({ ok: true, provider })
}
