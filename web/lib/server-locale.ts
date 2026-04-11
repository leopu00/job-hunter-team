/**
 * Reads the current locale from ~/.jht/i18n-prefs.json (server-side only)
 */
import fs from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'

export type ServerLocale = 'it' | 'en' | 'hu'

const PREFS_PATH = path.join(homedir(), '.jht', 'i18n-prefs.json')

export function getServerLocale(): ServerLocale {
  try {
    const raw = JSON.parse(fs.readFileSync(PREFS_PATH, 'utf-8'))
    if (raw.locale === 'it' || raw.locale === 'en' || raw.locale === 'hu') return raw.locale
  } catch { /* default */ }
  return 'it'
}
