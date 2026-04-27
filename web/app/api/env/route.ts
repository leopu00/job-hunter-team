import { NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { JHT_HOME, JHT_CONFIG_PATH } from '@/lib/jht-paths'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const CONFIG_PATH = JHT_CONFIG_PATH
const SECRETS_PATH = path.join(JHT_HOME, 'secrets.json')

type EnvSource   = 'env' | 'config' | 'secret'
type EnvCategory = 'AI Provider' | 'Telegram' | 'Database' | 'Sistema' | 'Config' | 'Secrets'

export interface EnvVar {
  name: string
  source: EnvSource
  category: EnvCategory
  set: boolean
}

/** Pattern variabili d'ambiente rilevanti per JHT */
const ENV_PATTERNS: Array<{ pattern: RegExp; category: EnvCategory }> = [
  { pattern: /^ANTHROPIC_/,   category: 'AI Provider' },
  { pattern: /^OPENAI_/,      category: 'AI Provider' },
  { pattern: /^MINIMAX_/,     category: 'AI Provider' },
  { pattern: /^TELEGRAM_/,    category: 'Telegram'    },
  { pattern: /^BOT_TOKEN/,    category: 'Telegram'    },
  { pattern: /^DATABASE_/,    category: 'Database'    },
  { pattern: /^SUPABASE_/,    category: 'Database'    },
  { pattern: /^JHT_/,         category: 'Sistema'     },
  { pattern: /^NODE_ENV$/,    category: 'Sistema'     },
  { pattern: /^PORT$/,        category: 'Sistema'     },
  { pattern: /^NEXT_PUBLIC_/, category: 'Sistema'     },
]

/** Variabili JHT note che potrebbero non essere impostate */
const KNOWN_ENV: Array<{ name: string; category: EnvCategory }> = [
  { name: 'ANTHROPIC_API_KEY',    category: 'AI Provider' },
  { name: 'OPENAI_API_KEY',       category: 'AI Provider' },
  { name: 'MINIMAX_API_KEY',      category: 'AI Provider' },
  { name: 'MINIMAX_GROUP_ID',     category: 'AI Provider' },
  { name: 'TELEGRAM_BOT_TOKEN',   category: 'Telegram'    },
  { name: 'TELEGRAM_CHAT_ID',     category: 'Telegram'    },
  { name: 'JHT_HOME',             category: 'Sistema'     },
  { name: 'JHT_USER_DIR',         category: 'Sistema'     },
  { name: 'JHT_DB',               category: 'Sistema'     },
  { name: 'JHT_CONFIG',           category: 'Sistema'     },
  { name: 'JHT_LOG_LEVEL',        category: 'Sistema'     },
  { name: 'NODE_ENV',             category: 'Sistema'     },
  { name: 'PORT',                 category: 'Sistema'     },
]

function readJSON<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return null }
}

/** GET — lista variabili (SOLO nomi e metadati, mai valori) */
export async function GET() {
  const denied = await requireAuth()
  if (denied) return denied
  const vars = new Map<string, EnvVar>()

  // 1. Variabili note (con stato set/unset)
  for (const k of KNOWN_ENV) {
    vars.set(k.name, { name: k.name, source: 'env', category: k.category, set: !!process.env[k.name] })
  }

  // 2. Variabili process.env che matchano pattern JHT
  for (const key of Object.keys(process.env)) {
    if (vars.has(key)) continue
    for (const { pattern, category } of ENV_PATTERNS) {
      if (pattern.test(key)) {
        vars.set(key, { name: key, source: 'env', category, set: true })
        break
      }
    }
  }

  // 3. Chiavi da jht.config.json
  const config = readJSON<Record<string, unknown>>(CONFIG_PATH)
  if (config) {
    for (const key of Object.keys(config)) {
      if (!vars.has(key)) {
        vars.set(key, { name: key, source: 'config', category: 'Config', set: true })
      }
    }
  }

  // 4. Nomi secrets (solo nome, mai valore)
  const secretStore = readJSON<{ secrets?: Array<{ name: string }> }>(SECRETS_PATH)
  for (const s of secretStore?.secrets ?? []) {
    if (!vars.has(s.name)) {
      vars.set(s.name, { name: s.name, source: 'secret', category: 'Secrets', set: true })
    }
  }

  const items = [...vars.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  const total = items.length
  const setCount = items.filter(v => v.set).length

  return NextResponse.json({ vars: items, total, setCount, unsetCount: total - setCount })
}
