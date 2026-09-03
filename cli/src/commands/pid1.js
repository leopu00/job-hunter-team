/**
 * `jht pid1` — container PID 1 dispatcher con hot-reload del cloud daemon.
 *
 * Pensato come CMD del docker-compose: in base a JHT_HOST_TYPE decide
 * cosa far girare nel container.
 *
 * NOTA 2026-07-23: la dashboard web su 127.0.0.1:3000 e' stata RITIRATA.
 * Tutta l'interazione local/VPS vive nell'app desktop (il gioco), che parla
 * col container via docker exec / SSH. Il browser serve solo il cloud
 * (jobhunterteam.ai, con login) — storia separata.
 *
 *   vps + cloud paired → cloud daemon + bridges
 *                        ↳ daemon pusha dati a jobhunterteam.ai ogni 30s
 *
 *   vps senza cloud    → bridges soltanto, finche' non appare cloud.json:
 *                        un watcher su $JHT_HOME/cloud.json fa partire il
 *                        daemon non appena il pairing viene completato dal
 *                        wizard, SENZA richiedere `jht down && jht up`.
 *                        Idem in caso di unpairing (`jht cloud disable`):
 *                        kill del daemon, il resto resta intatto.
 *
 *   local              → bridges + watchdog soltanto
 *
 * Il sorgente di JHT_HOST_TYPE in ordine di priorita':
 *   1. env var (passato da docker-compose o dall'utente)
 *   2. /jht_home/host.env (scritto da scripts/host-setup.sh durante install)
 *   3. default `local` (sicuro: comportamento storico)
 */

import { readFile, access, unlink, writeFile } from 'node:fs/promises';
import { existsSync, createWriteStream, mkdirSync, statSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { dirname } from 'node:path';

const JHT_ENTRY = '/app/cli/bin/jht.js';
const JHT_HOME = '/jht_home';
const HOST_ENV_PATH = `${JHT_HOME}/host.env`;
const CLOUD_JSON_PATH = `${JHT_HOME}/cloud.json`;
const JHT_CONFIG_PATH = `${JHT_HOME}/jht.config.json`;
const TEAM_HALTED_FLAG = `${JHT_HOME}/.team-halted.flag`;
const PAIRING_TOKEN_PATH = `${JHT_HOME}/.pairing-token`;
const TG_BRIDGE_LAUNCHER = '/app/.launcher/start-agent.sh';
const AGENT_WATCHDOG_SCRIPT = '/app/.launcher/agent-watchdog.sh';
const DOCTOR_WATCHDOG_SCRIPT = '/app/.launcher/doctor-watchdog.sh';
const STEPCAP_WATCHDOG_SCRIPT = '/app/.launcher/stepcap-watchdog.py';
const THROTTLE_ENGINE_SCRIPT = '/app/shared/skills/throttle_engine.py';
const AUTO_REPORT_LOOP_SCRIPT = '/app/.launcher/auto-report-loop.sh';
const WELCOME_SEND_SCRIPT = '/app/.launcher/welcome-send.sh';

/**
 * Serializza gli eventi ravvicinati di fs.watch e ne conserva l'ultimo.
 * fs.watch può consegnare rename/change insieme; un listener async normale
 * parte due volte in parallelo e fa superare a entrambe le callback gli
 * stessi flag `...Started`. Il risultato erano bridge duplicati al primo
 * salvataggio del provider. Le chiamate durante un giro diventano un solo
 * giro successivo con gli argomenti più recenti.
 */
export function coalesceAsyncCalls(handler) {
  let running = false;
  let queued = false;
  let latestArgs = [];
  return async (...args) => {
    latestArgs = args;
    queued = true;
    if (running) return;
    running = true;
    try {
      do {
        queued = false;
        const callArgs = latestArgs;
        await handler(...callArgs);
      } while (queued);
    } finally {
      running = false;
    }
  };
}

export async function readHostType({
  env = process.env,
  hostEnvPath = HOST_ENV_PATH,
  accessFile = access,
  readHostFile = readFile,
  log = pid1Log,
} = {}) {
  const resolved = (hostType, source) => {
    // Il ramo VPS abilita daemon e watcher cloud, quindi la decisione deve
    // restare nel log di boot anche quando non c'è alcun errore da mostrare.
    log(`host type resolved: ${hostType} (${source})`);
    return hostType;
  };
  const fromEnv = (env.JHT_HOST_TYPE || '').trim().toLowerCase();
  if (fromEnv) return resolved(fromEnv, 'JHT_HOST_TYPE');

  try {
    await accessFile(hostEnvPath);
    const content = await readHostFile(hostEnvPath, 'utf-8');
    const m = /^JHT_HOST_TYPE=(.*)$/m.exec(content);
    if (m) return resolved(m[1].trim().toLowerCase(), 'host.env');
  } catch (err) {
    // Il file assente è normale (utente che salta host-setup). Qualunque
    // altro errore non può mascherarsi da host locale: spegnere in silenzio
    // il ramo VPS significa spegnere i canali che l'utente si aspetta vivi.
    if (err?.code !== 'ENOENT') {
      log(`cannot read host type from ${hostEnvPath} (${err?.code ?? 'unknown'}): ${err?.message ?? err}`);
      throw err;
    }
  }
  return resolved('local', 'host.env missing');
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
      pid1Log(`tg-bridge bootstrap failed (exit ${code}): Telegram messages will not arrive`);
    }
  });
}

