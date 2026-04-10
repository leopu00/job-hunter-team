// Definizione agenti e utility condivise per i comandi team
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path fissi JHT (specchio di tui/src/tui-paths.ts)
export const JHT_HOME = join(homedir(), '.jht');
export const JHT_CONFIG_PATH = join(JHT_HOME, 'jht.config.json');
export const JHT_DB_PATH = join(JHT_HOME, 'jobs.db');
export const JHT_AGENTS_DIR = join(JHT_HOME, 'agents');
export const JHT_USER_DIR = join(homedir(), 'Documents', 'Job Hunter Team');

export const AGENTS = [
  { role: 'alfa',       prefix: 'ALFA',       multi: false, effort: 'high',   desc: 'Coordinatore pipeline Job Hunter' },
  { role: 'scout',      prefix: 'SCOUT',      multi: true,  effort: 'high',   desc: 'Cerca posizioni lavorative' },
  { role: 'analista',   prefix: 'ANALISTA',    multi: true,  effort: 'high',   desc: 'Analizza job description e aziende' },
  { role: 'scorer',     prefix: 'SCORER',      multi: true,  effort: 'medium', desc: 'Calcola punteggio match' },
  { role: 'scrittore',  prefix: 'SCRITTORE',   multi: true,  effort: 'high',   desc: 'Scrive CV e cover letter' },
  { role: 'critico',    prefix: 'CRITICO',     multi: false, effort: 'high',   desc: 'Revisione qualita CV' },
  { role: 'sentinella', prefix: 'SENTINELLA',  multi: false, effort: 'low',    desc: 'Monitora token usage e rate limit' },
  { role: 'assistente', prefix: 'ASSISTENTE',  multi: false, effort: 'medium', desc: 'Aiuta utente a navigare la piattaforma' },
];

export const DEFAULT_TEAM = ['alfa', 'scout:1', 'analista:1', 'scorer:1', 'scrittore:1', 'critico', 'sentinella'];

export const c = {
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
};

export function tmuxAvailable() {
  try { execSync('command -v tmux', { stdio: 'ignore' }); return true; }
  catch { return false; }
}

export function claudeAvailable() {
  try { execSync('command -v claude', { stdio: 'ignore' }); return true; }
  catch { return false; }
}

export function getActiveSessions() {
  try {
    const out = execSync('tmux list-sessions -F "#{session_name}" 2>/dev/null', { encoding: 'utf8' });
    return out.trim().split('\n').filter(Boolean);
  } catch { return []; }
}

export function sessionName(role, instance) {
  const agent = AGENTS.find((a) => a.role === role);
  if (!agent) return null;
  if (agent.multi && instance) return `JHT-${agent.prefix}-${instance}`;
  return `JHT-${agent.prefix}`;
}

export function isSessionActive(name) {
  return getActiveSessions().includes(name);
}

export function parseAgentArg(arg) {
  const lower = arg.toLowerCase();
  const match = lower.match(/^([a-z]+)[-:]?(\d+)?$/);
  if (!match) return null;
  const [, role, inst] = match;
  const agent = AGENTS.find((a) => a.role === role);
  if (!agent) return null;
  return { role, instance: agent.multi ? (inst || '1') : null };
}

export function resolveConfig() {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    dir = dirname(dir);
    if (existsSync(join(dir, '.launcher', 'config.sh'))) {
      return { repoRoot: dir, launcherDir: join(dir, '.launcher') };
    }
  }
  return { repoRoot: null, launcherDir: null };
}

/** Cartella visibile all'utente (dove drop CV e output) */
export function getWorkspace() {
  return JHT_USER_DIR;
}

/** Cartella nascosta dove girano gli agenti */
export function getAgentDir(role, instance) {
  const sub = instance ? `${role}-${instance}` : role;
  return join(JHT_AGENTS_DIR, sub);
}
