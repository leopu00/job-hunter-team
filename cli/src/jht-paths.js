/**
 * JHT paths — fonte unica per la CLI (plain JS ESM).
 * Specchio di shared/paths.ts e tui/src/tui-paths.ts.
 * Override via env var JHT_HOME e JHT_USER_DIR.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Guard against Windows-style paths leaking into a POSIX context.
 * On WSL / git-bash / Linux containers, node's path.join treats `C:\...`
 * as a relative path and silently builds a literal `<cwd>/C:/...` tree
 * — exactly what produced the `web/C:/Users/.../CLAUDE.md` cruft on
 * 2026-03-27. Fail fast with a helpful message instead.
 */
function assertPosixSafe(value, name) {
  if (!value) return;
  const looksWindows = /^[a-zA-Z]:[\\/]/.test(value) || value.includes('\\');
  if (looksWindows && process.platform !== 'win32') {
    throw new Error(
      `${name}=${JSON.stringify(value)} looks like a Windows path but we're running on ${process.platform}. ` +
      `On WSL / Linux / containers, use a POSIX path (e.g. /mnt/c/Users/... or /jht_home).`
    );
  }
}
assertPosixSafe(process.env.JHT_HOME, 'JHT_HOME');
assertPosixSafe(process.env.JHT_USER_DIR, 'JHT_USER_DIR');

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
