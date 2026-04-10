import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { JHT_HOME } from '@/lib/jht-paths'

export const dynamic = 'force-dynamic'

const PREFS_PATH = path.join(JHT_HOME, 'preferences.json')

type ShortcutMap = Record<string, string>

type UserPreferences = {
  theme: 'dark' | 'light'
  language: 'it' | 'en'
  notifications: {
    enabled: boolean
    sound: boolean
    desktop: boolean
  }
  shortcuts: ShortcutMap
}

const DEFAULTS: UserPreferences = {
  theme: 'dark',
  language: 'it',
  notifications: { enabled: true, sound: false, desktop: false },
  shortcuts: {},
}

function load(): UserPreferences {
  try {
    const raw = JSON.parse(fs.readFileSync(PREFS_PATH, 'utf-8'))
    return { ...DEFAULTS, ...raw, notifications: { ...DEFAULTS.notifications, ...(raw.notifications ?? {}) } }
  } catch { return { ...DEFAULTS } }
}

function save(prefs: UserPreferences): void {
  fs.mkdirSync(path.dirname(PREFS_PATH), { recursive: true })
  const tmp = PREFS_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(prefs, null, 2), 'utf-8')
  fs.renameSync(tmp, PREFS_PATH)
}

export async function GET() {
  return NextResponse.json(load())
}

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'body non valido' }, { status: 400 }) }

  const prefs = load()

  if (body.theme === 'dark' || body.theme === 'light') prefs.theme = body.theme
  if (body.language === 'it' || body.language === 'en') prefs.language = body.language
  if (body.notifications && typeof body.notifications === 'object') {
    const n = body.notifications as Record<string, unknown>
    if (typeof n.enabled === 'boolean')  prefs.notifications.enabled  = n.enabled
    if (typeof n.sound   === 'boolean')  prefs.notifications.sound    = n.sound
    if (typeof n.desktop === 'boolean')  prefs.notifications.desktop  = n.desktop
  }
  if (body.shortcuts && typeof body.shortcuts === 'object') {
    prefs.shortcuts = { ...prefs.shortcuts, ...(body.shortcuts as ShortcutMap) }
  }

  try { save(prefs); return NextResponse.json(prefs) }
  catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : 'errore' }, { status: 500 }) }
}

export async function DELETE() {
  try { save({ ...DEFAULTS }); return NextResponse.json({ ok: true }) }
  catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : 'errore' }, { status: 500 }) }
}
