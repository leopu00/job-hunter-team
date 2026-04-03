import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const CONFIG_DIR = join(process.env.HOME || '', '.jht');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

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
  console.log('\n  JHT — Stato Sistema\n');

  // Config
  const hasConfig = await fileExists(CONFIG_FILE);
  if (hasConfig) {
    const raw = await readFile(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(raw);
    console.log(`  Config:    ${CONFIG_FILE}`);
    console.log(`  Provider:  ${config.provider || 'non impostato'}`);
    console.log(`  Modello:   ${config.model || 'non impostato'}`);
  } else {
    console.log('  Config:    non trovata (esegui: jht setup)');
  }

  // Tmux sessions
  const sessions = getTmuxSessions();
  const jhtSessions = sessions.filter(s => s.startsWith('JHT-') || s.startsWith('lab-'));
  console.log(`\n  Sessioni tmux JHT: ${jhtSessions.length}`);
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
    console.log('\n  Git:       non disponibile');
  }

  console.log('');
}

export function registerStatusCommand(program) {
  program
    .command('status')
    .description('Mostra lo stato del sistema JHT')
    .action(handleStatus);
}
