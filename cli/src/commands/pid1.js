/**
 * `jht pid1` — container PID 1 dispatcher.
 *
 * Pensato come CMD del docker-compose: in base a JHT_HOST_TYPE decide
 * cosa far girare nel container.
 *
 *   vps + cloud paired → spawn DUAL: cloud daemon + dashboard
 *                        ↳ daemon pusha dati a jobhunterteam.ai ogni 30s
 *                        ↳ dashboard resta su 127.0.0.1:3000 cosi' l'utente
 *                          puo' accedervi via SSH tunnel
 *                          (`ssh -L 3000:localhost:3000 root@vps`) per
 *                          uploadare CV, vedere log live, ecc.
 *                          Lo scambio dati col cloud non passa dalla
 *                          dashboard, ma dal daemon — la dashboard e' solo
 *                          la UI di controllo locale.
 *
 *   vps senza cloud    → solo dashboard (fallback per onboarding wizard)
 *
 *   local              → solo dashboard (default storico)
 *
 * Il sorgente di JHT_HOST_TYPE in ordine di priorita':
 *   1. env var (passato da docker-compose o dall'utente)
 *   2. /jht_home/host.env (scritto da scripts/host-setup.sh durante install)
 *   3. default `local` (sicuro: comportamento storico)
 */

import { readFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';

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

/**
 * Spawn di un processo figlio con label prefisso sull'output (cosi' i log
 * di daemon e dashboard non si confondono dentro `docker logs jht`).
 * stdio='inherit' direttamente perderebbe l'identita'; usiamo pipe e
 * prefiggiamo ogni riga con il label.
 */
function spawnLabeled(label, cmd, args) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = `[${label}] `;
  const prefixStream = (stream, target) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk.toString('utf-8');
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) target.write(`${prefix}${line}\n`);
    });
    stream.on('end', () => {
      if (buf) target.write(`${prefix}${buf}\n`);
    });
  };
  prefixStream(child.stdout, process.stdout);
  prefixStream(child.stderr, process.stderr);
  return child;
}

async function dispatch() {
  const hostType = await readHostType();
  const isVps = hostType === 'vps' || hostType === 'server' || hostType === 'remote';
  const cloudPaired = await isCloudConfigured();

  const dashCmd = [JHT_ENTRY, 'dashboard', '--no-browser'];
  const daemonCmd = [JHT_ENTRY, 'cloud', 'daemon'];

  // Decide quali processi spawnare. Sempre almeno uno → PID 1 alive.
  const children = [];

  if (isVps && cloudPaired) {
    // Dual mode: daemon (push verso cloud) + dashboard (UI locale via tunnel).
    console.log('[pid1] mode: VPS dual (cloud daemon + local dashboard)');
    console.log('[pid1] dashboard accessibile via SSH tunnel: ssh -L 3000:localhost:3000 root@<vps>');
    children.push({ label: 'daemon', child: spawnLabeled('daemon', process.execPath, daemonCmd) });
    children.push({ label: 'dashboard', child: spawnLabeled('dashboard', process.execPath, dashCmd) });
  } else if (isVps && !cloudPaired) {
    // VPS senza pairing: solo dashboard (l'utente sta facendo il wizard).
    // Dopo il pairing un `jht down && jht up` switchera' a dual mode.
    console.log('[pid1] mode: VPS (pre-pairing fallback → dashboard only)');
    console.log('[pid1] dopo il pairing del wizard, esegui: jht down && jht up');
    children.push({ label: 'dashboard', child: spawn(process.execPath, dashCmd, { stdio: 'inherit' }) });
  } else {
    // Local: solo dashboard (comportamento storico).
    console.log('[pid1] mode: local (dashboard)');
    children.push({ label: 'dashboard', child: spawn(process.execPath, dashCmd, { stdio: 'inherit' }) });
  }

  // Forward SIGTERM/SIGINT a tutti i child per uno shutdown pulito
  // (docker stop manda SIGTERM, 10s grace, poi SIGKILL).
  let shuttingDown = false;
  const forwardSignal = (sig) => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const { child } of children) {
      if (child && !child.killed) child.kill(sig);
    }
  };
  process.on('SIGTERM', () => forwardSignal('SIGTERM'));
  process.on('SIGINT', () => forwardSignal('SIGINT'));

  // Quando un child muore in dual mode, killiamo l'altro e usciamo con
  // l'exit code del primo morto. Senza questo, daemon che crasha lascia
  // dashboard zombie (e viceversa) finche' docker stop non interviene.
  let exited = false;
  const onChildExit = (label) => (code, signal) => {
    if (exited) return;
    exited = true;
    console.log(`[pid1] child '${label}' uscito (code=${code}, signal=${signal})`);
    // Killa eventuali sibling
    for (const c of children) {
      if (c.label !== label && c.child && !c.child.killed) c.child.kill('SIGTERM');
    }
    if (signal) {
      process.exit(128 + (signal === 'SIGTERM' ? 15 : signal === 'SIGINT' ? 2 : 0));
    }
    process.exit(code ?? 0);
  };
  for (const { label, child } of children) {
    child.on('exit', onChildExit(label));
  }
}

export function registerPid1Command(program) {
  program
    .command('pid1')
    .description('Container entrypoint: dual dashboard+daemon (vps paired) o solo dashboard (local)')
    .action(dispatch);
}
