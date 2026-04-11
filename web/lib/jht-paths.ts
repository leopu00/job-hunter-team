/**
 * JHT paths — costanti condivise lato web.
 * Specchio di tui/src/tui-paths.ts. Se cambi uno, cambia anche l'altro.
 */
import os from 'os'
import path from 'path'

// Zona nascosta (override-abile via env var per test/e2e)
export const JHT_HOME = process.env.JHT_HOME || path.join(os.homedir(), '.jht')
export const JHT_CONFIG_PATH = path.join(JHT_HOME, 'jht.config.json')
export const JHT_DB_PATH = path.join(JHT_HOME, 'jobs.db')
export const JHT_PROFILE_DIR = path.join(JHT_HOME, 'profile')
export const JHT_PROFILE_YAML = path.join(JHT_PROFILE_DIR, 'candidate_profile.yml')
export const JHT_PROVIDER_CONFIG_PATH = path.join(JHT_PROFILE_DIR, 'jht.config.json')
export const JHT_AGENTS_DIR = path.join(JHT_HOME, 'agents')
export const JHT_LOGS_DIR = path.join(JHT_HOME, 'logs')
export const JHT_CREDENTIALS_DIR = path.join(JHT_HOME, 'credentials')

// Zona visibile (override-abile via env var per test/e2e)
export const JHT_USER_DIR = process.env.JHT_USER_DIR || path.join(os.homedir(), 'Documents', 'Job Hunter Team')
export const JHT_USER_CV_DIR = path.join(JHT_USER_DIR, 'cv')
export const JHT_USER_UPLOADS_DIR = path.join(JHT_USER_DIR, 'allegati')
export const JHT_USER_OUTPUT_DIR = path.join(JHT_USER_DIR, 'output')

export function getAgentDir(agentId: string, instance?: string): string {
  const sub = instance ? `${agentId}-${instance}` : agentId
  return path.join(JHT_AGENTS_DIR, sub)
}
