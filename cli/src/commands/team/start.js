// Comando team start
import { execSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, mkdirSync, copyFileSync, readFileSync, unlinkSync } from 'node:fs';
import {
  AGENTS, DEFAULT_TEAM, c,
  tmuxAvailable, claudeAvailable, isSessionActive,
  sessionName, parseAgentArg, resolveConfig, getAgentDir, usingContainer,
  JHT_HOME, JHT_USER_DIR, JHT_DB_PATH, JHT_CONFIG_PATH,
} from './agents.js';
import { execInContainer, execScriptInContainer } from '../../utils/container-proxy.js';

// Serve solo al path host legacy (tmux fuori dal container): dentro al
// container gli argomenti passano separati, senza shell di mezzo.
function shellEscape(value) {
  return String(value).replace(/'/g, "'\\''");
}

// Tick idle (default 10 min, range 1-60): il bridge usa questo come
// ceiling a riposo, ma adatta dinamicamente in alto (fino a 1 min)
// quando status CRITICO / host saturo / team operativo attivo. Questo
// era anche il fallback della route web `/api/team/start-all`, rimossa il
// 2026-07-25 con la dashboard locale: ora il default vive solo qui.
function readSentinellaTickMinutes() {
  try {
    const cfg = JSON.parse(readFileSync(JHT_CONFIG_PATH, 'utf-8'));
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

// ── Container mode ─────────────────────────────────────────────────
async function startActionContainer(agentArg, options = {}) {
  const mode = options.mode || 'default';

  // Senza arg: bootstrap completo (SENTINELLA + BRIDGE + CAPITANO),
  // come fa la web UI. Con arg: lancia il singolo agente specificato.
  const useBootstrap = !agentArg;
  const bootstrap = useBootstrap ? buildContainerBootstrap() : null;

  console.log('');
  console.log(c.bold('Avvio agenti nel container jht...'));
  console.log(c.dim(`  Mode: ${mode}${useBootstrap ? '  | Bootstrap: ASSISTENTE + TG-BRIDGE + SENTINELLA + BRIDGE + TOKEN-METER + CAPITANO' : ''}`));
  console.log('');

  let started = 0;
  let skipped = 0;
  let errored = 0;

  if (useBootstrap) {
    // Un secondo click su "Avvia team" mentre il core e' gia' operativo non
    // deve rifare quattro sync cloud, riavviare i daemon bridge e ripetere gli
    // stagger. Oltre a 30-40 secondi di attesa, quel lavoro interrompeva
    // processi sani proprio mentre l'utente cercava soltanto conferma. I
    // watchdog del container sorvegliano separatamente bridge e worker: con i
    // quattro agenti core vivi, Start e' quindi un no-op idempotente.
    const coreSessions = ['ASSISTENTE', 'SENTINELLA', 'MENTOR', 'CAPITANO'];
    if (coreSessions.every((session) => isSessionActive(session))) {
      for (const session of coreSessions) {
        console.log(`  ${c.yellow('⏭')} ${session} — gia attivo`);
      }
      console.log('');
      console.log(`Risultato: ${c.green('0 avviati')}, ${c.yellow('4 gia attivi')}`);
      console.log(c.dim('  Team gia operativo: nessun bridge o sync riavviato.'));
      console.log('');
      return;
    }

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
    if (pullRes.code !== 0 && pullRes.stderr && !/non abilitato/i.test(pullRes.stderr)) {
      const lastLine = pullRes.stderr.trim().split('\n').slice(-1)[0];
      console.log(c.dim(`  ℹ pull desired-state non applicato: ${lastLine}`));
    }

    // Sync ticket cloud↔VPS PRIMA dello spawn: importa i ticket 'open' creati
    // dal web durante il downtime così il Capitano (C-15) li vede al primo giro,
    // e pusha eventuali risoluzioni rimaste in sospeso. Best-effort 15s.
    const ticketRes = execInContainer(
      'node /app/cli/bin/jht.js cloud sync-tickets --silent',
      { timeoutMs: 15_000 },
    );
    if (ticketRes.code !== 0 && ticketRes.stderr && !/non abilitato/i.test(ticketRes.stderr)) {
      const lastLine = ticketRes.stderr.trim().split('\n').slice(-1)[0];
      console.log(c.dim(`  ℹ ticket-sync non applicato: ${lastLine}`));
    }

    // Sync bacheca (team_directives) cloud↔VPS PRIMA dello spawn: importa gli
    // ordini/strategia editati dal dashboard così il Capitano li legge al primo
    // giro (team_directives.py active), e pusha le direttive nate da chat.
    const dirRes = execInContainer(
      'node /app/cli/bin/jht.js cloud sync-directives --silent',
      { timeoutMs: 15_000 },
    );
    if (dirRes.code !== 0 && dirRes.stderr && !/non abilitato/i.test(dirRes.stderr)) {
      const lastLine = dirRes.stderr.trim().split('\n').slice(-1)[0];
      console.log(c.dim(`  ℹ directive-sync non applicato: ${lastLine}`));
    }

    // Pull profilo cloud → candidate_profile.yml se il file locale manca
    // (PC nuovo / container ricreato): chiude il cerchio cloud→locale. Only-if
    // -absent (non sovrascrive un profilo locale esistente). Best-effort 15s.
    const profileRes = execInContainer(
      'node /app/cli/bin/jht.js cloud pull-profile --silent',
      { timeoutMs: 15_000 },
    );
    if (profileRes.code !== 0 && profileRes.stderr && !/non abilitato/i.test(profileRes.stderr)) {
      const lastLine = profileRes.stderr.trim().split('\n').slice(-1)[0];
      console.log(c.dim(`  ℹ pull profilo non applicato: ${lastLine}`));
    }

    // Il delay di ogni voce serve a far stabilizzare la voce precedente. In
    // un retry idempotente, se la precedente era già attiva, ripetere tutti i
    // 41 secondi di attesa non protegge nulla e fa sembrare morto il click.
    let previousStarted = false;
    for (const item of bootstrap) {
      if (previousStarted && item.preDelayMs && item.preDelayMs > 0) {
        console.log(c.dim(`  ⏳ Attendo ${Math.round(item.preDelayMs / 1000)}s prima di ${item.session}...`));
        await sleep(item.preDelayMs);
      }
      const result = launchInContainer({ role: item.role, instance: null, mode, env: item.env, notATmuxSession: item.notATmuxSession, sessionLabel: item.session });
      if (result === 'started') started++;
      else if (result === 'skipped') skipped++;
      else errored++;
      previousStarted = result === 'started';
    }
  } else {
    const parsed = parseAgentArg(agentArg);
    if (!parsed) {
      console.log(`  ${c.red('✗')} ${agentArg} — ruolo non riconosciuto`);
      errored++;
    } else {
      const result = launchInContainer({ role: parsed.role, instance: parsed.instance, mode });
      if (result === 'started') started++;
      else if (result === 'skipped') skipped++;
      else errored++;
    }
  }

  console.log('');
  console.log(`Risultato: ${c.green(started + ' avviati')}, ${c.yellow(skipped + ' gia attivi')}${errored ? `, ${c.red(errored + ' errori')}` : ''}`);
  if (useBootstrap) {
    console.log(c.dim('  Il Capitano scalera' + ' gli altri agenti secondo le soglie del Bridge.'));
  }
  console.log('');

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
  if (started === 0 && skipped === 0) {
    process.exitCode = 1;
  }
}

function launchInContainer({ role, instance, mode, env, notATmuxSession, sessionLabel }) {
  const sName = sessionLabel || sessionName(role, instance);

  // Skip has-session check per i ruoli non-tmux (bridge): start-agent.sh
  // gestisce il singleton internamente via /proc cmdline scan.
  if (!notATmuxSession && isSessionActive(sName)) {
    console.log(`  ${c.yellow('⏭')} ${sName} — gia attivo`);
    return 'skipped';
  }

  const agent = AGENTS.find((a) => a.role === role);
  const useInstance = agent?.multi && instance;
  const scriptArgs = useInstance ? [role, instance] : [role];

  // Argomenti ed env passati separati (docker exec -e / spawn env): niente
  // stringa di shell da quotare a mano, quindi niente quarta variante di
  // escaping da tenere allineata alle altre tre.
  const childEnv = { ...(mode === 'fast' ? { JHT_MODE: 'fast' } : {}), ...(env || {}) };
  const r = execScriptInContainer('/app/.launcher/start-agent.sh', scriptArgs, {
    env: Object.keys(childEnv).length ? childEnv : null,
  });
  if (r.code === 0) {
    console.log(`  ${c.green('✓')} ${sName} avviato`);
    return 'started';
  }
  const msg = (r.stderr || r.stdout || 'errore').split('\n').filter(Boolean).slice(-1)[0];
  console.log(`  ${c.red('✗')} ${sName} — ${msg}`);
  return 'error';
}

export async function startAction(agentArg, options) {
  // Uno STOP d'emergenza/desired-state lascia questo gate per impedire ai
  // watchdog di riaccendere il team. Un successivo Start ESPLICITO dell'utente
  // sul cockpit/CLI deve essere la via di recupero; il singolo-agent start non
  // lo rimuove, così un processo interno non può annullare lo stop globale.
  if (!agentArg) {
    const haltedFlag = join(JHT_HOME, '.team-halted.flag');
    if (existsSync(haltedFlag)) {
      try { unlinkSync(haltedFlag); } catch { /* start mostrerà l'eventuale errore reale */ }
    }
  }

  // Container mode: deleghiamo a /app/.launcher/start-agent.sh dentro
  // jht — coerente col boot del bridge Sentinella e con le dipendenze CLI
  // installate nell'immagine. (Era la stessa logica della route web
  // `/api/team/start-all`, rimossa il 2026-07-25.)
  if (usingContainer()) {
    return await startActionContainer(agentArg, options);
  }

  if (!tmuxAvailable()) {
    console.error(c.red('Errore: tmux non trovato. Installa con: brew install tmux'));
    process.exitCode = 1;
    return;
  }
  if (!claudeAvailable()) {
    console.error(c.red('Errore: Claude CLI non trovato.'));
    process.exitCode = 1;
    return;
  }

  const { repoRoot } = resolveConfig();
  const mode = options.mode || 'default';
  const targets = agentArg ? [agentArg] : DEFAULT_TEAM;

  console.log('');
  console.log(c.bold('Avvio agenti...'));
  console.log(c.dim(`  Mode: ${mode} | JHT_HOME: ${JHT_HOME}`));
  console.log(c.dim(`  JHT_USER_DIR: ${JHT_USER_DIR}`));
  console.log('');

  let started = 0;
  let skipped = 0;

  for (const target of targets) {
    const parsed = parseAgentArg(target);
    if (!parsed) {
      console.log(`  ${c.red('✗')} ${target} — ruolo non riconosciuto`);
      continue;
    }

    const { role, instance } = parsed;
    const agent = AGENTS.find((a) => a.role === role);
    const sName = sessionName(role, instance);

    if (isSessionActive(sName)) {
      console.log(`  ${c.yellow('⏭')} ${sName} — gia attivo`);
      skipped++;
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
      console.log(`  ${c.green('✓')} ${sName} avviato (effort: ${effort})`);
      started++;
    } catch (err) {
      console.log(`  ${c.red('✗')} ${sName} — errore avvio: ${err.message}`);
    }
  }

  console.log('');
  console.log(`Risultato: ${c.green(started + ' avviati')}, ${c.yellow(skipped + ' gia attivi')}`);
  console.log('');
}
