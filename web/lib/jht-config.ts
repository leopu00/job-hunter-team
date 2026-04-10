import fs from 'fs'
import path from 'path'
import os from 'os'

export type ProviderId = 'anthropic' | 'claude' | 'openai' | 'kimi' | 'minimax'
export type AuthMethod = 'api_key' | 'subscription'

export interface ProviderConfig {
  auth_method: AuthMethod
  api_key?: string
  model?: string
  subscription?: { email?: string }
}

export interface JhtConfig {
  version?: number
  active_provider: ProviderId
  providers: Partial<Record<ProviderId, ProviderConfig>>
  workspace?: string
}

const CONFIG_PATH = path.join(os.homedir(), '.jht', 'jht.config.json')

export function readJhtConfig(): JhtConfig | null {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const cfg = JSON.parse(raw) as JhtConfig
    if (!cfg || typeof cfg !== 'object') return null
    if (!cfg.active_provider || !cfg.providers) return null
    return cfg
  } catch {
    return null
  }
}

export function getActiveProvider(cfg: JhtConfig): { id: ProviderId; conf: ProviderConfig } | null {
  const id = cfg.active_provider
  const conf = cfg.providers[id]
  if (!conf) return null
  return { id, conf }
}
