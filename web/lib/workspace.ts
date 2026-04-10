import fs from 'fs'
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
