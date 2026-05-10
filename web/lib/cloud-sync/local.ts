import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function getJhtHome(): string {
  return process.env.JHT_HOME || join(homedir(), '.jht')
}

export function getLocalDbPath(): string {
  return join(getJhtHome(), 'jobs.db')
}

export async function localDbExists(): Promise<boolean> {
  try {
    await stat(getLocalDbPath())
    return true
  } catch {
    return false
  }
}
