import { cookies } from 'next/headers'
import fs from 'fs'
import path from 'path'

const COOKIE_NAME = 'jht_workspace'

export async function getWorkspacePath(): Promise<string | null> {
  try {
    const cookieStore = await cookies()
    const cookie = cookieStore.get(COOKIE_NAME)
    return cookie?.value || null
  } catch {
    return null
  }
}

export function getDbPath(workspacePath: string): string {
  return path.join(workspacePath, 'jobs.db')
}

export function getProfilePath(workspacePath: string): string {
  return path.join(workspacePath, 'candidate_profile.yml')
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

export const isSupabaseConfigured = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)
