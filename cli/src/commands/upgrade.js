import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM    = '\x1b[90m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

function getRepoRoot() {
  try { return execSync('git rev-parse --show-toplevel 2>/dev/null', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim(); }
  catch { return null; }
}

async function getCurrentVersion() {
  // Prova package.json del progetto
  const root = getRepoRoot();
  if (root) {
    try {
      const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf-8'));
      return pkg.version ?? '0.0.0';
    } catch { /* skip */ }
  }
  // Fallback al package.json del CLI
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(await readFile(join(__dirname, '..', '..', 'package.json'), 'utf-8'));
    return pkg.version ?? '0.0.0';
  } catch { return '0.0.0'; }
}

function getCurrentCommit() {
  try { return execSync('git rev-parse --short HEAD 2>/dev/null', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim(); }
  catch { return null; }
}

function getCurrentBranch() {
  try { return execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim(); }
  catch { return null; }
}

function getRemoteCommits() {
  try {
    execSync('git fetch origin --quiet 2>/dev/null', { stdio: ['pipe', 'pipe', 'pipe'] });
    const branch = getCurrentBranch();
    if (!branch) return null;
    const count = execSync(`git rev-list HEAD..origin/${branch} --count 2>/dev/null`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return parseInt(count, 10) || 0;
  } catch { return null; }
}

async function handleUpgrade(options) {
  console.log(`\n  ${BOLD}JHT — Upgrade${RESET}\n`);

  const version = await getCurrentVersion();
  const commit = getCurrentCommit();
  const branch = getCurrentBranch();

  console.log(`  ${DIM}Versione:${RESET}  ${version}`);
  console.log(`  ${DIM}Branch:${RESET}    ${branch ?? 'sconosciuto'}`);
  console.log(`  ${DIM}Commit:${RESET}    ${commit ?? 'sconosciuto'}`);

  if (options.check || !options.apply) {
    console.log(`\n  ${DIM}Controllo aggiornamenti...${RESET}`);
    const behind = getRemoteCommits();

    if (behind === null) {
      console.log(`  ${YELLOW}Impossibile contattare il remote.${RESET}\n`);
      return;
    }

    if (behind === 0) {
      console.log(`  ${GREEN}Già aggiornato — nessun update disponibile.${RESET}\n`);
      return;
    }

    console.log(`  ${YELLOW}${behind} commit disponibili su origin/${branch}.${RESET}`);
    if (!options.apply) {
      console.log(`\n  ${DIM}Per aggiornare: jht upgrade --apply${RESET}\n`);
      return;
    }
  }

  if (options.apply) {
    const root = getRepoRoot();
    if (!root) {
      console.error('  Non in un repository git.');
      process.exitCode = 1;
      return;
    }

    console.log(`\n  ${DIM}Aggiornamento in corso...${RESET}`);
    try {
      execSync('git pull --ff-only 2>&1', { cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      console.log(`  ${GREEN}✓ Codice aggiornato${RESET}`);
    } catch (e) {
      console.error(`  \x1b[31m✗ git pull fallito: ${e.message.split('\n')[0]}\x1b[0m`);
      process.exitCode = 1;
      return;
    }

    // Reinstalla dipendenze se necessario
    try {
      console.log(`  ${DIM}Installazione dipendenze...${RESET}`);
      execSync('npm install --silent 2>&1', { cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      console.log(`  ${GREEN}✓ Dipendenze aggiornate${RESET}`);
    } catch {
      console.log(`  ${YELLOW}! npm install fallito — prova manualmente${RESET}`);
    }

    const newCommit = getCurrentCommit();
    const newVersion = await getCurrentVersion();
    console.log(`\n  ${GREEN}Aggiornamento completato: ${version} → ${newVersion} (${newCommit})${RESET}\n`);
  }
}

export function registerUpgradeCommand(program) {
  program
    .command('upgrade')
    .description('Controlla e applica aggiornamenti')
    .option('-c, --check', 'solo controlla se ci sono aggiornamenti')
    .option('-a, --apply', 'applica aggiornamento (git pull + npm install)')
    .action(handleUpgrade);
}
