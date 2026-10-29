// Comando team start
import { execSync, spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, mkdirSync, copyFileSync, unlinkSync } from 'node:fs';
import {
  AGENTS, DEFAULT_TEAM, c,
  tmuxAvailable, providerCli, cliAvailable, isSessionActive,
  sessionName, parseAgentArg, resolveConfig, getAgentDir, usingContainer,
  JHT_HOME, JHT_USER_DIR, JHT_DB_PATH, JHT_CONFIG_PATH,
} from './agents.js';
import { execArgvInContainer, execInContainer, execScriptInContainer } from '../../utils/container-proxy.js';
import { diskLowRefusal } from '../../lib/disk-guard.js';
import { readRegularFileText } from '../../lib/secure-config-io.js';

const CONTAINER_TEAM_HALTED_FLAG = '/jht_home/.team-halted.flag';
const SPAWN_ERROR_TAIL_LINES = 5;

export function spawnErrorTail(output, maxLines = SPAWN_ERROR_TAIL_LINES) {
  const lines = String(output ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(-maxLines).join('\n') || 'unknown error';
}

// Serve solo al path host legacy (tmux fuori dal container): dentro al
// container gli argomenti passano separati, senza shell di mezzo.
function shellEscape(value) {
  return String(value).replace(/'/g, "'\\''");
}

// La config che team start legge (provider, tick): solo un file regolare. Un link
// o una pipe al suo posto non si aprono; senza config leggibile, null.
export function readJhtConfig(path = JHT_CONFIG_PATH) {
  try { return JSON.parse(readRegularFileText(path)); } catch { return null; }
}

// Tick idle (default 10 min, range 1-60): il bridge usa questo come
// ceiling a riposo, ma adatta dinamicamente in alto (fino a 1 min)
// quando status CRITICO / host saturo / team operativo attivo. Questo
// era anche il fallback della route web `/api/team/start-all`, rimossa il
// 2026-07-25 con la dashboard locale: ora il default vive solo qui.
function readSentinellaTickMinutes() {
  try {
    const cfg = readJhtConfig();
    const n = Number(cfg?.sentinella_tick_minutes);
    if (Number.isFinite(n) && n >= 1 && n <= 60) return Math.round(n);
  } catch { /* fallback */ }
  return 10;
}

// Bootstrap container del team. Era la stessa logica della route web
// `/api/team/start-all` (rimossa il 2026-07-25 con la dashboard locale):
// da allora questa e' l'UNICA implementazione: il gioco chiama il CLI.
// Sequenza V7 (rivista 2026-05-13, 3 bot Telegram dedicati):
//   0. ASSISTENTE: tmux + CLI boot + welcome Telegram. Per PRIMO cosi'
//      l'utente riceve subito un messaggio "Ciao, mandami il CV" sul
//      telefono (canale primario su VPS headless).
//   1. TG-BRIDGE: spawna 3 long-poll Bot API (assistente, capitano, mentor),
//      ciascuno → tmux corrispondente. Pre-delay 5s. Le tmux di Capitano e
//      Mentor non esistono ancora al primo poll: se l'utente scrive prima
//      che siano up, `jht-tmux-send` logga e drop — accettato (edge case
//      ristretto al cold start; le sessioni partono entro 30s).
//   2. SENTINELLA: tmux + CLI boot + kick-off, pronta a ricevere il primo
//      [BRIDGE TICK] dal sentinel-bridge.
//   3. BRIDGE (sentinel + pacing): processo Python background. Pre-delay
//      20s per stabilizzazione CLI Sentinella.
//   4. MENTOR: tmux + CLI boot. User-facing always-on; il suo bridge era
//      gia' partito ma la sessione tmux nasce qui.
//   5. CAPITANO: per ULTIMO cosi' il monitoring (sentinel + pacing) e' gia'
//      stabile quando inizia a operare.
// Gli altri agenti (Scout, Analista, Scorer, Scrittore, Critico) li scala
// il Capitano secondo le sue soglie, leggendo lo stato Bridge.
function buildContainerBootstrap() {
  const tickMin = readSentinellaTickMinutes();
  return [
    { role: 'assistente', session: 'ASSISTENTE' },
    {
      // tg-bridge spawna internamente 3 processi (assistente/capitano/mentor),
      // ciascuno legge channels.telegram.bots.<role> dal config e dispatch
      // a tmux <ROLE>. Nessun env JHT_TG_TARGET_SESSION qui: lo script lo
      // deriva dal ruolo.
      role: 'tg-bridge', session: 'TG-BRIDGE', notATmuxSession: true,
      preDelayMs: 5000, env: {},
    },
    { role: 'sentinella', session: 'SENTINELLA', preDelayMs: 3000 },
    {
      role: 'bridge', session: 'BRIDGE', notATmuxSession: true,
      preDelayMs: 20000, env: { JHT_TARGET_SESSION: 'CAPITANO' },
    },
    {
      // Bridge V7 Step 5: daemon che osserva i log dei provider e calcola
      // weighted/pct + EMA ratio + per-agent rate. Spawnato dopo il sentinel
      // bridge (legge sentinel-bridge-state.json per la window dinamica).
      role: 'token-meter', session: 'TOKEN-METER', notATmuxSession: true,
      preDelayMs: 5000, env: {},
    },
    { role: 'mentor', session: 'MENTOR', preDelayMs: 3000 },
    {
      role: 'capitano', session: 'CAPITANO',
      preDelayMs: 5000, env: { JHT_TICK_INTERVAL: String(tickMin) },
    },
  ];
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// The Mentor has no record to walk until the first positions have a score, and its first wake at every start
// would be spent on nothing: it is not started while the first run is open (`first_run.py mentor-due` says 1),
// and the agent watchdog starts it within a minute of the run becoming steady. Any other answer (the script
// missing, a crash, no state) counts as due: the Mentor then starts as it always did.
export function mentorDeferred(run = execArgvInContainer) {
  const r = run(['python3', '/app/shared/skills/first_run.py', 'mentor-due'], { timeoutMs: 15_000 });
  return r?.code === 1;
}

const MENTOR_WAITING = 'not yet active (it starts when the first positions have a score)';

// Disco quasi pieno (< 3% libero): nessun NUOVO avvio. Si chiede PRIMA di far
// nascere una sessione, dopo che il controllo «gia' attiva» ha lasciato stare
// quelle vive: un agente in corso non viene toccato. Il codice e' chiuso
// (`disk_low`), la frase viene dalla tabella codice->frase, non da qui.
// Se il disco non si misura, si parte: la guardia rifiuta solo su una misura.
function refuseIfDiskLow(label) {
  const refusal = diskLowRefusal();
  if (!refusal) return false;
  console.log(`  ${c.red('✗')} ${label} — ${refusal.code}${refusal.message ? `: ${refusal.message}` : ''}`);
  return true;
}

// The roster names a session without the host's JHT- prefix, in both modes.
function rosterSession(role, instance) {
  const agent = AGENTS.find((a) => a.role === role);
  if (!agent) return null;
  return agent.multi && instance ? `${agent.prefix}-${instance}` : agent.prefix;
}

// «Stop» in the app holds the agent down (a hold by the user in the roster): the watchdog stops again
// whatever is started while the hold stands. A start the user asks for here lifts those holds, all of
// them for the whole team or the named agent's for a single start; the holds of the Captain, the doctor,
// the budget or a security check are not the user's to lift and stay. If it cannot be done the start
// goes on and says so: it is what happened before, not a new refusal.
export function releaseUserHolds(agentArg, containerMode, { run } = {}) {
  let sessions = [];
  if (agentArg) {
    const parsed = parseAgentArg(agentArg);
    const session = parsed ? rosterSession(parsed.role, parsed.instance) : null;
    if (!session) return { ok: true, lifted: [] };
    sessions = [session];
  }
  const args = ['release-user', ...sessions];
  let result;
  try {
    if (run) {
      result = run(args);
    } else if (containerMode) {
      result = execScriptInContainer('/app/shared/skills/team_roster.py', args, {
        interpreter: 'python3', env: { JHT_HOME: '/jht_home' },
      });
    } else {
      const { repoRoot } = resolveConfig();
      if (!repoRoot) return { ok: false, lifted: [], error: 'the team folder was not found' };
      const script = join(repoRoot, 'shared', 'skills', 'team_roster.py');
      const done = spawnSync('python3', [script, ...args], {
        encoding: 'utf8', timeout: 30_000, env: { ...process.env, JHT_HOME },
      });
      result = { code: done.status ?? -1, stdout: done.stdout || '', stderr: done.stderr || '' };
    }
  } catch (err) {
    return { ok: false, lifted: [], error: err?.message || String(err) };
  }
  if (result.code !== 0) {
    return { ok: false, lifted: [], error: String(result.stderr || result.stdout || `exit code ${result.code}`).trim() };
  }
  try {
    const lifted = JSON.parse(String(result.stdout).trim() || '[]');
    return { ok: true, lifted: Array.isArray(lifted) ? lifted : [] };
  } catch {
    return { ok: false, lifted: [], error: 'unreadable answer' };
  }
}

function reportUserHolds(agentArg, containerMode) {
  const done = releaseUserHolds(agentArg, containerMode);
  if (!done.ok) {
    console.log(c.dim(`  ℹ holds set by Stop not lifted: ${done.error.split('\n').slice(-1)[0]}`));
  } else if (done.lifted.length) {
    console.log(c.dim(`  ℹ lifted the Stop on ${done.lifted.join(', ')}`));
  }
}

// Uno stop globale crea il gate nel runtime che possiede gli agenti. Start
// deve rimuoverlo NELLO STESSO runtime e osservare l'effetto prima di lanciare
// qualunque TUI: un `rm` richiesto ma non applicato non è uno Start riuscito.
function clearGlobalHaltGate(containerMode) {
  if (containerMode) {
    const removed = execArgvInContainer(['rm', '-f', CONTAINER_TEAM_HALTED_FLAG]);
    if (removed.code !== 0) {
      return {
        ok: false,
        error: removed.stderr || removed.stdout || 'container refused to remove the halt gate',
      };
    }
    const absent = execArgvInContainer(['test', '!', '-e', CONTAINER_TEAM_HALTED_FLAG]);
    if (absent.code !== 0) {
      return { ok: false, error: `${CONTAINER_TEAM_HALTED_FLAG} is still present` };
    }
    return { ok: true, error: '' };
  }

  const haltedFlag = join(JHT_HOME, '.team-halted.flag');
  try {
    if (existsSync(haltedFlag)) unlinkSync(haltedFlag);
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
  if (existsSync(haltedFlag)) {
    return { ok: false, error: `${haltedFlag} is still present` };
  }
  return { ok: true, error: '' };
}

// What the best-effort cloud steps of a start say when they fail. Two things on stderr are not a reason:
// «not enabled» as the last line (a machine without a cloud has nothing to sync: it is no failure) and Node's own
// warnings (SQLite is experimental in Node 22: «(Use `node --trace-warnings ...`)» was printed as the reason).
const NOT_ENABLED = /non abilitato|not enabled/i;
const NODE_WARNING_LINE = /^\(node:\d+\) |^\(Use `node --trace-(warnings|deprecation)/;

export function syncNotApplied(label, res) {
  if (!res || res.code === 0) return null;
  const reason = String(res.stderr ?? '').trim().split('\n').map((line) => line.trim())
    .filter((line) => line && !NODE_WARNING_LINE.test(line)).slice(-1)[0];
  // «not enabled» is the reason itself (the last line), not a word somewhere in the output.
  if (reason && NOT_ENABLED.test(reason)) return null;
  // A step that failed says so even when all it left on stderr was Node's own warnings.
  return `  ℹ ${label} not applied: ${reason ?? `exit code ${res.code ?? 'unknown'}`}`;
}

function reportSyncNotApplied(label, res) {
  const note = syncNotApplied(label, res);
  if (note) console.log(c.dim(note));
}

// ── Container mode ─────────────────────────────────────────────────
async function startActionContainer(agentArg, options = {}, releaseHaltGate = () => true) {
  const mode = options.mode || 'default';

  // Senza arg: bootstrap completo (SENTINELLA + BRIDGE + CAPITANO),
  // come fa la web UI. Con arg: lancia il singolo agente specificato.
  const useBootstrap = !agentArg;
  const bootstrap = useBootstrap ? buildContainerBootstrap() : null;

  console.log('');
  console.log(c.bold('Starting agents in the jht container...'));
  console.log(c.dim(`  Mode: ${mode}${useBootstrap ? '  | Bootstrap: ASSISTENTE + TG-BRIDGE + SENTINELLA + BRIDGE + TOKEN-METER + CAPITANO' : ''}`));
  console.log('');

  let started = 0;
  let skipped = 0;
  let errored = 0;
  let deferred = 0;
  // La UI definisce il team operativo dalla presenza del CAPITANO. Tenere
  // separato questo esito dal conteggio aggregato evita il falso successo
  // osservato in #129: Assistente/Sentinella partivano, CAPITANO falliva, ma
  // `started > 0` lasciava exit 0 e il pulsante tornava inattivo mentre il
  // watchdog tentava ancora il recupero.
  let coordinatorReady = !useBootstrap;

  if (useBootstrap) {
    // Un secondo click su "Avvia team" mentre il core e' gia' operativo non
    // deve rifare quattro sync cloud, riavviare i daemon bridge e ripetere gli
    // stagger. Oltre a 30-40 secondi di attesa, quel lavoro interrompeva
    // processi sani proprio mentre l'utente cercava soltanto conferma. I
    // watchdog del container sorvegliano separatamente bridge e worker: con i
    // quattro agenti core vivi, Start e' quindi un no-op idempotente.
    const mentorWaits = !isSessionActive('MENTOR') && mentorDeferred();
    const coreSessions = ['ASSISTENTE', 'SENTINELLA', ...(mentorWaits ? [] : ['MENTOR']), 'CAPITANO'];
    if (coreSessions.every((session) => isSessionActive(session))) {
      for (const session of coreSessions) {
        console.log(`  ${c.yellow('⏭')} ${session} — already active`);
      }
      if (!releaseHaltGate()) return;
      console.log('');
      console.log(`Result: ${c.green('0 started')}, ${c.yellow(`${coreSessions.length} already active`)}`);
      if (mentorWaits) console.log(c.dim(`  MENTOR ${MENTOR_WAITING}`));
      console.log(c.dim('  Team already running: no bridge or sync process restarted.'));
      console.log('');
      return;
    }

    // Qualcosa da avviare c'e': sotto il 3% di disco libero non si avvia niente,
    // ne' le sincronizzazioni cloud che scrivono su disco.
    if (refuseIfDiskLow('team')) {
      console.log('');
      process.exitCode = 1;
      return;
    }

    // Da qui lo start parte davvero: ora lo stop dell'utente si toglie.
    if (!releaseHaltGate()) return;

    // Pull desired-state cloud → SQLite locale PRIMA dello spawn agenti:
    // recupera write_requested cliccato via web mentre container era
    // offline. Senza questo step, il Capitano non vede mai i flag toggle-on
    // arrivati durante il downtime (P0 [JHT-CLOUDSYNC-01]).
    // Best-effort: timeout 15s, errori non bloccano. Skip silenzioso se
    // cloud non abilitato (Local PC mode senza sync).
    const pullRes = execInContainer(
      'node /app/cli/bin/jht.js cloud pull-desired-state --silent',
      { timeoutMs: 15_000 },
    );
    reportSyncNotApplied('desired-state pull', pullRes);

    // Sync ticket cloud↔VPS PRIMA dello spawn: importa i ticket 'open' creati
    // dal web durante il downtime così il Capitano (C-15) li vede al primo giro,
    // e pusha eventuali risoluzioni rimaste in sospeso. Best-effort 15s.
    const ticketRes = execInContainer(
      'node /app/cli/bin/jht.js cloud sync-tickets --silent',
      { timeoutMs: 15_000 },
    );
    reportSyncNotApplied('ticket sync', ticketRes);

    // Sync bacheca (team_directives) cloud↔VPS PRIMA dello spawn: importa gli
    // ordini/strategia editati dal dashboard così il Capitano li legge al primo
    // giro (team_directives.py active), e pusha le direttive nate da chat.
    const dirRes = execInContainer(
      'node /app/cli/bin/jht.js cloud sync-directives --silent',
      { timeoutMs: 15_000 },
    );
    reportSyncNotApplied('directive sync', dirRes);

    // Pull profilo cloud → candidate_profile.yml se il file locale manca
    // (PC nuovo / container ricreato): chiude il cerchio cloud→locale. Only-if
    // -absent (non sovrascrive un profilo locale esistente). Best-effort 15s.
    const profileRes = execInContainer(
      'node /app/cli/bin/jht.js cloud pull-profile --silent',
      { timeoutMs: 15_000 },
    );
    reportSyncNotApplied('profile pull', profileRes);

    // Il delay di ogni voce serve a far stabilizzare la voce precedente. In
    // un retry idempotente, se la precedente era già attiva, ripetere tutti i
    // 41 secondi di attesa non protegge nulla e fa sembrare morto il click.
    let previousStarted = false;
    for (const item of bootstrap) {
      if (item.role === 'mentor' && mentorWaits) {
        console.log(`  ${c.yellow('⏭')} MENTOR — ${MENTOR_WAITING}`);
        deferred++;
        continue;
      }
      if (previousStarted && item.preDelayMs && item.preDelayMs > 0) {
        console.log(c.dim(`  ⏳ Waiting ${Math.round(item.preDelayMs / 1000)}s before ${item.session}...`));
        await sleep(item.preDelayMs);
      }
      const result = launchInContainer({ role: item.role, instance: null, mode, env: item.env, notATmuxSession: item.notATmuxSession, sessionLabel: item.session });
      if (result === 'started') started++;
      else if (result === 'skipped') skipped++;
      else errored++;
      if (item.role === 'capitano') coordinatorReady = result !== 'error';
      previousStarted = result === 'started';
    }
  } else {
    const parsed = parseAgentArg(agentArg);
    if (!parsed) {
      console.log(`  ${c.red('✗')} ${agentArg} — unrecognized role`);
      errored++;
    } else if (parsed.role === 'mentor' && !isSessionActive('MENTOR') && mentorDeferred()) {
      console.log(`  ${c.yellow('⏭')} MENTOR — ${MENTOR_WAITING}`);
      deferred++;
    } else {
      // a single start never lifts the global stop, but the agent's own Stop by the user goes
      reportUserHolds(agentArg, true);
      const result = launchInContainer({ role: parsed.role, instance: parsed.instance, mode });
      if (result === 'started') started++;
      else if (result === 'skipped') skipped++;
      else errored++;
    }
  }

  console.log('');
  console.log(`Result: ${c.green(started + ' started')}, ${c.yellow(skipped + ' already active')}${errored ? `, ${c.red(errored + ' errors')}` : ''}`);
  if (useBootstrap) {
    console.log(c.dim('  CAPITANO will scale the other agents according to the Bridge thresholds.'));
  }
  console.log('');

  // Il bootstrap globale è riuscito soltanto quando il suo marker operativo
  // (CAPITANO) è partito o era già attivo. Un avvio parziale resta utile al
  // watchdog, ma NON è un successo da mostrare all'utente. Per lo start di un
  // singolo agente resta il contratto storico: started/skipped sono successi.
  // Exit 1 quando nessun agente è stato avviato e nessuno era già attivo:
  // il poller (cli/src/lib/team-commands-poller.js) usa l'exit code per
  // marcare team_commands.status='error' invece di 'done' silent. Skipped
  // (= già attivo) conta come success per l'utente.
  //
  // `process.exitCode` e non `process.exit()`: il poller lancia `jht team start`
  // come processo figlio e ne legge lo stdout oltre al codice, quindi troncare
  // l'output con un'uscita immediata gli toglierebbe proprio le righe d'errore
  // che registra. Il codice osservato non cambia: questa è l'ultima istruzione
  // della funzione. Vedi [CLI-NO-GLOBAL-ERROR-HANDLER].
  if ((useBootstrap && !coordinatorReady)
      || (!useBootstrap && started === 0 && skipped === 0 && deferred === 0)) {
    process.exitCode = 1;
  }
}

function launchInContainer({ role, instance, mode, env, notATmuxSession, sessionLabel }) {
  const sName = sessionLabel || sessionName(role, instance);

  // Skip has-session check per i ruoli non-tmux (bridge): start-agent.sh
  // gestisce il singleton internamente via /proc cmdline scan.
  if (!notATmuxSession && isSessionActive(sName)) {
    console.log(`  ${c.yellow('⏭')} ${sName} — already active`);
    return 'skipped';
  }

  if (refuseIfDiskLow(sName)) return 'error';

  const agent = AGENTS.find((a) => a.role === role);
  const useInstance = agent?.multi && instance;
  const scriptArgs = useInstance ? [role, instance] : [role];

  // Argomenti ed env passati separati (docker exec -e / spawn env): niente
  // stringa di shell da quotare a mano, quindi niente quarta variante di
  // escaping da tenere allineata alle altre tre.
  // This variable must be copied explicitly: execScriptInContainer forwards
  // only the keys listed here across `docker exec`, so inheriting it in the
  // host-side CLI process is not enough.
  const childEnv = {
    JHT_SPAWN_SRC: process.env.JHT_SPAWN_SRC || 'cli-team-start',
    ...(mode === 'fast' ? { JHT_MODE: 'fast' } : {}),
    ...(env || {}),
  };
  const r = execScriptInContainer('/app/.launcher/start-agent.sh', scriptArgs, {
    env: Object.keys(childEnv).length ? childEnv : null,
    // Cold starts can spend close to 30s in provider/config preflight before
    // start-agent.sh confirms the tmux session. The generic container helper
    // default was therefore a race that surfaced as an empty "unknown error".
    timeoutMs: 90_000,
  });
  if (r.code === 0) {
    console.log(`  ${c.green('✓')} ${sName} started`);
    return 'started';
  }
  const msg = spawnErrorTail(r.stderr || r.stdout);
  console.log(`  ${c.red('✗')} ${sName} — ${msg.replace(/\n/g, '\n      ')}`);
  return 'error';
}

// Cosa deve esserci perche' lo start abbia una possibilita': il provider attivo e,
// fuori dal container, tmux e la CLI di quel provider (dentro, ci sono nel container).
// Null quando si puo' partire, altrimenti la frase del rifiuto. Il gate dello stop si
// toglie solo dopo di questo: uno start che non puo' partire non annulla lo stop.
export function startRefusal(config, { containerMode, hasTmux = tmuxAvailable, hasCli = cliAvailable } = {}) {
  const cliBin = providerCli(config);
  if (!cliBin) return 'no active provider. Run: jht providers use openai';
  if (containerMode) return null;
  if (!hasTmux()) return 'tmux not found. Install it with: brew install tmux';
  if (!hasCli(cliBin)) return `the ${cliBin} CLI of the active provider was not found.`;
  return null;
}

export async function startAction(agentArg, options) {
  // Uno STOP d'emergenza/desired-state e il primo setup lasciano questo gate
  // per impedire ai watchdog di riaccendere il team. Un successivo Start
  // ESPLICITO dell'utente sul cockpit/CLI è la via di recupero; lo start di un
  // singolo agente (per esempio l'Assistente del profilo) non lo rimuove, così
  // un processo interno non può annullare lo stop globale.
  // Il gate si toglie dopo i prerequisiti (startRefusal e, nel container, il disco):
  // se lo start non puo' partire il team resta fermo com'era, con lo stop in piedi.
  const containerMode = usingContainer();
  if (!agentArg || !containerMode) {
    const refusal = startRefusal(readJhtConfig(), { containerMode });
    if (refusal) {
      console.error(c.red(`Error: ${refusal}`));
      process.exitCode = 1;
      return;
    }
  }
  const releaseHaltGate = () => {
    if (!agentArg) {
      const gate = clearGlobalHaltGate(containerMode);
      if (!gate.ok) {
        console.error(c.red(`Unable to resume the team: ${String(gate.error).trim()}`));
        process.exitCode = 1;
        return false;
      }
    }
    // the person's per-agent Stop goes with it, once the start can really go ahead
    reportUserHolds(agentArg, containerMode);
    return true;
  };

  // Container mode: deleghiamo a /app/.launcher/start-agent.sh dentro
  // jht — coerente col boot del bridge Sentinella e con le dipendenze CLI
  // installate nell'immagine. (Era la stessa logica della route web
  // `/api/team/start-all`, rimossa il 2026-07-25.)
  if (containerMode) {
    return await startActionContainer(agentArg, options, releaseHaltGate);
  }

  // Fuori dal container tmux, provider e CLI sono gia' stati verificati (startRefusal).
  if (!releaseHaltGate()) return;

  const { repoRoot } = resolveConfig();
  const mode = options.mode || 'default';
  const targets = agentArg ? [agentArg] : DEFAULT_TEAM;

  console.log('');
  console.log(c.bold('Starting agents...'));
  console.log(c.dim(`  Mode: ${mode} | JHT_HOME: ${JHT_HOME}`));
  console.log(c.dim(`  JHT_USER_DIR: ${JHT_USER_DIR}`));
  console.log('');

  let started = 0;
  let skipped = 0;

  for (const target of targets) {
    const parsed = parseAgentArg(target);
    if (!parsed) {
      console.log(`  ${c.red('✗')} ${target} — unrecognized role`);
      continue;
    }

    const { role, instance } = parsed;
    const agent = AGENTS.find((a) => a.role === role);
    const sName = sessionName(role, instance);

    if (isSessionActive(sName)) {
      console.log(`  ${c.yellow('⏭')} ${sName} — already active`);
      skipped++;
      continue;
    }

    if (refuseIfDiskLow(sName)) {
      process.exitCode = 1;
      continue;
    }

    let effort = agent.effort;
    if (mode === 'fast') effort = 'low';

    const agentDir = getAgentDir(role, agent.multi ? instance : null);
    if (!existsSync(agentDir)) mkdirSync(agentDir, { recursive: true });

    if (repoRoot) {
      const template = join(repoRoot, 'agents', role, `${role}.md`);
      const dest = join(agentDir, 'CLAUDE.md');
      if (!existsSync(dest) && existsSync(template)) copyFileSync(template, dest);
    }

    const envVars = {
      JHT_HOME,
      JHT_USER_DIR,
      JHT_DB: JHT_DB_PATH,
      JHT_CONFIG: JHT_CONFIG_PATH,
      JHT_AGENT_DIR: agentDir,
    };

    try {
      execSync(`tmux new-session -d -s "${sName}" -c "${agentDir}"`, { stdio: 'ignore' });
      for (const [k, v] of Object.entries(envVars)) {
        execSync(`tmux send-keys -t "${sName}" "export ${k}='${shellEscape(v)}'" C-m`, { stdio: 'ignore' });
      }
      execSync(`tmux send-keys -t "${sName}" "claude --dangerously-skip-permissions --effort ${effort}" C-m`, { stdio: 'ignore' });
      spawn('bash', ['-c', `sleep 4 && tmux send-keys -t "${sName}" Enter && sleep 3 && tmux send-keys -t "${sName}" Enter`], {
        detached: true, stdio: 'ignore',
      }).unref();
      console.log(`  ${c.green('✓')} ${sName} started (effort: ${effort})`);
      started++;
    } catch (err) {
      console.log(`  ${c.red('✗')} ${sName} — start error: ${err.message}`);
    }
  }

  console.log('');
  console.log(`Result: ${c.green(started + ' started')}, ${c.yellow(skipped + ' already active')}`);
  console.log('');
}
