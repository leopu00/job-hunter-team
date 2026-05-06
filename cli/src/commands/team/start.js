// Comando team start
import { execSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import {
  AGENTS, DEFAULT_TEAM, c,
  tmuxAvailable, claudeAvailable, isSessionActive,
  sessionName, parseAgentArg, resolveConfig, getAgentDir, usingContainer,
  JHT_HOME, JHT_USER_DIR, JHT_DB_PATH, JHT_CONFIG_PATH,
} from './agents.js';
import { execInContainer } from '../../utils/container-proxy.js';

function shellEscape(value) {
  return String(value).replace(/'/g, "'\\''");
}

// Tick idle (default 10 min, range 1-60): il bridge usa questo come
// ceiling a riposo, ma adatta dinamicamente in alto (fino a 1 min)
// quando status CRITICO / host saturo / team operativo attivo. Stesso
// fallback della web UI in /api/team/start-all/route.ts.
function readSentinellaTickMinutes() {
  try {
    const cfg = JSON.parse(readFileSync(JHT_CONFIG_PATH, 'utf-8'));
    const n = Number(cfg?.sentinella_tick_minutes);
    if (Number.isFinite(n) && n >= 1 && n <= 60) return Math.round(n);
  } catch { /* fallback */ }
  return 10;
}

// Bootstrap container del team — replica `/api/team/start-all` (web UI).
// Sequenza V5 ordinata (rivista 2026-04-26):
//   1. SENTINELLA: tmux session + CLI boot + kick-off, da SOLA (cosi' e'
//      pronta a ricevere il primo [BRIDGE TICK])
//   2. BRIDGE: processo Python background (sentinel-bridge.py +
//      pacing-bridge.py spawned da start-agent.sh quando role=bridge).
//      Pre-delay 20s per dare tempo al CLI Sentinella di stabilizzarsi.
//   3. CAPITANO: tmux session + CLI boot + kick-off, lanciato per ULTIMO
//      cosi' quando parte il monitoring e' gia' stabile e ha almeno un
//      sample fresco. Pre-delay 5s.
// Gli altri agenti (Scout, Analista, Scorer, Scrittore, Critico) li
// scala il Capitano secondo le sue soglie, leggendo lo stato Bridge.
function buildContainerBootstrap() {
  const tickMin = readSentinellaTickMinutes();
  return [
    { role: 'sentinella', session: 'SENTINELLA' },
    {
      role: 'bridge', session: 'BRIDGE', notATmuxSession: true,
      preDelayMs: 20000, env: { JHT_TARGET_SESSION: 'CAPITANO' },
    },
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
  console.log(c.dim(`  Mode: ${mode}${useBootstrap ? '  | Bootstrap: SENTINELLA + BRIDGE + CAPITANO' : ''}`));
  console.log('');

  let started = 0;
  let skipped = 0;

  if (useBootstrap) {
    for (const item of bootstrap) {
      if (item.preDelayMs && item.preDelayMs > 0) {
        console.log(c.dim(`  ⏳ Attendo ${Math.round(item.preDelayMs / 1000)}s prima di ${item.session}...`));
        await sleep(item.preDelayMs);
      }
      const result = launchInContainer({ role: item.role, instance: null, mode, env: item.env, notATmuxSession: item.notATmuxSession, sessionLabel: item.session });
      if (result === 'started') started++;
      else if (result === 'skipped') skipped++;
    }
  } else {
    const parsed = parseAgentArg(agentArg);
    if (!parsed) {
      console.log(`  ${c.red('✗')} ${agentArg} — ruolo non riconosciuto`);
    } else {
      const result = launchInContainer({ role: parsed.role, instance: parsed.instance, mode });
      if (result === 'started') started++;
      else if (result === 'skipped') skipped++;
    }
  }

  console.log('');
  console.log(`Risultato: ${c.green(started + ' avviati')}, ${c.yellow(skipped + ' gia attivi')}`);
  if (useBootstrap) {
    console.log(c.dim('  Il Capitano scalera' + ' gli altri agenti secondo le soglie del Bridge.'));
  }
  console.log('');
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
  const quoted = scriptArgs.map((a) => `'${shellEscape(a)}'`).join(' ');

  const envParts = [];
  if (mode === 'fast') envParts.push("JHT_MODE='fast'");
  if (env) {
    for (const [k, v] of Object.entries(env)) {
      envParts.push(`${k}='${shellEscape(v)}'`);
    }
  }
  const prefix = envParts.length ? envParts.join(' ') + ' ' : '';
  const cmd = `${prefix}bash /app/.launcher/start-agent.sh ${quoted}`;
  const r = execInContainer(cmd);
  if (r.code === 0) {
    console.log(`  ${c.green('✓')} ${sName} avviato`);
    return 'started';
  }
  const msg = (r.stderr || r.stdout || 'errore').split('\n').filter(Boolean).slice(-1)[0];
  console.log(`  ${c.red('✗')} ${sName} — ${msg}`);
  return 'error';
}

export async function startAction(agentArg, options) {
  // Container mode: deleghiamo a /app/.launcher/start-agent.sh dentro
  // jht. Stessa identica logica della web UI (/api/team/start-all),
  // coerente col boot del bridge Sentinella e con le dipendenze CLI
  // installate nell'immagine.
  if (usingContainer()) {
    return await startActionContainer(agentArg, options);
  }

  if (!tmuxAvailable()) {
    console.error(c.red('Errore: tmux non trovato. Installa con: brew install tmux'));
    process.exit(1);
  }
  if (!claudeAvailable()) {
    console.error(c.red('Errore: Claude CLI non trovato.'));
    process.exit(1);
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
