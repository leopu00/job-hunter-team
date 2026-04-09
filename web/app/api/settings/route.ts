import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

export const dynamic = 'force-dynamic'

const CONFIG_DIR  = path.join(os.homedir(), '.jht')
const CONFIG_PATH = path.join(CONFIG_DIR, 'jht.config.json')
const PROVIDERS   = ['anthropic', 'claude', 'openai', 'kimi', 'minimax'] as const

function sanitize(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  return s.length > 0 && !/[\n\r\0]/.test(s) ? s : undefined
}

function maskKeys(config: Record<string, unknown>): Record<string, unknown> {
  const safe = JSON.parse(JSON.stringify(config))
  for (const p of PROVIDERS) {
    const prov = safe.providers?.[p]
    if (prov?.api_key) {
      prov.api_key = (prov.api_key as string).slice(0, 8) + '••••••••'
    }
  }
  return safe
}

export async function GET() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return NextResponse.json({ exists: false, config: null })
  }
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
    return NextResponse.json({ exists: true, config: maskKeys(config) })
  } catch {
    return NextResponse.json({ exists: true, config: null, error: 'config corrotta' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'body non valido' }, { status: 400 }) }

  let existing: Record<string, unknown> = {}
  if (fs.existsSync(CONFIG_PATH)) {
    try { existing = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) } catch { /* usa default */ }
  }
  const app   = (body.app   ?? {}) as Record<string, unknown>
  const notif = (body.notifications ?? {}) as Record<string, unknown>
  const updated = {
    ...existing,
    app: { ...(existing.app as Record<string, unknown> ?? {}), ...app },
    notifications: { ...(existing.notifications as Record<string, unknown> ?? {}), ...notif },
  }
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2) + '\n', 'utf-8')
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'errore' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'body non valido' }, { status: 400 }) }

  // Danger zone actions
  if (body._action === 'reset_config') {
    try {
      const defaults = { version: 1, providers: {}, channels: {}, workspace: CONFIG_DIR, cron_enabled: false }
      fs.mkdirSync(CONFIG_DIR, { recursive: true })
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2) + '\n', 'utf-8')
      return NextResponse.json({ ok: true })
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'errore reset' }, { status: 500 })
    }
  }
  if (body._action === 'clear_cache') {
    const cacheDir = path.join(CONFIG_DIR, 'cache')
    try {
      if (fs.existsSync(cacheDir)) fs.rmSync(cacheDir, { recursive: true, force: true })
      fs.mkdirSync(cacheDir, { recursive: true })
      return NextResponse.json({ ok: true })
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'errore cache' }, { status: 500 })
    }
  }

  // Leggi config esistente come base
  let existing: Record<string, unknown> = { version: 1, providers: {}, channels: {}, workspace: CONFIG_DIR }
  if (fs.existsSync(CONFIG_PATH)) {
    try { existing = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) } catch { /* usa default */ }
  }

  const activeProvider = sanitize(body.active_provider) ?? String(existing.active_provider ?? 'anthropic')
  if (!(PROVIDERS as readonly string[]).includes(activeProvider)) {
    return NextResponse.json({ error: 'active_provider non valido' }, { status: 400 })
  }

  // Aggiorna providers: merge con esistente, non sovrascrivere api_key mascherate
  const incomingProviders = (body.providers ?? {}) as Record<string, Record<string, unknown>>
  const existingProviders = (existing.providers ?? {}) as Record<string, Record<string, unknown>>
  const mergedProviders: Record<string, unknown> = { ...existingProviders }
  for (const [name, conf] of Object.entries(incomingProviders)) {
    const base = existingProviders[name] ?? {}
    const apiKey = sanitize(conf.api_key as string)
    mergedProviders[name] = {
      ...base,
      ...conf,
      // Non sovrascrivere se è mascherata (contiene ••••)
      ...(apiKey && !apiKey.includes('•') ? { api_key: apiKey } : { api_key: base.api_key }),
    }
  }

  // Telegram
  const channels = (body.channels ?? existing.channels ?? {}) as Record<string, unknown>

  // Cron
  const cronEnabled = typeof body.cron_enabled === 'boolean' ? body.cron_enabled
    : (existing as Record<string, unknown>).cron_enabled ?? false

  const config = {
    ...existing,
    version: 1,
    active_provider: activeProvider,
    providers: mergedProviders,
    channels,
    workspace: sanitize(body.workspace as string) ?? String(existing.workspace ?? CONFIG_DIR),
    cron_enabled: cronEnabled,
  }

  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8')
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'errore scrittura' }, { status: 500 })
  }
}
