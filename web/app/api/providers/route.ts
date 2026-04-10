import { NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { JHT_HOME } from '@/lib/jht-paths'

export const dynamic = 'force-dynamic'

type AuthMethod = 'api_key' | 'subscription' | 'none'

type ProviderConfig = {
  name: string
  auth_method?: AuthMethod
  api_key?: string
  model?: string
  subscription?: Record<string, unknown>
}

type JhtConfig = {
  version?: number
  active_provider?: string
  providers?: Record<string, ProviderConfig>
}

function normalizeProviderId(value: string | undefined): string | null {
  const normalized = (value ?? '').trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'claude') return 'anthropic'
  if (normalized === 'anthropic' || normalized === 'openai' || normalized === 'kimi' || normalized === 'minimax') return normalized
  return null
}

const KNOWN_PROVIDERS = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    models: ['claude-sonnet-4-20250514', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'],
    envKey: 'ANTHROPIC_API_KEY',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    models: ['gpt-4o-mini', 'gpt-4o', 'o1', 'o1-mini'],
    envKey: 'OPENAI_API_KEY',
  },
  {
    id: 'kimi',
    label: 'Kimi K2',
    models: ['kimi-k2-0711-preview'],
    envKey: 'MOONSHOT_API_KEY',
  },
  {
    id: 'minimax',
    label: 'Minimax',
    models: ['abab6.5s-chat', 'abab5.5-chat'],
    envKey: 'MINIMAX_API_KEY',
  },
]

function loadConfig(): JhtConfig {
  const candidates = [
    path.join(JHT_HOME, 'jht.config.json'),
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

export async function GET() {
  const config = loadConfig()
  const activeProvider =
    normalizeProviderId(config.active_provider) ??
    normalizeProviderId(process.env.JHT_LLM_PROVIDER) ??
    'anthropic'

  const providers = KNOWN_PROVIDERS.map(p => {
    const providerCfg = config.providers?.[p.id] ?? (p.id === 'anthropic' ? config.providers?.claude : undefined)
    const hasEnvKey = !!process.env[p.envKey]
    const hasConfigKey = !!(providerCfg?.api_key || providerCfg?.subscription)
    const available = hasEnvKey || hasConfigKey
    const activeModel = providerCfg?.model ?? p.models[0]

    return {
      id: p.id,
      label: p.label,
      available,
      active: p.id === activeProvider,
      authMethod: providerCfg?.auth_method ?? (hasEnvKey ? 'api_key' : 'none'),
      models: p.models,
      activeModel,
      keySource: hasConfigKey ? 'config' : hasEnvKey ? 'env' : null,
    }
  })

  return NextResponse.json({
    providers,
    activeProvider,
    configLoaded: Object.keys(config).length > 0,
  })
}
