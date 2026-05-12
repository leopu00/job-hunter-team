/**
 * `jht pid1` — container PID 1 dispatcher con hot-reload del cloud daemon.
 *
 * Pensato come CMD del docker-compose: in base a JHT_HOST_TYPE decide
 * cosa far girare nel container.
 *
 *   vps + cloud paired → dashboard + cloud daemon
 *                        ↳ daemon pusha dati a jobhunterteam.ai ogni 30s
 *                        ↳ dashboard resta su 127.0.0.1:3000 cosi' l'utente
 *                          puo' accedervi via SSH tunnel
 *                          (`ssh -L 3000:localhost:3000 root@vps`)
 *
 *   vps senza cloud    → solo dashboard, finche' non appare cloud.json:
 *                        un watcher su $JHT_HOME/cloud.json fa partire il
 *                        daemon non appena il pairing viene completato dal
 *                        wizard, SENZA richiedere `jht down && jht up`.
 *                        Idem in caso di unpairing (`jht cloud disable`):
 *                        kill del daemon, dashboard intatta.
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
import { watch } from 'node:fs';
import { dirname } from 'node:path';

const JHT_ENTRY = '/app/cli/bin/jht.js';
const JHT_HOME = '/jht_home';
const HOST_ENV_PATH = `${JHT_HOME}/host.env`;
const CLOUD_JSON_PATH = `${JHT_HOME}/cloud.json`;

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
    const content = await readFile(CLOUD_JSON_PATH, 'utf-8');
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

function pid1Log(msg) {
  console.log(`[pid1] ${msg}`);
}

async function dispatch() {
  const hostType = await readHostType();
  const isVps = hostType === 'vps' || hostType === 'server' || hostType === 'remote';

  const dashCmd = [JHT_ENTRY, 'dashboard', '--no-browser'];
  const daemonCmd = [JHT_ENTRY, 'cloud', 'daemon'];

  // ── Dashboard: lifetime = container, parte sempre.
  pid1Log(isVps ? 'mode: VPS' : 'mode: local');
  pid1Log('starting dashboard (127.0.0.1:3000)');
  const dashboardChild = spawnLabeled('dashboard', process.execPath, dashCmd);

  // ── Daemon: opzionale, hot-reloadable su cambio cloud.json.
  let daemonChild = null;
  let daemonRespawnTimer = null;
  let shuttingDown = false;

  const startDaemon = () => {
    if (daemonChild && !daemonChild.killed) return;  // gia' attivo
    pid1Log('starting cloud daemon (push ogni 30s verso jobhunterteam.ai)');
    daemonChild = spawnLabeled('daemon', process.execPath, daemonCmd);
    daemonChild.on('exit', (code, signal) => {
      const exitedChild = daemonChild;
      daemonChild = null;
      if (shuttingDown) return;
      pid1Log(`cloud daemon exited (code=${code} signal=${signal})`);
      // Auto-restart se cloud e' ancora configurato (crash recovery).
      // Debounce 5s per evitare crash-loop tight.
      if (daemonRespawnTimer) clearTimeout(daemonRespawnTimer);
      daemonRespawnTimer = setTimeout(async () => {
        if (shuttingDown) return;
        if (await isCloudConfigured()) {
          pid1Log('daemon respawn dopo crash');
          startDaemon();
        }
      }, 5000);
      void exitedChild;  // shut lint up
    });
  };

  const stopDaemon = (reason) => {
    if (daemonRespawnTimer) {
      clearTimeout(daemonRespawnTimer);
      daemonRespawnTimer = null;
    }
    if (daemonChild && !daemonChild.killed) {
      pid1Log(`stopping cloud daemon (${reason})`);
      daemonChild.kill('SIGTERM');
    }
  };

  // Stato iniziale del cloud: se gia' paired, daemon parte subito.
  if (isVps && await isCloudConfigured()) {
    startDaemon();
  } else if (isVps) {
    pid1Log('cloud sync non ancora configurato: aspetto cloud.json (auto-start dopo pairing)');
  }

  // ── Watcher su cloud.json: hot-reload del daemon al pairing/unpairing.
  // Solo su VPS — su local non ha senso (non c'e' un wizard di pairing).
  if (isVps) {
    let lastConfigured = await isCloudConfigured();
    // fs.watch su directory: piu' robusto di fs.watch su file inesistente,
    // dato che cloud.json viene creato DOPO il pairing (file mancante al
    // boot). Filtra eventi sul solo cloud.json.
    let watcher = null;
    try {
      watcher = watch(dirname(CLOUD_JSON_PATH), { persistent: true }, async (eventType, filename) => {
        if (filename !== 'cloud.json') return;
        // Debounce: piu' eventi rename/change ravvicinati sul write.
        await new Promise((r) => setTimeout(r, 250));
        const nowConfigured = await isCloudConfigured();
        if (nowConfigured === lastConfigured) return;
        lastConfigured = nowConfigured;
        if (nowConfigured) {
          pid1Log('cloud.json rilevato: avvio cloud daemon');
          startDaemon();
        } else {
          stopDaemon('cloud.json rimosso o disabilitato');
        }
      });
    } catch (err) {
      pid1Log(`watch fallito (${err.message}) — daemon hot-reload disabilitato`);
    }
    // Cleanup watcher allo shutdown
    process.on('exit', () => { if (watcher) watcher.close(); });
  }

  // ── Shutdown forwarding: docker stop manda SIGTERM, 10s grace.
  const forwardSignal = (sig) => {
    if (shuttingDown) return;
    shuttingDown = true;
    pid1Log(`shutdown (${sig}): killing children`);
    if (daemonChild && !daemonChild.killed) daemonChild.kill(sig);
    if (dashboardChild && !dashboardChild.killed) dashboardChild.kill(sig);
  };
  process.on('SIGTERM', () => forwardSignal('SIGTERM'));
  process.on('SIGINT', () => forwardSignal('SIGINT'));

  // ── Dashboard exit = container exit. Se la dashboard crasha, l'utente
  // non puo' piu' interagire — meglio uscire e farsi restartare da docker.
  dashboardChild.on('exit', (code, signal) => {
    if (shuttingDown) return;
    pid1Log(`dashboard exited (code=${code} signal=${signal}) — exit pid1`);
    shuttingDown = true;
    if (daemonChild && !daemonChild.killed) daemonChild.kill('SIGTERM');
    if (signal) {
      process.exit(128 + (signal === 'SIGTERM' ? 15 : signal === 'SIGINT' ? 2 : 0));
    }
    process.exit(code ?? 0);
  });
}

export function registerPid1Command(program) {
  program
    .command('pid1')
    .description('Container entrypoint: dashboard (sempre) + cloud daemon (auto-start su VPS quando cloud.json appare)')
    .action(dispatch);
}