/**
 * Auto-spawn dei 2 bridge Python (sentinel + pacing) tramite
 * `start-agent.sh bridge`. Senza, dopo ogni `docker compose up -d` il
 * sentinel-bridge resta morto e il Capitano va in "team in standby"
 * cieco — caso osservato 2026-05-17 20:02 con utente arrabbiato a
 * ragione. Pattern identico a startTgBridge: lo script bash è
 * idempotente (kill+respawn via /proc cmdline scan), setsid detached,
 * exit immediato del launcher = OK.
 */
function startSentinelBridges() {
  pid1Log('starting sentinel-bridge + pacing-bridge (Python detached)');
  const child = spawnLabeled('bridge-launcher', '/bin/bash', [
    TG_BRIDGE_LAUNCHER,
    'bridge',
  ]);
  child.on('exit', (code) => {
    if (code === 0) {
      pid1Log('sentinel/pacing bridge bootstrap OK (2 process detached)');
    } else {
      pid1Log(`sentinel/pacing bridge bootstrap failed (exit ${code}): no BRIDGE TICK at Capitano`);
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
 * Una nuova installazione non puo' spendere token prima del click esplicito
 * su "Attiva team". Il container nasce prima di provider, profilo e orari:
 * in quel momento mettiamo lo stesso gate persistente usato dallo Stop.
 *
 * `ensure_assistant` lancia direttamente il solo Assistente e continua quindi
 * a funzionare durante l'onboarding. `jht team start` senza ruolo rimuove il
 * flag; watchdog, Dottore e Mantenitore restano invece spenti fino ad allora.
 * Le installazioni gia' configurate non ricevono retroattivamente il gate.
 */
async function ensureInitialTeamHalt() {
  if (existsSync(TEAM_HALTED_FLAG) || (await hasActiveProviderConfigured())) {
    return;
  }
  try {
    await writeFile(TEAM_HALTED_FLAG, 'initial-setup\n', { flag: 'wx', mode: 0o600 });
    pid1Log('initial setup: team-halted gate created — waiting for team activation');
  } catch (err) {
    if (err?.code !== 'EEXIST') {
      pid1Log(`initial setup: unable to create team-halted gate (${err.message})`);
      throw err;
    }
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
      // kimi-cli 1.47+ scrive le creds OAuth in .kimi/credentials/<plan>.json
      // (es. kimi-code.json per l'abbonamento kimi-for-coding), NON piu' in
      // .kimi/kimi.json. Allineato a sentinel-bridge.py KIMI_CREDENTIALS.
      //
      // Accetta sia il nome-VENDOR (openai/anthropic — quello che scrive
      // `jht providers use`) sia il nome-CLI storico (codex/claude): stesso
      // marker. Senza gli alias, active_provider="openai" cadeva su
      // markers[prov]=undefined → false SILENZIOSO → auto-start mai
      // eseguito (stessa timebomb del post-mortem 2026-07-18 su
      // agent-watchdog.sh config_ready, mai propagata qui).
      kimi: `${JHT_HOME}/.kimi/credentials/kimi-code.json`,
      claude: `${JHT_HOME}/.claude/.credentials.json`,
      anthropic: `${JHT_HOME}/.claude/.credentials.json`,
      codex: `${JHT_HOME}/.codex/auth.json`,
      openai: `${JHT_HOME}/.codex/auth.json`,
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
  // Gate centrale .team-halted.flag: se settato (utente ha cliccato Stop
  // dall'app desktop prima del restart container), NON auto-startare.
  // Source of truth: team_state.should_run. Il reconciler creerà/rimuoverà
  // il flag al prossimo polling. Senza questo gate, il container post-restart
  // partiva sempre con agenti attivi anche se l'utente li aveva spenti.
  if (existsSync(TEAM_HALTED_FLAG)) {
    pid1Log('auto-start agents SKIPPED: .team-halted.flag present (user clicked Stop)');
    return;
  }
  // Bug regressione post-recreate (osservato 2026-05-17 20:02): senza
  // sentinella tmux il Capitano non riceve [BRIDGE TICK] e all'utente
  // risponde generico ("team in standby") perché non ha dati freschi.
  // La sentinella va in questa lista insieme ai 3 user-facing perché
  // anche lei è un agente LLM long-lived necessario al funzionamento
  // normale del team — non un worker spawnato on-demand dal Capitano.
  const agents = ['assistente', 'capitano', 'mentor', 'sentinella'];
  pid1Log(`auto-start user-facing agents (${agents.join(', ')})`);
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
          pid1Log(`auto-start ${role}: failed (exit) ${code}) — user can click Start from desktop app`);
        }
        resolve();
      });
      child.on('error', (err) => {
        pid1Log(`auto-start ${role}: spawn error ${err.message}`);
        resolve();
      });
    });
    // Stagger tra agenti (2026-06-29): i 4 cold-start delle TUI (kimi/codex) si
    // sovrapponevano sulla fase di init CPU-pesante e su 2 core saturavano → la
    // 4ª in coda (la Sentinella) poteva INCANTARSI durante l'init (wedge reale
    // 2026-06-29: pane non ricettivo, recuperato poi dall'escalation). 3s non
    // bastavano: start-agent.sh ritorna appena LANCIA la TUI, ma l'init vero dura
    // ~15-30s. Distanziali di più così ogni TUI supera l'init pesante prima della
    // successiva. Configurabile (JHT_AUTOSTART_STAGGER_SEC); boot ~36s con 4 core.
    const staggerMs = (Number(process.env.JHT_AUTOSTART_STAGGER_SEC) || 12) * 1000;
    await new Promise((r) => setTimeout(r, staggerMs));
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
 * dei vari figli non si confondono dentro `docker logs jht`).
 * stdio='inherit' direttamente perderebbe l'identita'; usiamo pipe e
 * prefiggiamo ogni riga con il label.
 */
