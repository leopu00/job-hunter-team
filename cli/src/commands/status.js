import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { JHT_HOME } from '../jht-paths.js';
import { AGENTS, isAgentSession } from './team/agents.js';

const CONFIG_DIR = JHT_HOME;
const CONFIG_FILE = join(CONFIG_DIR, 'jht.config.json');

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function getTmuxSessions() {
  try {
    const output = execSync('tmux list-sessions -F "#{session_name}"', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

async function handleStatus() {
  console.log('\n  JHT — System Status\n');

  // Config
  const hasConfig = await fileExists(CONFIG_FILE);
  if (hasConfig) {
    const raw = await readFile(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(raw);
    const activeProvider = config.active_provider || 'non impostato';
    const provConfig = config.providers?.[config.active_provider];
    const model = provConfig?.model || 'non impostato';
    const auth = provConfig?.auth_method || 'non impostato';
    console.log(`  Config:    ${CONFIG_FILE}`);
    console.log(`  Provider:  ${activeProvider}`);
    console.log(`  Modello:   ${model}`);
    console.log(`  Auth:      ${auth}`);
    if (config.workspace) console.log(`  Workspace: ${config.workspace}`);
    const tgBots = config.channels?.telegram?.bots;
    if (tgBots?.assistente?.bot_token && tgBots?.capitano?.bot_token && tgBots?.mentor?.bot_token) {
      console.log('  Telegram: 3 bots configured');
    } else if (tgBots) {
      const n = ['assistente', 'capitano', 'mentor'].filter((r) => tgBots?.[r]?.bot_token).length;
      console.log(`  Telegram: incomplete (${n}/3 bot)`);
    }
  } else {
    console.log('  Config: not found (run: jht setup)');
  }

  // Tmux sessions
  const sessions = getTmuxSessions();
  // I container moderni usano CAPITANO / SCOUT-1 / ASSISTENTE, mentre il
  // vecchio path host antepone JHT-. Il filtro precedente riconosceva solo il
  // secondo formato e mostrava "0" dentro un team perfettamente operativo.
  const jhtSessions = sessions.filter(s =>
    s.startsWith('lab-') || AGENTS.some(agent => isAgentSession(s, agent))
  );
  console.log(`\n  Tmux Sessions JHT: ${jhtSessions.length}`);
  for (const s of jhtSessions) {
    console.log(`    - ${s}`);
  }

  // Git
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const shortSha = execSync('git rev-parse --short HEAD', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    console.log(`\n  Git:       ${branch} (${shortSha})`);
  } catch {
    console.log('\n  Git: not available');
  }

  console.log('');
}

export function registerStatusCommand(program) {
  program
    .command('status')
    .description('Show system status JHT')
    .action(handleStatus);
}
