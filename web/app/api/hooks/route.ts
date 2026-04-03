import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CONFIG_PATH   = path.join(os.homedir(), '.jht', 'jht.config.json')
const HOOK_MD       = 'HOOK.md'
const HANDLER_FILES = ['handler.ts', 'handler.js', 'handler.mjs']

type HookSummary = {
  name: string
  description: string
  source: 'workspace'
  events: string[]
  enabled: boolean
}

function getWorkspace(): string | null {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
    return typeof cfg.workspace === 'string' ? cfg.workspace : null
  } catch { return null }
}

function parseEvents(content: string): string[] {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return []
  const events: string[] = []
  for (const line of match[1].split('\n')) {
    const t = line.trim()
    if (t.startsWith('- ')) {
      const v = t.slice(2).trim().replace(/['"]/g, '')
      if (v.includes(':')) events.push(v)
    }
  }
  return events
}

function parseDescription(content: string): string {
  const body = content.replace(/^---[\s\S]*?---\n?/, '').trim()
  return body.split('\n')[0] ?? ''
}

function discoverHooks(hooksDir: string): HookSummary[] {
  if (!fs.existsSync(hooksDir)) return []
  let items: string[]
  try { items = fs.readdirSync(hooksDir) } catch { return [] }

  const result: HookSummary[] = []
  for (const item of items) {
    const hookDir  = path.join(hooksDir, item)
    const stat     = fs.statSync(hookDir, { throwIfNoEntry: false })
    if (!stat?.isDirectory()) continue

    const hookMdPath = path.join(hookDir, HOOK_MD)
    if (!fs.existsSync(hookMdPath)) continue

    const hasHandler = HANDLER_FILES.some(f => fs.existsSync(path.join(hookDir, f)))
    if (!hasHandler) continue

    let content: string
    try { content = fs.readFileSync(hookMdPath, 'utf-8') } catch { continue }

    result.push({
      name:        item,
      description: parseDescription(content),
      source:      'workspace',
      events:      parseEvents(content),
      enabled:     true,
    })
  }
  return result
}

export async function GET() {
  const workspace = getWorkspace()
  if (!workspace) {
    return NextResponse.json({ hooks: [], total: 0, error: 'workspace non configurato' })
  }

  const hooksDir = path.join(workspace, 'hooks')
  const hooks    = discoverHooks(hooksDir)
  return NextResponse.json({ hooks, total: hooks.length, hooksDir })
}
