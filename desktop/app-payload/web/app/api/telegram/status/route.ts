import { NextResponse } from 'next/server'
import { runBash } from '@/lib/shell'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

export const dynamic = 'force-dynamic'

const CONFIG_PATH = path.join(os.homedir(), '.jht', 'jht.config.json')
const TIMEOUT_MS  = 5_000

function readBotToken(): string | null {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
    return cfg?.channels?.telegram?.bot_token ?? null
  } catch { return null }
}

async function checkTmux(session: string): Promise<boolean> {
  const { stdout } = await runBash(
    `tmux has-session -t "${session}" 2>&1 && echo EXISTS || echo NONE`
  ).catch(() => ({ stdout: 'NONE' }))
  return stdout.trim() === 'EXISTS'
}

async function getMe(token: string): Promise<{ ok: boolean; username?: string; firstName?: string; id?: number }> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'jht-web/1.0' },
    })
    clearTimeout(timer)
    if (!res.ok) return { ok: false }
    const data = await res.json()
    if (!data.ok) return { ok: false }
    return { ok: true, username: data.result.username, firstName: data.result.first_name, id: data.result.id }
  } catch { return { ok: false } }
}

export async function GET() {
  const token = readBotToken()
  const configured = !!token

  const [tmuxActive, botInfo] = await Promise.all([
    checkTmux('JHT-BOT'),
    token ? getMe(token) : Promise.resolve({ ok: false } as { ok: boolean; username?: string; firstName?: string; id?: number }),
  ])

  const connected = configured && botInfo.ok
  const running   = tmuxActive

  return NextResponse.json({
    configured,
    connected,
    running,
    tmuxSession: 'JHT-BOT',
    botUsername: botInfo.username ?? null,
    botName: botInfo.firstName ?? null,
    botId: botInfo.id ?? null,
    mode: connected ? 'polling' : null,
    ts: Date.now(),
  })
}
