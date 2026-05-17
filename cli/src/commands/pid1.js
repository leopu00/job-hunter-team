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
const JHT_CONFIG_PATH = `${JHT_HOME}/jht.config.json`;
const PAIRING_TOKEN_PATH = `${JHT_HOME}/.pairing-token`;
const TG_BRIDGE_LAUNCHER = '/app/.launcher/start-agent.sh';
const AGENT_WATCHDOG_SCRIPT = '/app/.launcher/agent-watchdog.sh';
const DOCTOR_WATCHDOG_SCRIPT = '/app/.launcher/doctor-watchdog.sh';
const WELCOME_SEND_SCRIPT = '/app/.launcher/welcome-send.sh';

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
 * Verifica se ci sono bot Telegram configurati in jht.config.json.
 * Il tg-bridge serve a inoltrare i messaggi Telegram → tmux degli agenti
 * (assistente, capitano, mentor). Senza bot configurati, niente bridge.
 */
async function hasTelegramBotsConfigured() {
  try {
    const raw = await readFile(JHT_CONFIG_PATH, 'utf-8');
    const cfg = JSON.parse(raw);
    const bots = cfg?.channels?.telegram?.bots;
    if (!bots || typeof bots !== 'object') return false;
    return Object.values(bots).some(
      (b) => b && typeof b.bot_token === 'string' && b.bot_token.trim().length > 0,
    );
  } catch {
    return false;
  }
}

/**
 * Spawna il tg-bridge (3 process python long-poll, uno per ogni bot user-
 * facing). Idempotente: lo script killa istanze esistenti prima di
 * rispawn, così la chiamata ripetuta non duplica i process. Non rimane
 * un child pid1: i 3 python sono detached via setsid e vivono per conto
 * loro, pid1 li trova via /proc cmdline scan allo shutdown per pulirli.
 */
function startTgBridge() {
  pid1Log('starting tg-bridge (Telegram → tmux long-poll, 3 bots)');
  const child = spawnLabeled('tg-bridge-launcher', '/bin/bash', [
    TG_BRIDGE_LAUNCHER,
    'tg-bridge',
  ]);
  child.on('exit', (code) => {
    if (code === 0) {
      pid1Log('tg-bridge bootstrap OK (3 process detached)');
    } else {
      pid1Log(`tg-bridge bootstrap fallito (exit ${code}): messaggi Telegram non arriveranno`);
    }
  });
}

/**
 * Verifica se active_provider è configurato in jht.config.json. Senza
 * di esso, start-agent.sh cade nel default 'claude' (non installato) →
 * exit 1, agenti non partono.
 */