function spawnLabeled(label, cmd, args) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = `[${label}] `;

  // Persisti l'output del figlio su file, OLTRE a docker logs. I docker logs
  // ruotano (json-file default) e su crash veloce l'ultima riga bufferizzata
  // si perde → un crash-loop breve (es. cloud-daemon 2026-07-09) diventava
  // NON diagnosticabile: nessuno stack da nessuna parte. Il file su
  // $JHT_HOME/logs/<label>.log e' bind-mountato → sopravvive a rotazione,
  // restart e crash. Best-effort: se il file non e' apribile, si degrada al
  // solo docker-logs (comportamento storico), non blocca lo spawn.
  let fileStream = null;
  try {
    const logDir = join(JHT_HOME, 'logs');
    mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, `${label}.log`);
    // Rotazione singola a ~5MB: evita crescita illimitata su respawn ripetuti.
    try {
      if (statSync(logPath).size > 5 * 1024 * 1024) {
        renameSync(logPath, `${logPath}.old`);
      }
    } catch { /* file assente al primo spawn: normale */ }
    fileStream = createWriteStream(logPath, { flags: 'a' });
    fileStream.write(
      `\n[${new Date().toISOString()}] === spawn: ${cmd} ${args.join(' ')} ===\n`,
    );
  } catch (err) {
    console.log(`[pid1] log capture for '${label}' disabled: ${err.message}`);
  }

  const prefixStream = (stream, target) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk.toString('utf-8');
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        target.write(`${prefix}${line}\n`);
        if (fileStream) fileStream.write(`${line}\n`);
      }
    });
    stream.on('end', () => {
      if (buf) {
        target.write(`${prefix}${buf}\n`);
        if (fileStream) fileStream.write(`${buf}\n`);
      }
    });
  };
  prefixStream(child.stdout, process.stdout);
  prefixStream(child.stderr, process.stderr);

  // 'close' (non 'exit'): scatta DOPO il drain di stdout/stderr, cosi' l'ultima
  // riga del crash e' gia' scritta. Il codice di uscita finisce nel file anche
  // se il pid1Log del chiamante va solo su docker logs.
  child.on('close', (code, signal) => {
    if (fileStream) {
      fileStream.end(
        `[${new Date().toISOString()}] === exited code=${code} signal=${signal} ===\n`,
      );
    }
  });
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
 * girare, l'utente puo' diagnosticare via `jht cloud pair`
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
    pid1Log('cloud.json already present: remove .pairing-token residue');
    try { await import('node:fs').then((m) => m.promises.unlink(PAIRING_TOKEN_PATH)); } catch { /* best-effort */ }
    return;
  }

  pid1Log('pairing token detected: running jht cloud pair (one shot)');
  await new Promise((resolve) => {
    const child = spawn(process.execPath, [JHT_ENTRY, 'cloud', 'pair'], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.on('exit', (code) => {
      if (code === 0) {
        pid1Log('cloud pair OK');
      } else {
        pid1Log(`cloud pair failed (exit ${code}); continuing. Retry manually with 'jht cloud pair'`);
      }
      resolve();
    });
    child.on('error', (err) => {
      pid1Log(`cloud pair spawn error: ${err.message}`);
      resolve();
    });
  });
}

/**
 * Esegue `jht migrate` al boot. Il wizard desktop scrive `jht.config.json`
 * in formato v1 (no `version` field); senza migrazione i campi v2-v4
 * (`providers` strutturato, `agents.list`, `notifications`, `analytics`)
 * restano assenti e i comandi downstream falliscono o cadono nei default
 * silenziosi. `jht migrate` e' gia' non-interattivo (no prompts) ed
 * idempotente: se la config e' al massimo, exit 0 con "Nessuna migrazione
 * necessaria". Best-effort: un fallimento qui non blocca pid1, l'utente
 * puo' rieseguire `jht migrate` manualmente dal terminal embedded.
 * Vedi docs/internal/_archive/2026-05-20-vps-bootstrap-bugs.md §Bug #3.
 */
async function runMigrate() {
  try {
    await access(JHT_CONFIG_PATH);
  } catch {
    // No config yet (pre-pairing su VPS): niente da migrare.
    return;
  }
  pid1Log('running jht migrate (idempotent)');
  await new Promise((resolve) => {
    const child = spawnLabeled('migrate', process.execPath, [JHT_ENTRY, 'migrate']);
    child.on('exit', (code) => {
      if (code === 0) pid1Log('jht migrate ok');
      else pid1Log(`jht migrate exit ${code} — continuation, manual retry via 'jht migrate'`);
      resolve();
    });
    child.on('error', (err) => {
      pid1Log(`jht migrate spawn error: ${err.message}`);
      resolve();
    });
  });
}

async function runUnstuckPositions() {
  // Reset positions stuck in 'writing'/'checked' da HALT/kill mid-run del
  // boot precedente. Idempotente: zero stuck = no-op. Skip se jobs.db
  // ancora non esiste (nessun team mai avviato, niente da pulire).
  // Origin: docs/internal/postmortems/2026-05-21-vps1-run-postmortem.md anomalia #4.
  const JOBS_DB_PATH = `${JHT_HOME}/jobs.db`;
  try {
    await access(JOBS_DB_PATH);
  } catch {
    return;
  }
  pid1Log('running unstuck_positions (reset stuck writing > 2h)');
  await new Promise((resolve) => {
    const child = spawnLabeled('unstuck', '/usr/bin/env', [
      'python3',
      '/app/shared/skills/unstuck_positions.py',
      '--apply',
      '--include-checked',
    ]);
    child.on('exit', (code) => {
      if (code === 0) pid1Log('unstuck_positions ok');
      else pid1Log(`unstuck_positions exited ${code}; non-blocking, continuing`);
      resolve();
    });
    child.on('error', (err) => {
      pid1Log(`unstuck_positions spawn error: ${err.message}`);
      resolve();
    });
  });
}

