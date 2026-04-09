import { cookies } from 'next/headers'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { hasSupabaseConfig } from '@/lib/supabase/config'

const COOKIE_NAME = 'jht_workspace'
const CONFIG_PATH = path.join(os.homedir(), '.jht', 'jht.config.json')

function readWorkspaceFromGlobalConfig(): string | null {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>
    const workspace =
      typeof cfg.workspacePath === 'string' ? cfg.workspacePath
      : typeof cfg.workspace === 'string' ? cfg.workspace
      : typeof cfg.workspace === 'object' && cfg.workspace && typeof (cfg.workspace as Record<string, unknown>).path === 'string'
        ? String((cfg.workspace as Record<string, unknown>).path)
        : ''
    return workspace.trim() || null
  } catch {
    return null
  }
}

export async function getWorkspacePath(): Promise<string | null> {
  try {
    const cookieStore = await cookies()
    const cookie = cookieStore.get(COOKIE_NAME)
    return cookie?.value || readWorkspaceFromGlobalConfig()
  } catch {
    return readWorkspaceFromGlobalConfig()
  }
}

export function getDbPath(workspacePath: string): string {
  return path.join(workspacePath, 'jobs.db')
}

export function getProfilePath(workspacePath: string): string {
  return path.join(workspacePath, 'profile', 'candidate_profile.yml')
}

export function workspaceExists(workspacePath: string): boolean {
  try {
    return fs.existsSync(workspacePath) && fs.statSync(workspacePath).isDirectory()
  } catch {
    return false
  }
}

export function workspaceHasDb(workspacePath: string): boolean {
  return fs.existsSync(getDbPath(workspacePath))
}

export function workspaceHasProfile(workspacePath: string): boolean {
  return fs.existsSync(getProfilePath(workspacePath))
}

export const isSupabaseConfigured = hasSupabaseConfig()