async function hasActiveProviderConfigured() {
  try {
    const raw = await readFile(JHT_CONFIG_PATH, 'utf-8');
    const cfg = JSON.parse(raw);
    const provider = cfg?.active_provider;
    return typeof provider === 'string' && provider.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Verifica che il provider attivo abbia credenziali OAuth valide. Senza
 * questa gate, gli agenti partono in "LLM not set" se l'utente non ha
 * ancora completato OAuth nel wizard terminal embedded (caso visto
 * 2026-05-16: watchdog spawnava agenti tra il lancio kimi --yolo e il
 * completamento OAuth, durante la finestra di ~30s in cui kimi.json
 * non esisteva ancora).
 *
 * Pattern: ogni provider ha un file marker che esiste solo dopo OAuth.
 */
async function hasProviderCredentials() {
  try {
    const raw = await readFile(JHT_CONFIG_PATH, 'utf-8');
    const cfg = JSON.parse(raw);
    const provider = (cfg?.active_provider || '').toString().toLowerCase();
    const markers = {
      kimi: `${JHT_HOME}/.kimi/kimi.json`,
      claude: `${JHT_HOME}/.claude/.credentials.json`,
      codex: `${JHT_HOME}/.codex/auth.json`,
    };
    const marker = markers[provider];
    if (!marker) return false;
    await access(marker);
    return true;
  } catch {
    return false;
  }
}

/**
 * Auto-start dei 3 agenti user-facing (assistente, capitano, mentor)
 * post-wizard. Lanciati in sequenza con 3s di delay tra uno e l'altro
 * per evitare race su tmux server / kimi CLI boot. Idempotente: se la
 * session esiste già, `jht team start <agente>` la skippa con "gia attivo".
 *
 * Triggering condition: ci sono bot Telegram configurati + active_provider
 * impostato. Senza entrambi non c'è modo per gli agenti di funzionare.
 *
 * NB: I 3 agenti spawnati restano UP per tutta la vita del container.
 * Niente cleanup esplicito a SIGTERM (tmux kill-server è troppo brutto).
 * Al prossimo boot del container `jht team start` rileva session già
 * attive e skippa, idempotente.
 */
async function startUserFacingAgents() {
  const agents = ['assistente', 'capitano', 'mentor'];
  pid1Log(`auto-start agenti user-facing (${agents.join(', ')})`);
  for (const role of agents) {
    await new Promise((resolve) => {
      const child = spawnLabeled(`autostart-${role}`, process.execPath, [
        JHT_ENTRY,
        'team',
        'start',
        role,
      ]);
      child.on('exit', (code) => {
        if (code === 0) {
          pid1Log(`auto-start ${role}: OK`);
        } else {
          pid1Log(`auto-start ${role}: fallito (exit ${code}) — utente potrà cliccare Avvia dalla dashboard`);
        }
        resolve();
      });
      child.on('error', (err) => {
        pid1Log(`auto-start ${role}: spawn error ${err.message}`);
        resolve();
      });
    });
    // Pre-delay 3s tra agenti per stabilizzare tmux + kimi CLI boot.
    await new Promise((r) => setTimeout(r, 3000));
  }
}

function stopTgBridge() {
  // I tg-bridge.py sono detached: kill via pgrep+kill in spawn separato.
  // Su SIGTERM del container abbiamo ~10s grace, basta abbondantemente.
  try {
    const killer = spawn('/bin/sh', [
      '-c',
      "for pid in $(grep -l tg-bridge.py /proc/[0-9]*/cmdline 2>/dev/null | sed 's|/proc/||;s|/cmdline||'); do kill -TERM \"$pid\" 2>/dev/null || true; done",
    ], { stdio: 'ignore' });
    killer.unref();
  } catch { /* best-effort cleanup */ }
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

/**
 * Esegue `jht cloud pair` (no-watch) UNA volta al boot, in modo bloccante.
 * Gira solo se:
 *   - host type = vps
 *   - .pairing-token esiste
 *   - cloud.json NON esiste (handlePair stesso e' idempotente, ma evitiamo
 *     anche solo lo spawn nei boot ripetuti senza re-install)
 *
 * Il successo del pair fa apparire cloud.json → il watcher esistente fara'
 * partire il daemon. Il fallimento NON blocca il boot: pid1 continua a
 * partire la dashboard, l'utente puo' diagnosticare via `jht cloud pair`
 * a mano dal terminale embedded del desktop.
 */
async function maybeRunPairing() {
  let hasPairingToken = false;
  let hasCloudJson = false;
  try { await access(PAIRING_TOKEN_PATH); hasPairingToken = true; } catch { /* missing */ }
  try { await access(CLOUD_JSON_PATH); hasCloudJson = true; } catch { /* missing */ }

  if (!hasPairingToken) return;
  if (hasCloudJson) {
    // pid1 boot dopo che il pair e' stato fatto in un boot precedente:
    // .pairing-token dovrebbe gia' essere stato cancellato da handlePair
    // (one-shot). Se e' ancora qui e' un residuo: rimuovilo per non lasciare
    // un refresh_token sul disco.
    pid1Log('cloud.json gia\' presente: rimuovo .pairing-token residuo');
    try { await import('node:fs').then((m) => m.promises.unlink(PAIRING_TOKEN_PATH)); } catch { /* best-effort */ }
    return;
  }

  pid1Log('pairing-token rilevato: eseguo jht cloud pair (one-shot)');
  await new Promise((resolve) => {
    const child = spawn(process.execPath, [JHT_ENTRY, 'cloud', 'pair'], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.on('exit', (code) => {
      if (code === 0) {
        pid1Log('cloud pair OK');
      } else {
        pid1Log(`cloud pair fallito (exit ${code}): proseguo, retry manuale via 'jht cloud pair'`);
      }
      resolve();
    });
    child.on('error', (err) => {
      pid1Log(`cloud pair spawn error: ${err.message}`);
      resolve();
    });
  });
}

async function dispatch() {
  const hostType = await readHostType();
  const isVps = hostType === 'vps' || hostType === 'server' || hostType === 'remote';

  // Pair non-interattivo PRIMA di partire dashboard+daemon: cosi' il watcher
  // su cloud.json non scatta a vuoto e il daemon parte subito col token
  // appena mintato. Su local non ha senso (no install.sh con --pairing-token).
  if (isVps) {
    await maybeRunPairing();
  }

  const dashCmd = [JHT_ENTRY, 'dashboard', '--no-browser'];
  const daemonCmd = [JHT_ENTRY, 'cloud', 'daemon'];
  const realtimeCmd = [JHT_ENTRY, 'cloud', 'realtime-listen'];

  // ── Dashboard: lifetime = container, parte sempre.
  pid1Log(isVps ? 'mode: VPS' : 'mode: local');
  pid1Log('starting dashboard (127.0.0.1:3000)');
  const dashboardChild = spawnLabeled('dashboard', process.execPath, dashCmd);

  // ── Telegram bridge: long-poll Bot API → tmux corrispondente. Parte
  // sempre al boot se ci sono bot configurati (decisione 2026-05-16:
  // "il tg-bridge deve essere sempre attivo, parte col container").
  // Senza, l'utente Telegram → assistente non riceve nulla anche se
  // tmux ASSISTENTE è up.
  const hasBots = await hasTelegramBotsConfigured();
  if (hasBots) {
    startTgBridge();
  } else {
    pid1Log('tg-bridge: nessun bot in jht.config.json, skip');
  }

  // ── Welcome iniziale dei 3 bot Telegram (script bash deterministico,
  // niente LLM). Trigger: bot configurati. Idempotente: per ogni ruolo
  // verifica il proprio flag prima di mandare. Necessario perché kimi-cli
  // ha un bug di OAuth-per-work-dir (2026-05-16) che impedisce agli
  // agenti di mandare il welcome al primo boot — lo script bypassa il
  // problema per il messaggio iniziale di benvenuto, separato dal
  // funzionamento runtime degli agenti.
  if (hasBots) {
    spawn('/bin/bash', [WELCOME_SEND_SCRIPT], { stdio: 'inherit' })
      .on('exit', (code) => {
        if (code === 0) pid1Log('welcome-send: ok');
        else pid1Log(`welcome-send: exit ${code} (errori per ruoli specifici loggati a logs/welcome-send.log)`);
      });
  }

  // ── Auto-start agenti user-facing (assistente/capitano/mentor) post-
  // wizard. Trigger composto:
  //   1. bot Telegram configurati (wizard step T4)
  //   2. active_provider in jht.config.json (wizard saveProviderToVps)
  //   3. credenziali OAuth del provider presenti (utente ha completato
  //      `kimi --yolo` / claude login / codex login nel terminal embedded)
  // Se (3) manca, gli agenti partono con "LLM not set" e restano idle —
  // ci pensa il watchdog a relanciarli quando il file marker apparirà.
  // Async (no await) per non bloccare il boot di pid1.
  if (
    hasBots &&
    (await hasActiveProviderConfigured()) &&
    (await hasProviderCredentials())
  ) {
    startUserFacingAgents().catch((err) =>
      pid1Log(`auto-start agenti crashed: ${err.message}`),
    );
  } else if (hasBots && (await hasActiveProviderConfigured())) {
    pid1Log('auto-start agenti rinviato: provider OAuth non ancora completato (watchdog provvederà)');
  }

  // ── Shutdown gate (usato anche da watchdog respawn). Definito qui
  // perché il watchdog parte sopra il daemon/realtime block.
  let shuttingDown = false;

  // ── Agent watchdog: tick ogni 30s, se una tmux user-facing manca la
  // rilancia. Spawnato come child long-running con respawn-on-crash.
  // Complementare al dottore LLM (che ragiona alto livello ogni 30min):
  // questo è il "session morta → relancia" deterministico, sub-second
  // decision, no LLM.
  let watchdogChild = null;
  let watchdogRespawnTimer = null;
  const startAgentWatchdog = () => {
    if (watchdogChild && !watchdogChild.killed) return;
    pid1Log('starting agent-watchdog (tmux session-level, tick 30s)');
    watchdogChild = spawnLabeled('watchdog', '/bin/bash', [AGENT_WATCHDOG_SCRIPT]);
    watchdogChild.on('exit', (code, signal) => {
      const exited = watchdogChild;
      watchdogChild = null;
      if (shuttingDown) return;
      pid1Log(`agent-watchdog exited (code=${code} signal=${signal})`);
      if (watchdogRespawnTimer) clearTimeout(watchdogRespawnTimer);
      watchdogRespawnTimer = setTimeout(() => {
        if (!shuttingDown) {
          pid1Log('agent-watchdog respawn dopo crash');
          startAgentWatchdog();
        }
      }, 5000);
      void exited;
    });
  };
  startAgentWatchdog();

  // ── Doctor watchdog: loop bash che ogni 30 min spawna una sessione
  // tmux DOTTORE (one-shot LLM ~30 min, prune cache + py-audit + liveness
  // check). Regressione storica: introdotto 2026-05-08 (commit d4bb2ca2)
  // e poi perso al rebuild perché esisteva solo come `tmux new-session`
  // manuale. Pattern identico ad agent-watchdog ma cadenza interna allo
  // script (sleep 1800s). Vedi docs/internal/2026-05-17-team-strategy-bugs.md §18.
  let doctorWatchdogChild = null;
  let doctorWatchdogRespawnTimer = null;
  const startDoctorWatchdog = () => {
    if (doctorWatchdogChild && !doctorWatchdogChild.killed) return;
    pid1Log('starting doctor-watchdog (auto-spawn DOTTORE ogni 30min)');
    doctorWatchdogChild = spawnLabeled('doctor-watchdog', '/bin/bash', [DOCTOR_WATCHDOG_SCRIPT]);
    doctorWatchdogChild.on('exit', (code, signal) => {
      const exited = doctorWatchdogChild;
      doctorWatchdogChild = null;
      if (shuttingDown) return;
      pid1Log(`doctor-watchdog exited (code=${code} signal=${signal})`);
      if (doctorWatchdogRespawnTimer) clearTimeout(doctorWatchdogRespawnTimer);
      doctorWatchdogRespawnTimer = setTimeout(() => {
        if (!shuttingDown) {
          pid1Log('doctor-watchdog respawn dopo crash');
          startDoctorWatchdog();
        }
      }, 5000);
      void exited;
    });
  };
  startDoctorWatchdog();

  // ── Daemon push + Realtime subscriber: entrambi opzionali, gated da
  // cloud paired. Stessa logica di lifecycle (start/stop/respawn).
  let daemonChild = null;
  let realtimeChild = null;
  let daemonRespawnTimer = null;
  let realtimeRespawnTimer = null;

  const startDaemon = () => {
    if (daemonChild && !daemonChild.killed) return;
    pid1Log('starting cloud daemon (push ogni 30s verso jobhunterteam.ai)');
    daemonChild = spawnLabeled('daemon', process.execPath, daemonCmd);
    daemonChild.on('exit', (code, signal) => {
      const exitedChild = daemonChild;
      daemonChild = null;
      if (shuttingDown) return;
      pid1Log(`cloud daemon exited (code=${code} signal=${signal})`);
      if (daemonRespawnTimer) clearTimeout(daemonRespawnTimer);
      daemonRespawnTimer = setTimeout(async () => {
        if (shuttingDown) return;
        if (await isCloudConfigured()) {
          pid1Log('daemon respawn dopo crash');
          startDaemon();
        }
      }, 5000);
      void exitedChild;
    });
  };

  // Realtime subscriber: WebSocket subscriber su team_commands. Riceve
  // comandi web e exec `jht team start/stop`. Stesso crash-recovery
  // del daemon (debounce 5s).
  const startRealtime = () => {
    if (realtimeChild && !realtimeChild.killed) return;
    pid1Log('starting realtime subscriber (team_commands WS)');
    realtimeChild = spawnLabeled('realtime', process.execPath, realtimeCmd);
    realtimeChild.on('exit', (code, signal) => {
      const exitedChild = realtimeChild;
      realtimeChild = null;
      if (shuttingDown) return;
      pid1Log(`realtime subscriber exited (code=${code} signal=${signal})`);
      if (realtimeRespawnTimer) clearTimeout(realtimeRespawnTimer);
      realtimeRespawnTimer = setTimeout(async () => {
        if (shuttingDown) return;
        if (await isCloudConfigured()) {
          pid1Log('realtime subscriber respawn dopo crash');
          startRealtime();
        }
      }, 5000);
      void exitedChild;
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
    if (realtimeRespawnTimer) {
      clearTimeout(realtimeRespawnTimer);
      realtimeRespawnTimer = null;
    }
    if (realtimeChild && !realtimeChild.killed) {
      pid1Log(`stopping realtime subscriber (${reason})`);
      realtimeChild.kill('SIGTERM');
    }
  };

  // Stato iniziale del cloud: se gia' paired, daemon + realtime partono.
  if (isVps && await isCloudConfigured()) {
    startDaemon();
    startRealtime();
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
          pid1Log('cloud.json rilevato: avvio cloud daemon + realtime subscriber');
          startDaemon();
          startRealtime();
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
    if (realtimeChild && !realtimeChild.killed) realtimeChild.kill(sig);
    if (dashboardChild && !dashboardChild.killed) dashboardChild.kill(sig);
    if (watchdogChild && !watchdogChild.killed) watchdogChild.kill(sig);
    if (watchdogRespawnTimer) clearTimeout(watchdogRespawnTimer);
    if (doctorWatchdogChild && !doctorWatchdogChild.killed) doctorWatchdogChild.kill(sig);
    if (doctorWatchdogRespawnTimer) clearTimeout(doctorWatchdogRespawnTimer);
    stopTgBridge();
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
