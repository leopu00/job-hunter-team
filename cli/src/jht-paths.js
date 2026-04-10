/**
 * JHT paths — fonte unica per la CLI (plain JS ESM).
 * Specchio di shared/paths.ts e tui/src/tui-paths.ts.
 * Override via env var JHT_HOME e JHT_USER_DIR.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

// Zona nascosta
export const JHT_HOME = process.env.JHT_HOME || join(homedir(), '.jht');
export const JHT_CONFIG_PATH = join(JHT_HOME, 'jht.config.json');
export const JHT_DB_PATH = join(JHT_HOME, 'jobs.db');
export const JHT_PROFILE_DIR = join(JHT_HOME, 'profile');
export const JHT_AGENTS_DIR = join(JHT_HOME, 'agents');
export const JHT_LOGS_DIR = join(JHT_HOME, 'logs');
export const JHT_CREDENTIALS_DIR = join(JHT_HOME, 'credentials');

// Zona visibile
export const JHT_USER_DIR = process.env.JHT_USER_DIR || join(homedir(), 'Documents', 'Job Hunter Team');

export function getAgentDir(agentId, instance) {
  const sub = instance ? `${agentId}-${instance}` : agentId;
  return join(JHT_AGENTS_DIR, sub);
}