/**
 * Al boot del container nessun processo bridge sopravvive al teardown,
 * quindi pid + state file lasciati dalla sessione precedente sono per
 * definizione orfani: senza pulizia, chi legge lo stato (game via docker
 * exec, process_health) vede "running" + "next tick" stantii. Era dentro
 * il comando dashboard (ritirato 2026-07-23); ora vive qui.
 */
async function cleanupStaleBridgeState() {
  const logs = join(JHT_HOME, 'logs');
  const targets = [
    'sentinel-bridge.pid',
    'sentinel-bridge-state.json',
    'pacing-bridge.pid',
    'pacing-bridge-state.json',
  ];
  for (const name of targets) {
    try { await unlink(join(logs, name)); } catch { /* ENOENT atteso */ }
  }
  // Flag dei throttle: un boot del container respawna OGNI agente, quindi
  // nessuna pausa registrata prima descrive piu' un'istanza viva. Lasciarli li'
  // farebbe partire una sveglia "[RIPRENDI]" a raffica su agenti appena nati.
  // NB: questo NON e' il caso del respawn del solo daemon (pid1 resta vivo e non
  // ripassa da qui) — la' i timer DEVONO sopravvivere, ed e' il punto del motore.
  try { await unlink(join(JHT_HOME, 'state', 'throttle-flags.json')); } catch { /* ENOENT atteso */ }
}

/**
 * [PROVIDER-CLI-AUTOUPDATE] Aggiorna la CLI del provider ATTIVO prima di
 * qualunque cosa che la usi. Delegato a `jht providers autoupdate` (stesso
 * pattern di runMigrate/runUnstuckPositions: pid1 spawna sotto-comandi invece
 * di importare i moduli dei comandi).
 *
 * SEQUENZIALE, non in parallelo ai bridge. Misurato sui due percorsi reali —
 * `npm install -g @anthropic-ai/claude-code@<pin>` 1,5s e la coppia
 * `pip install -U uv` + `uv tool install --force kimi-cli==<pin>` ~6s — l'attesa e'
 * un'inezia rispetto ai ~48s di stagger che il boot gia' spende sui 4 agenti.
 * Farlo in parallelo avrebbe richiesto di trattenere comunque tutti i percorsi
 * che spawnano agenti (auto-start, agent-watchdog ogni 30s, doctor-watchdog):
 * complessita' e una finestra di rischio — sostituire il binario sotto una TUI
 * appena partita — per guadagnare pochi secondi. Il caso degenere (registry che
 * accetta e poi tace) e' chiuso dal timeout per-step dentro providers.js.
 *
 * Lo stesso sotto-comando fa anche il secondo passo [PROVIDER-MODEL-PIN]:
 * rivedere il modello che la CLI si e' pinnata al primo login. Deve girare qui
 * e non altrove — dopo l'update (la prova la fa la CLI nuova) e PRIMA di
 * qualunque spawn, perche' ogni sessione legge il modello all'avvio: e' il solo
 * punto del boot dove un cambio entra in vigore senza riavviare niente.
 *
 * Fail-safe: qualunque esito, si prosegue. Se l'update non riesce il team
 * lavora con la CLI gia' installata; se il modello candidato non risponde alla
 * prova, il pin resta com'e' e il Capitano riceve un finding.
 */
async function runProviderAutoUpdate() {
  pid1Log('CLI auto-update + model review (before bridges; JHT_PROVIDER_AUTOUPDATE=0 to turn it off, JHT_MODEL_PIN=<x> to fix the model)');
  await new Promise((resolve) => {
    const child = spawnLabeled('provider-update', process.execPath, [
      JHT_ENTRY,
      'providers',
      'autoupdate',
    ]);
    child.on('exit', (code) => {
      if (code === 0) pid1Log('provider CLI auto-update completed');
      else pid1Log(`provider CLI auto-update exit ${code} — continue with the CLI already present`);
      resolve();
    });
    child.on('error', (err) => {
      pid1Log(`provider CLI auto-update spawn error: ${err.message} — continue with the CLI already present`);
      resolve();
    });
  });
}

