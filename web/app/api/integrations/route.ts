import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

export const dynamic = 'force-dynamic'

const JHT         = path.join(os.homedir(), '.jht')
const CONFIG_PATH = path.join(JHT, 'jht.config.json')
const CREDS_DIR   = path.join(JHT, 'credentials')

type Status = 'connected' | 'configured' | 'disconnected'
type Integration = { id: string; name: string; description: string; status: Status; detail: string | null; last_sync: string | null }

function modTime(p: string): string | null {
  try { return fs.statSync(p).mtime.toISOString().slice(0, 19).replace('T', ' ') } catch { return null }
}

function credFile(...names: string[]): string | null {
  for (const n of names) {
    const p = path.join(CREDS_DIR, n)
    if (fs.existsSync(p)) return p
  }
  return null
}

function checkTelegram(): Omit<Integration, 'id' | 'name' | 'description'> {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return { status: 'disconnected', detail: null, last_sync: null }
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
    const token = cfg?.channels?.telegram?.bot_token
    if (!token) return { status: 'disconnected', detail: null, last_sync: null }
    const chatId = cfg?.channels?.telegram?.chat_id ?? null
    return { status: 'connected', detail: chatId ? `chat_id: ${chatId}` : 'token configurato', last_sync: modTime(CONFIG_PATH) }
  } catch { return { status: 'disconnected', detail: null, last_sync: null } }
}

function checkEnvOrCred(envKeys: string[], credNames: string[], label: string): Omit<Integration, 'id' | 'name' | 'description'> {
  const envHit = envKeys.find(k => process.env[k])
  if (envHit) return { status: 'connected', detail: `via env ${envHit}`, last_sync: null }
  const file = credFile(...credNames)
  if (file) return { status: 'configured', detail: path.basename(file), last_sync: modTime(file) }
  return { status: 'disconnected', detail: null, last_sync: null }
}

export async function GET() {
  const integrations: Integration[] = [
    { id: 'telegram', name: 'Telegram',  description: 'Bot per notifiche e comandi del team',           ...checkTelegram() },
    { id: 'github',   name: 'GitHub',    description: 'Push commit, PR e webhook repository',
      ...checkEnvOrCred(['GITHUB_TOKEN', 'GH_TOKEN'], ['github_token', 'github.json'], 'GitHub') },
    { id: 'linkedin', name: 'LinkedIn',  description: 'Ricerca posizioni e candidature automatiche',
      ...checkEnvOrCred(['LINKEDIN_EMAIL', 'LINKEDIN_PASS'], ['linkedin_cookies.json', 'linkedin.json'], 'LinkedIn') },
    { id: 'gmail',    name: 'Gmail',     description: 'Invio email e gestione candidature',
      ...checkEnvOrCred(['GMAIL_USER', 'GMAIL_PASS', 'GOOGLE_CREDENTIALS'], ['gmail_credentials.json', 'gmail.json', 'google_credentials.json'], 'Gmail') },
    { id: 'vercel',   name: 'Vercel',    description: 'Deploy automatico del frontend',
      ...checkEnvOrCred(['VERCEL_TOKEN', 'VERCEL_ORG_ID'], ['vercel_token', 'vercel.json'], 'Vercel') },
  ]
  const summary = {
    connected:    integrations.filter(i => i.status === 'connected').length,
    configured:   integrations.filter(i => i.status === 'configured').length,
    disconnected: integrations.filter(i => i.status === 'disconnected').length,
  }
  return NextResponse.json({ integrations, summary })
}
