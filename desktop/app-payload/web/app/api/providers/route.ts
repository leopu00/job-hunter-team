import { NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

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

const KNOWN_PROVIDERS = [
  {
    id: 'claude',
    label: 'Claude (Anthropic)',
    models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
    envKey: 'ANTHROPIC_API_KEY',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    models: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini'],
    envKey: 'OPENAI_API_KEY',
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

export async function GET() {
  const config = loadConfig()
  const activeProvider = config.active_provider ?? process.env.JHT_LLM_PROVIDER ?? 'claude'

  const providers = KNOWN_PROVIDERS.map(p => {
    const providerCfg = config.providers?.[p.id]
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
