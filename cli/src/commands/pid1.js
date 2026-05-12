/**
 * `jht pid1` — container PID 1 dispatcher.
 *
 * Pensato come CMD del docker-compose: in base a JHT_HOST_TYPE decide
 * cosa far girare nel container.
 *
 *   vps   → `jht cloud daemon` (push loop verso jobhunterteam.ai). La
 *           dashboard locale non serve perche' la porta 3000 e' bindata
 *           a 127.0.0.1 sul VPS, irraggiungibile dall'utente.
 *
 *   local → `jht dashboard --no-browser` (comportamento storico). La
 *           dashboard gira su localhost:3000 dove l'utente la apre dal
 *           browser sul suo PC.
 *
 * Se cloud sync non e' configurato su un VPS, degrade graceful a
 * dashboard (cosi' l'utente puo' completare il setup dal terminale).
 *
 * Il sorgente di JHT_HOST_TYPE in ordine di priorita':
 *   1. env var (passato da docker-compose o dall'utente)
 *   2. /jht_home/host.env (scritto da scripts/host-setup.sh durante install)
 *   3. default `local` (sicuro: comportamento storico)
 */

import { readFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const JHT_ENTRY = '/app/cli/bin/jht.js';
const HOST_ENV_PATH = '/jht_home/host.env';

async function readHostType() {
  const fromEnv = (process.env.JHT_HOST_TYPE || '').trim().toLowerCase();
  if (fromEnv) return fromEnv;

  try {
    await access(HOST_ENV_PATH);
    const content = await readFile(HOST_ENV_PATH, 'utf-8');
    const m = /^JHT_HOST_TYPE=(.*)$/m.exec(content);
    if (m) return m[1].trim().toLowerCase();
  } catch {
    // file mancante e' normale (utente che salta host-setup)
  }
  return 'local';
}

/**
 * Verifica se il cloud sync e' configurato leggendo direttamente il file
 * cloud.json. Lo facciamo qui senza importare cloud.js per evitare side
 * effects di registrazione comandi.
 */
async function isCloudConfigured() {
  try {
    const content = await readFile('/jht_home/cloud.json', 'utf-8');
    const cfg = JSON.parse(content);
    return cfg?.enabled === true && typeof cfg?.token === 'string';
  } catch {
    return false;
  }
}

async function dispatch() {
  const hostType = await readHostType();
  const isVps = hostType === 'vps' || hostType === 'server' || hostType === 'remote';

  let cmd;
  let args;
  let modeLabel;

  if (isVps && (await isCloudConfigured())) {
    // VPS + cloud sync ON: gira il daemon di push come PID 1.
    cmd = process.execPath; // node
    args = [JHT_ENTRY, 'cloud', 'daemon'];
    modeLabel = 'VPS (cloud sync daemon)';
  } else {
    // local OR vps-not-yet-paired: dashboard come prima.
    // Su VPS senza pairing, l'utente lancia il wizard dalla TUI e il
    // pairing parte. Tenere la dashboard attiva qui evita che il
    // container muoia mentre lui fa il setup.
    cmd = process.execPath;
    args = [JHT_ENTRY, 'dashboard', '--no-browser'];
    modeLabel = isVps ? 'VPS (cloud sync non ancora configurato, fallback a dashboard)' : 'local (dashboard)';
  }

  console.log(`[pid1] mode: ${modeLabel}`);
  console.log(`[pid1] exec: ${cmd} ${args.join(' ')}`);

  const child = spawn(cmd, args, { stdio: 'inherit' });

  const forward = (sig) => {
    if (child && !child.killed) child.kill(sig);
  };
  process.on('SIGTERM', () => forward('SIGTERM'));
  process.on('SIGINT', () => forward('SIGINT'));

  child.on('exit', (code, signal) => {
    if (signal) {
      // Lascia che il processo padre erediti il segnale (exit code 128+sig)
      process.exit(128 + (signal === 'SIGTERM' ? 15 : signal === 'SIGINT' ? 2 : 0));
    }
    process.exit(code ?? 0);
  });
}

export function registerPid1Command(program) {
  program
    .command('pid1')
    .description('Container entrypoint: dispatch tra dashboard (local) e cloud daemon (vps)')
    .action(dispatch);
}
