import { NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

export const dynamic = 'force-dynamic'

type RetryConfig = { attempts: number; minDelayMs: number; maxDelayMs: number; jitter: number }
type WindowConfig = { maxRequests: number; windowMs: number }

type ProviderLimit = {
  id: string
  label: string
  window: WindowConfig
  retry: RetryConfig
  backoffSteps: number[]
}

type JhtConfig = {
  rate_limiter?: {
    global?: Partial<WindowConfig>
    providers?: Record<string, Partial<WindowConfig & RetryConfig>>
  }
}

const API_RETRY_DEFAULTS: RetryConfig = { attempts: 3, minDelayMs: 500, maxDelayMs: 60_000, jitter: 0.1 }
const DEFAULT_WINDOW: WindowConfig = { maxRequests: 60, windowMs: 60_000 }

const KNOWN_PROVIDERS: Array<{ id: string; label: string; window: WindowConfig }> = [
  { id: 'claude',  label: 'Claude (Anthropic)', window: { maxRequests: 50, windowMs: 60_000 } },
  { id: 'openai',  label: 'OpenAI',             window: { maxRequests: 60, windowMs: 60_000 } },
  { id: 'minimax', label: 'Minimax',            window: { maxRequests: 40, windowMs: 60_000 } },
]

function loadConfig(): JhtConfig {
  const candidates = [
    path.join(os.homedir(), '.jht', 'jht.config.json'),
    path.join(process.cwd(), 'jht.config.json'),
    path.join(process.cwd(), '..', 'jht.config.json'),
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8')) as JhtConfig
    } catch { /* continua */ }
  }
  return {}
}

function calcBackoff(retry: RetryConfig): number[] {
  return Array.from({ length: retry.attempts }, (_, i) => {
    const base = retry.minDelayMs * Math.pow(2, i)
    const clamped = Math.min(base, retry.maxDelayMs)
    return Math.round(clamped * (1 + retry.jitter * 0.5))
  })
}

export async function GET() {
  const config = loadConfig()
  const rlCfg = config.rate_limiter ?? {}
  const globalWindow: WindowConfig = { ...DEFAULT_WINDOW, ...(rlCfg.global ?? {}) }

  const providers: ProviderLimit[] = KNOWN_PROVIDERS.map(p => {
    const override = rlCfg.providers?.[p.id] ?? {}
    const window: WindowConfig = { ...p.window, ...{ maxRequests: override.maxRequests ?? p.window.maxRequests, windowMs: override.windowMs ?? p.window.windowMs } }
    const retry: RetryConfig = {
      ...API_RETRY_DEFAULTS,
      ...(override.attempts != null    ? { attempts: override.attempts }       : {}),
      ...(override.minDelayMs != null  ? { minDelayMs: override.minDelayMs }   : {}),
      ...(override.maxDelayMs != null  ? { maxDelayMs: override.maxDelayMs }   : {}),
      ...(override.jitter != null      ? { jitter: override.jitter }           : {}),
    }
    return { id: p.id, label: p.label, window, retry, backoffSteps: calcBackoff(retry) }
  })

  return NextResponse.json({
    globalWindow,
    providers,
    defaults: { window: DEFAULT_WINDOW, retry: API_RETRY_DEFAULTS },
    configLoaded: Object.keys(config).length > 0,
    ts: Date.now(),
  })
}
