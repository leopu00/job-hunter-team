import fs from 'fs'
import path from 'path'
import { hasSupabaseConfig } from '@/lib/supabase/config'
import { JHT_DB_PATH, JHT_PROFILE_YAML, JHT_USER_DIR } from '@/lib/jht-paths'

export async function getWorkspacePath(): Promise<string | null> {
  return JHT_USER_DIR
}

export function getDbPath(_workspacePath?: string): string {
  return JHT_DB_PATH
}

export function getProfilePath(_workspacePath?: string): string {
  return JHT_PROFILE_YAML
}

export function workspaceExists(_workspacePath?: string): boolean {
  try {
    return fs.existsSync(JHT_USER_DIR) && fs.statSync(JHT_USER_DIR).isDirectory()
  } catch {
    return false
  }
}

export function workspaceHasDb(_workspacePath?: string): boolean {
  return fs.existsSync(JHT_DB_PATH)
}

export function workspaceHasProfile(_workspacePath?: string): boolean {
  return fs.existsSync(JHT_PROFILE_YAML)
}

export const isSupabaseConfigured = hasSupabaseConfig()

// Legge ~/.jht/cloud.json e ritorna true SE pairing attivo (enabled=true).
// Mai cacha: ogni pageload riapre il file (read sincrono ~µs su file <1KB).
// File non presente / illeggibile / enabled!=true → false (= cloud OFF).
//
// Su Vercel/remote il file non esiste mai → ritorna false (== "non c'è
// pairing locale"). Combinato con workspaceHasDb()=false (no SQLite),
// isLocalOnlyMode() resta false, quindi il flusso Supabase normale prosegue.
export function isCloudEnabled(): boolean {
  try {
    const cloudPath = path.join(JHT_USER_DIR, 'cloud.json')
    if (!fs.existsSync(cloudPath)) return false
    const cfg = JSON.parse(fs.readFileSync(cloudPath, 'utf-8'))
    return cfg && cfg.enabled === true
  } catch {
    return false
  }
}

// JHT-LOCAL-NO-API: modalità privacy-first. L'utente ha SQLite locale
// (workspaceHasDb) MA ha esplicitamente disabilitato il cloud (cloud.json
// assente o enabled=false). In questo modo il web NON deve mai parlare
// con Supabase, neanche per auth — local-queries.ts gestisce tutto.
//
// Su Vercel-side: workspaceHasDb()=false → ritorna sempre false (no-op).
// Su localhost + cloud paired: isCloudEnabled()=true → ritorna false
// (comportamento dual-write attuale, push delta + UI cross-device).
// Su localhost + cloud disabled: ritorna true → flusso 100% local.
export function isLocalOnlyMode(): boolean {
  return workspaceHasDb() && !isCloudEnabled()
}