async function dispatch() {
  const hostType = await readHostType();
  const isVps = hostType === 'vps' || hostType === 'server' || hostType === 'remote';

  // Migrate jht.config.json al volo (v1 → vN). Il wizard desktop scrive v1
  // e il container ha bisogno dei campi delle versioni successive per far
  // funzionare provider OAuth, channels, agents.list. Idempotente.
  await runMigrate();

  // Fail-safe del primo setup: prima di avviare qualunque watchdog LLM,
  // impedisce il burst automatico. Il solo Assistente resta avviabile dal
  // wizard e il click esplicito su `team start` rimuove questo gate.
  await ensureInitialTeamHalt();

  // Reset positions stuck in writing/checked dal boot precedente (HALT,
  // kill mid-run). Idempotente, skip se jobs.db non esiste ancora.
  await runUnstuckPositions();

  // Pulizia pid/state file orfani dei bridge (pre-teardown).
  await cleanupStaleBridgeState();

  // Aggiornamento della CLI del provider attivo. Qui e non piu' avanti: da
  // questo punto in poi il boot spawna bridge, watchdog e agenti, e un update
  // fatto dopo sostituirebbe il binario sotto processi vivi.
  await runProviderAutoUpdate();

  // Pair non-interattivo PRIMA di partire il daemon: cosi' il watcher
  // su cloud.json non scatta a vuoto e il daemon parte subito col token
  // appena mintato. Su local non ha senso (no install.sh con --pairing-token).
  if (isVps) {
    await maybeRunPairing();
  }

  const daemonCmd = [JHT_ENTRY, 'cloud', 'daemon'];
  const realtimeCmd = [JHT_ENTRY, 'cloud', 'realtime-listen'];
  const teamStateCmd = [JHT_ENTRY, 'cloud', 'team-state-listen'];
  const userMessagesCmd = [JHT_ENTRY, 'cloud', 'messages-listen'];
  const fileBridgeCmd = [JHT_ENTRY, 'cloud', 'file-bridge-listen'];

  // Niente dashboard web: ritirata 2026-07-23 (vedi header). L'interazione
  // passa dall'app desktop via docker exec / SSH; il container espone zero
  // porte HTTP. pid1 resta vivo col keep-alive esplicito in fondo.
  pid1Log(isVps ? 'mode: VPS' : 'mode: local');

  // ── Telegram bridge: long-poll Bot API → tmux corrispondente. Parte
  // sempre al boot se ci sono bot configurati (decisione 2026-05-16:
  // "il tg-bridge deve essere sempre attivo, parte col container").
  // Senza, l'utente Telegram → assistente non riceve nulla anche se
  // tmux ASSISTENTE è up.
  const hasBots = await hasTelegramBotsConfigured();
  let tgBridgeStarted = false;
  if (hasBots) {
    startTgBridge();
    tgBridgeStarted = true;
  } else {
    pid1Log('tg-bridge: no bots in jht.config.json, skip');
  }

  // Bridge Python (sentinel + pacing): partono SEMPRE indipendentemente
  // dai bot Telegram. Senza il Capitano non riceve [BRIDGE TICK] e si
  // bloccca pensando che la pipeline sia in standby. Il provider Kimi
  // deve essere configurato per generare tick utili (default OK se
  // active_provider è set, lo script legge il config a runtime).
  let sentinelBridgesStarted = false;
  if (await hasActiveProviderConfigured()) {
    startSentinelBridges();
    sentinelBridgesStarted = true;
  } else {
    pid1Log('sentinel/pacing bridge: active_provider missing, skip — try again after wizard');
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
        else pid1Log(`welcome-send: exit ${code} (errors for specific roles lotted to logs/welcome-send.log)`);
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
      pid1Log(`auto-start agents crashed: ${err.message}`),
    );
  } else if (hasBots && (await hasActiveProviderConfigured())) {
    pid1Log('auto-start agents postponed: OAuth provider not yet completed (watchdog will provide)');
  }

  // ── #5: Watcher su jht.config.json — il wizard scrive bot/provider DOPO
  // il boot di pid1 (config spesso vuota all'avvio del container). Senza
  // questo, tg-bridge e sentinel/pacing-bridge skippati al boot NON ripartono
  // finché il container non viene riavviato → bug "scrivo ai bot e non
  // risponde nessuno" + Capitano in standby (osservato beta tester 2026-06-03).
  // Mirror del watcher cloud.json sotto; idempotente, si auto-chiude quando
  // entrambi i bridge sono partiti.
  if (!tgBridgeStarted || !sentinelBridgesStarted) {
    let cfgWatcher = null;
    const reconcileConfig = coalesceAsyncCalls(async () => {
      await new Promise((r) => setTimeout(r, 250)); // debounce write atomico (tmp+rename)
      if (!tgBridgeStarted && (await hasTelegramBotsConfigured())) {
        pid1Log('jht.config.json updated (post-wizard configured bot): tg-bridge boot + welcome');
        startTgBridge();
        tgBridgeStarted = true;
        spawn('/bin/bash', [WELCOME_SEND_SCRIPT], { stdio: 'inherit' })
          .on('exit', (code) => pid1Log(`welcome-send (post-wizard): exit ${code}`));
      }
      if (!sentinelBridgesStarted && (await hasActiveProviderConfigured())) {
        pid1Log('jht.config.json updated (active_provider post-wizard): start sentinel + pacing bridge');
        startSentinelBridges();
        sentinelBridgesStarted = true;
      }
      if (tgBridgeStarted && sentinelBridgesStarted && cfgWatcher) {
        pid1Log('config watcher: tg-bridge + active sentinel/pacing, close watcher');
        cfgWatcher.close();
        cfgWatcher = null;
      }
    });
    try {
      cfgWatcher = watch(dirname(JHT_CONFIG_PATH), { persistent: true }, (eventType, filename) => {
        if (filename !== 'jht.config.json') return;
        void reconcileConfig().catch((err) =>
          pid1Log(`config reconciliation failed (${err.message}) — retrying on the next event`),
        );
      });
      process.on('exit', () => { if (cfgWatcher) cfgWatcher.close(); });
    } catch (err) {
      pid1Log(`config watcher failed (${err.message}) — bridges will not auto-start after the wizard`);
    }
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
          pid1Log('agent-watchdog respawn after crashing');
          startAgentWatchdog();
        }
      }, 5000);
      void exited;
    });
  };
  startAgentWatchdog();

  // ── Auto-report loop: panoramica grafica + PNG via Telegram ogni 2h
  // (decisione utente 2026-05-17 — bug #16 / task #52 / F-1.D). Loop
  // bash che ogni 5 min chiama auto_report.py; lo script throttle
  // interno garantisce 1 invio reale ogni JHT_AUTO_REPORT_INTERVAL_MIN.
  // Pattern identico a doctor-watchdog: respawn 5s on crash.
  let autoReportChild = null;
  let autoReportRespawnTimer = null;
  const startAutoReportLoop = () => {
    if (autoReportChild && !autoReportChild.killed) return;
    pid1Log('starting auto-report-loop (Telegram overview + PNG every 2h)');
    autoReportChild = spawnLabeled('auto-report', '/bin/bash', [AUTO_REPORT_LOOP_SCRIPT]);
    autoReportChild.on('exit', (code, signal) => {
      const exited = autoReportChild;
      autoReportChild = null;
      if (shuttingDown) return;
      pid1Log(`auto-report-loop exited (code=${code} signal=${signal})`);
      if (autoReportRespawnTimer) clearTimeout(autoReportRespawnTimer);
      autoReportRespawnTimer = setTimeout(() => {
        if (!shuttingDown) {
          pid1Log('auto-report-loop respawn after crash');
          startAutoReportLoop();
        }
      }, 5000);
      void exited;
    });
  };
  if (hasBots) {
    startAutoReportLoop();
  } else {
    pid1Log('auto-report-loop skip: no Telegram bot configured');
  }

  // ── Doctor watchdog: loop bash che ogni 30 min spawna una sessione
  // tmux DOTTORE (one-shot LLM ~30 min, prune cache + py-audit + liveness
  // check). Regressione storica: introdotto 2026-05-08 (commit d4bb2ca2)
  // e poi perso al rebuild perché esisteva solo come `tmux new-session`
  // manuale. Pattern identico ad agent-watchdog ma cadenza interna allo
  // script (sleep 1800s). Vedi docs/internal/_archive/2026-05-17-team-strategy-bugs.md §18.
  let doctorWatchdogChild = null;
  let doctorWatchdogRespawnTimer = null;
  const startDoctorWatchdog = () => {
    if (doctorWatchdogChild && !doctorWatchdogChild.killed) return;
    pid1Log('starting doctor-watchdog (auto-spawn DOTTORE every 30 min)');
    doctorWatchdogChild = spawnLabeled('doctor-watchdog', '/bin/bash', [DOCTOR_WATCHDOG_SCRIPT]);
    doctorWatchdogChild.on('exit', (code, signal) => {
      const exited = doctorWatchdogChild;
      doctorWatchdogChild = null;
      if (shuttingDown) return;
      pid1Log(`doctor-watchdog exited (code=${code} signal=${signal})`);
      if (doctorWatchdogRespawnTimer) clearTimeout(doctorWatchdogRespawnTimer);
      doctorWatchdogRespawnTimer = setTimeout(() => {
        if (!shuttingDown) {
          pid1Log('doctor-watchdog respawn after crash');
          startDoctorWatchdog();
        }
      }, 5000);
      void exited;
    });
  };
  startDoctorWatchdog();

  // ── Step-cap watchdog: l'unico che guarda se un agente PROGREDISCE, non
  // se esiste. Il cap max_steps=100 interrompe l'agente senza terminarlo: la
  // sessione resta viva, il pane risponde, e l'agente aspetta un input che
  // nessuno mandava (2026-07-28: l'unico Scout attivo fermo cosi', coda
  // Analisti vuota, Scorer a secco — e ogni indicatore di salute verde).
  // Rileva il marcatore + pane immobile, mette in throttle, poi riprende via
  // buffer tmux. Stesso pattern di respawn degli altri watchdog.
  let stepcapChild = null;
  let stepcapRespawnTimer = null;
  const startStepcapWatchdog = () => {
    if (stepcapChild && !stepcapChild.killed) return;
    pid1Log('starting stepcap-watchdog (resume steady agents on step cap, tick 60s)');
    stepcapChild = spawnLabeled('stepcap-watchdog', '/usr/bin/env', [
      'python3',
      '-u',
      STEPCAP_WATCHDOG_SCRIPT,
    ]);
    stepcapChild.on('exit', (code, signal) => {
      const exited = stepcapChild;
      stepcapChild = null;
      if (shuttingDown) return;
      pid1Log(`stepcap-watchdog exited (code=${code} signal=${signal})`);
      if (stepcapRespawnTimer) clearTimeout(stepcapRespawnTimer);
      stepcapRespawnTimer = setTimeout(() => {
        if (!shuttingDown) {
          pid1Log('stepcap-watchdog respawn after crashing');
          startStepcapWatchdog();
        }
      }, 5000);
      void exited;
    });
  };
  startStepcapWatchdog();

  // ── Motore dei throttle: il tempo esce dal dominio dell'agente. Prima il
  // throttle era un contratto che l'agente onorava da solo, bloccando il
  // proprio processo — e quando quel processo moriva col timeout della tool
  // call, nessuno lo svegliava piu' (2026-07-30: 2h15m di stallo su un
  // Analista, con la sessione classificata `idle` = sana). Il daemon possiede i
  // timer, li tiene SU DISCO (un respawn non ne perde nessuno) e manda la
  // sveglia via il sender protetto. Va qui, accanto ai bridge, proprio perche'
  // NON deve essere figlio di nessuna shell di agente.
  let throttleEngineChild = null;
  let throttleEngineRespawnTimer = null;
  const startThrottleEngine = () => {
    if (throttleEngineChild && !throttleEngineChild.killed) return;
    pid1Log('starting throttle-engine (throttle timer + tmux alarm)');
    throttleEngineChild = spawnLabeled('throttle-engine', '/usr/bin/env', [
      'python3',
      '-u',
      THROTTLE_ENGINE_SCRIPT,
    ]);
    throttleEngineChild.on('exit', (code, signal) => {
      const exited = throttleEngineChild;
      throttleEngineChild = null;
      if (shuttingDown) return;
      pid1Log(`throttle-engine exited (code=${code} signal=${signal})`);
      if (throttleEngineRespawnTimer) clearTimeout(throttleEngineRespawnTimer);
      throttleEngineRespawnTimer = setTimeout(() => {
        if (!shuttingDown) {
          pid1Log('throttle-engine respawn after crash');
          startThrottleEngine();
        }
      }, 5000);
      void exited;
    });
  };
  startThrottleEngine();

  // ── Daemon push + Realtime subscriber: entrambi opzionali, gated da
  // cloud paired. Stessa logica di lifecycle (start/stop/respawn).
  let daemonChild = null;
  let realtimeChild = null;
  let teamStateChild = null;
  let userMessagesChild = null;
  let fileBridgeChild = null;
  let daemonRespawnTimer = null;
  let realtimeRespawnTimer = null;
  let teamStateRespawnTimer = null;
  let userMessagesRespawnTimer = null;
  let fileBridgeRespawnTimer = null;

  const startDaemon = () => {
    if (daemonChild && !daemonChild.killed) return;
    pid1Log('starting cloud daemon (push periodico verso jobhunterteam.ai)');
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
          pid1Log('daemon respawn after crash');
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
          pid1Log('realtime subscriber respawn after crash');
          startRealtime();
        }
      }, 5000);
      void exitedChild;
    });
  };

  // user_to_agent_messages poller: long-poll /api/messages?status=pending,
  // claim atomico via PATCH delivered, forward al tmux pane dell'agente
  // target. Crash recovery debounce 5s come gli altri reader.
  const startUserMessages = () => {
    if (userMessagesChild && !userMessagesChild.killed) return;
    pid1Log('starting user-messages poller (user_to_agent_messages → tmux)');
    userMessagesChild = spawnLabeled('user-msg', process.execPath, userMessagesCmd);
    userMessagesChild.on('exit', (code, signal) => {
      const exitedChild = userMessagesChild;
      userMessagesChild = null;
      if (shuttingDown) return;
      pid1Log(`user-messages poller exited (code=${code} signal=${signal})`);
      if (userMessagesRespawnTimer) clearTimeout(userMessagesRespawnTimer);
      userMessagesRespawnTimer = setTimeout(async () => {
        if (shuttingDown) return;
        if (await isCloudConfigured()) {
          pid1Log('user-messages poller respawn after crashing');
          startUserMessages();
        }
      }, 5000);
      void exitedChild;
    });
  };

  // team_state reconciler: polla /api/team-state e converge desired→observed
  // via `jht team start|stop|restart`. Parallelo a realtime subscriber durante
  // il cutover (Step 5 in docs/internal/architecture/cloud-sync-architecture.md).
  const startTeamState = () => {
    if (teamStateChild && !teamStateChild.killed) return;
    pid1Log('starting team_state reconciler');
    teamStateChild = spawnLabeled('team-state', process.execPath, teamStateCmd);
    teamStateChild.on('exit', (code, signal) => {
      const exitedChild = teamStateChild;
      teamStateChild = null;
      if (shuttingDown) return;
      pid1Log(`team_state reconciler exited (code=${code} signal=${signal})`);
      if (teamStateRespawnTimer) clearTimeout(teamStateRespawnTimer);
      teamStateRespawnTimer = setTimeout(async () => {
        if (shuttingDown) return;
        if (await isCloudConfigured()) {
          pid1Log('team_state reconciler respawn after crash');
          startTeamState();
        }
      }, 5000);
      void exitedChild;
    });
  };

  // file bridge poller: pubblica l'indice dei file e serve le richieste
  // on-demand del web (upload effimero su Supabase Storage). Crash recovery
  // debounce 5s come gli altri reader. Vedi
  // docs/internal/file-bridge-on-demand-2026-06-07.md
  const startFileBridge = () => {
    if (fileBridgeChild && !fileBridgeChild.killed) return;
    pid1Log('starting file-bridge poller (index + on-demand upload)');
    fileBridgeChild = spawnLabeled('file-bridge', process.execPath, fileBridgeCmd);
    fileBridgeChild.on('exit', (code, signal) => {
      const exitedChild = fileBridgeChild;
      fileBridgeChild = null;
      if (shuttingDown) return;
      pid1Log(`file-bridge poller exited (code=${code} signal=${signal})`);
      if (fileBridgeRespawnTimer) clearTimeout(fileBridgeRespawnTimer);
      fileBridgeRespawnTimer = setTimeout(async () => {
        if (shuttingDown) return;
        if (await isCloudConfigured()) {
          pid1Log('file-bridge poller respawn after crash');
          startFileBridge();
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
    if (teamStateRespawnTimer) {
      clearTimeout(teamStateRespawnTimer);
      teamStateRespawnTimer = null;
    }
    if (teamStateChild && !teamStateChild.killed) {
      pid1Log(`stopping team_state reconciler (${reason})`);
      teamStateChild.kill('SIGTERM');
    }
    if (userMessagesRespawnTimer) {
      clearTimeout(userMessagesRespawnTimer);
      userMessagesRespawnTimer = null;
    }
    if (userMessagesChild && !userMessagesChild.killed) {
      pid1Log(`stopping user-messages poller (${reason})`);
      userMessagesChild.kill('SIGTERM');
    }
    if (fileBridgeRespawnTimer) {
      clearTimeout(fileBridgeRespawnTimer);
      fileBridgeRespawnTimer = null;
    }
    if (fileBridgeChild && !fileBridgeChild.killed) {
      pid1Log(`stopping file-bridge poller (${reason})`);
      fileBridgeChild.kill('SIGTERM');
    }
  };

  // [JHT-CLOUD-INTERACTIVE-RETIRE] Riduzione dei processi VPS→cloud per tagliare
  // la quota Vercel per-utente (3 poller × N utenti la dominavano):
  //   • team-state-reconciler → FUSO nel cloud daemon (reconcileOnce per tick):
  //     il controllo should_run→`jht team start/stop` resta funzionante con UN
  //     solo processo. Il poller standalone non parte più.
  //   • user-messages-poller → RITIRATO: la chat web→agente è solo-desktop (via
  //     tunnel arriva a tmux in locale); la lane cloud /api/messages è morta.
  //   • team-commands-poller (realtime) → RITIRATO 2026-06-25: il feeder web è
  //     morto (web read-only → /api/team/command 403 sul cloud, niente più
  //     team_commands dal browser), pollava a vuoto ~ogni 5s (~150 req/h Vercel).
  //   • file-bridge-poller → RI-ABILITATO 2026-07-11 (default on su VPS): serve
  //     il download on-demand di CV/allegati dal web (pulsante "Scarica PDF"
  //     sulla pagina posizione + CV Preview del profilo). Poll adattivo
  //     (poll-tier, idle 30s) + indice/purge a tempo. È l'unico poller di
  //     controllo attivo di default; gli altri restano congelati.
  // Gli altri poller ritirati restano disponibili come comandi diagnostici
  // manuali, ma pid1 non li co-spawna piu': riattivarli insieme al daemon
  // duplica i consumer e puo' ricreare il loop di polling che li ha ritirati.
  // Il vecchio flag e' accettato solo per emettere una migrazione esplicita.
  const controlPollers = process.env.JHT_CLOUD_CONTROL_POLLERS === '1';
  if (controlPollers) {
    pid1Log(
      'JHT_CLOUD_CONTROL_POLLERS is deprecated and ignored: remove it; the cloud daemon now owns realtime, team_state and chat',
    );
  }

  // Stato iniziale del cloud: se gia' paired, partono il cloud daemon (con
  // reconcile) + il file-bridge poller (download file on-demand dal web).
  // team-commands (realtime) + team-state/user-messages standalone: solo se
  // ri-abilitati (escape hatch).
  if (isVps && await isCloudConfigured()) {
    startDaemon();
    startFileBridge();
  } else if (isVps) {
    pid1Log('cloud sync not yet configured: watching for cloud.json (auto-start after pairing)');
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
          // [JHT-CLOUD-INTERACTIVE-RETIRE] un solo owner: il daemon integra
          // Realtime/team_state/chat. I consumer legacy non vengono duplicati.
          pid1Log('cloud.json detected: starting cloud daemon (with realtime/team_state/chat) + file-bridge poller');
          startDaemon();
          startFileBridge();
        } else {
          stopDaemon('cloud.json removed or disabled');
        }
      });
    } catch (err) {
      pid1Log(`watch failed (${err.message}) — daemon hot reload disabled`);
    }
    // Cleanup watcher allo shutdown
    process.on('exit', () => { if (watcher) watcher.close(); });
  }

  // ── Keep-alive esplicito. Prima l'ancora del processo era il child
  // dashboard ("dashboard exit = container exit"); tolta la dashboard,
  // pid1 deve restare vivo da solo finche' il runtime non manda SIGTERM.
  const keepAlive = setInterval(() => {}, 2 ** 31 - 1);

  // ── Shutdown forwarding: docker/podman stop manda SIGTERM.
  const forwardSignal = (sig) => {
    if (shuttingDown) return;
    shuttingDown = true;
    pid1Log(`shutdown (${sig}): killing children`);
    clearInterval(keepAlive);
    if (daemonChild && !daemonChild.killed) daemonChild.kill(sig);
    if (realtimeChild && !realtimeChild.killed) realtimeChild.kill(sig);
    if (teamStateChild && !teamStateChild.killed) teamStateChild.kill(sig);
    if (userMessagesChild && !userMessagesChild.killed) userMessagesChild.kill(sig);
    if (fileBridgeChild && !fileBridgeChild.killed) fileBridgeChild.kill(sig);
    if (watchdogChild && !watchdogChild.killed) watchdogChild.kill(sig);
    if (watchdogRespawnTimer) clearTimeout(watchdogRespawnTimer);
    if (doctorWatchdogChild && !doctorWatchdogChild.killed) doctorWatchdogChild.kill(sig);
    if (doctorWatchdogRespawnTimer) clearTimeout(doctorWatchdogRespawnTimer);
    if (stepcapChild && !stepcapChild.killed) stepcapChild.kill(sig);
    if (stepcapRespawnTimer) clearTimeout(stepcapRespawnTimer);
    if (throttleEngineChild && !throttleEngineChild.killed) throttleEngineChild.kill(sig);
    if (throttleEngineRespawnTimer) clearTimeout(throttleEngineRespawnTimer);
    if (autoReportChild && !autoReportChild.killed) autoReportChild.kill(sig);
    if (autoReportRespawnTimer) clearTimeout(autoReportRespawnTimer);
    stopTgBridge();
    // Alcuni figli detached e watcher mantengono handle Node aperti anche
    // dopo il SIGTERM. Senza un'uscita esplicita il vecchio keep-alive faceva
    // scadere sempre la grace period del runtime (exit 137). Cinque secondi
    // lasciano completare i cleanup e poi consegnano un exit 0 a tini.
    setTimeout(() => {
      pid1Log('shutdown complete');
      process.exit(0);
    }, 5000);
  };
  process.on('SIGTERM', () => forwardSignal('SIGTERM'));
  process.on('SIGINT', () => forwardSignal('SIGINT'));
}

export function registerPid1Command(program) {
  program
    .command('pid1')
    .description('Container entrypoint: bridges and watchdogs, plus cloud-daemon auto-start on VPS when cloud.json appears')
    .action(dispatch);
}
