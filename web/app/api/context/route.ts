import { NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { JHT_HOME } from '@/lib/jht-paths'

export const dynamic = 'force-dynamic'

const CONFIG_PATH = path.join(JHT_HOME, 'jht.config.json')
const HISTORY_PATH = path.join(JHT_HOME, 'history.json')

function readJSON<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch {
    return fallback
  }
}

interface JhtConfig {
  tokenBudget?: number
  maxHistoryMessages?: number
  contextEngineId?: string
  workspace?: string
}

/** GET — stato e configurazione context engine */
export async function GET() {
  const config = readJSON<JhtConfig>(CONFIG_PATH, {})
  const history = readJSON<{ conversations?: { id: string; messages?: unknown[] }[] }>(HISTORY_PATH, {})

  const tokenBudget = config.tokenBudget ?? 8192
  const engineId = config.contextEngineId ?? 'default'

  const conversations = history.conversations ?? []
  const totalMessages = conversations.reduce((sum, c) => sum + (c.messages?.length ?? 0), 0)
  const estimatedTokensUsed = Math.ceil(totalMessages * 180) // ~180 token/messaggio

  const sections = [
    { id: 'system',  priority: 'required', description: 'Prompt di sistema e identità agente',   estimatedTokens: 512 },
    { id: 'memory',  priority: 'high',     description: 'Memoria persistente e contesto utente', estimatedTokens: 1024 },
    { id: 'tools',   priority: 'high',     description: 'Definizioni tool disponibili',           estimatedTokens: 256 },
    { id: 'history', priority: 'medium',   description: 'Cronologia conversazione corrente',      estimatedTokens: Math.min(estimatedTokensUsed, tokenBudget * 0.6 | 0) },
    { id: 'context', priority: 'low',      description: 'Contesto aggiuntivo e file allegati',    estimatedTokens: 0 },
  ]

  const usedTokens = sections.reduce((s, sec) => s + sec.estimatedTokens, 0)
  const budgetUsagePct = Math.round((usedTokens / tokenBudget) * 100)

  return NextResponse.json({
    engine: {
      id: engineId,
      name: 'JHT Default Context Engine',
      version: '1.0.0',
      status: 'active',
    },
    budget: {
      total: tokenBudget,
      used: usedTokens,
      available: Math.max(0, tokenBudget - usedTokens),
      usagePct: budgetUsagePct,
    },
    config: {
      tokenBudget,
      maxHistoryMessages: config.maxHistoryMessages ?? 50,
      engineId,
      workspace: config.workspace ?? path.join(os.homedir(), 'jht'),
    },
    stats: {
      conversations: conversations.length,
      totalMessages,
    },
    sections,
  })
}
