import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface LocalCloudConfig {
  enabled: boolean
  base_url: string
  token: string
  user_id: string
  token_name: string | null
  enabled_at: string
}

export function getJhtHome(): string {
  return process.env.JHT_HOME || join(homedir(), '.jht')
}

export function getLocalDbPath(): string {
  return join(getJhtHome(), 'jobs.db')
}

export function getLocalCloudConfigPath(): string {
  return join(getJhtHome(), 'cloud.json')
}

export async function loadLocalCloudConfig(): Promise<LocalCloudConfig | null> {
  try {
    const raw = await readFile(getLocalCloudConfigPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<LocalCloudConfig>
    if (!parsed.enabled || !parsed.token || !parsed.base_url) return null
    return parsed as LocalCloudConfig
  } catch {
    return null
  }
}
