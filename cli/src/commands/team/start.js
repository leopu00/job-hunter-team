// Comando team start
import { execSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import {
  AGENTS, DEFAULT_TEAM, c,
  tmuxAvailable, claudeAvailable, isSessionActive,
  sessionName, parseAgentArg, resolveConfig, getAgentDir, usingContainer,
  JHT_HOME, JHT_USER_DIR, JHT_DB_PATH, JHT_CONFIG_PATH,
} from './agents.js';
import { execInContainer } from '../../utils/container-proxy.js';

// In container mode il default team e' solo CAPITANO + SENTINELLA: il
// Capitano poi scala il resto secondo le sue soglie (come fa la web UI
// via /api/team/start-all). Su host legacy teniamo il default completo.
const DEFAULT_TEAM_CONTAINER = ['capitano', 'sentinella'];

function shellEscape(value) {
  return String(value).replace(/'/g, "'\\''");
}

// ── Container mode ─────────────────────────────────────────────────
function startActionContainer(agentArg, options = {}) {
  const mode = options.mode || 'default';
  const targets = agentArg ? [agentArg] : DEFAULT_TEAM_CONTAINER;

  console.log('');
  console.log(c.bold('Avvio agenti nel container jht...'));
  console.log(c.dim(`  Mode: ${mode}`));
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
    const sName = sessionName(role, instance);

    if (isSessionActive(sName)) {
      console.log(`  ${c.yellow('⏭')} ${sName} — gia attivo`);
      skipped++;
      continue;
    }

    // Delego tutto a /app/.launcher/start-agent.sh: template CLAUDE.md/
    // AGENTS.md copy, env var, provider detection, tmux create, CLI
    // launch, kick-off. L'arg instance va passato se multi.
    const agent = AGENTS.find((a) => a.role === role);
    const scriptArgs = agent.multi && instance ? [role, instance] : [role];
    const quoted = scriptArgs.map((a) => `'${shellEscape(a)}'`).join(' ');
    const prefix =
      (mode === 'fast' ? 'JHT_MODE=fast ' : '') +
      // Bootstrap default del bridge Sentinella (il file config.json
      // puo' sovrascriverlo dinamicamente, ma questo e' il fallback).
      (role === 'sentinella' ? 'JHT_TICK_INTERVAL=10 ' : '');
    const cmd = `${prefix}bash /app/.launcher/start-agent.sh ${quoted}`;
    const r = execInContainer(cmd);
    if (r.code === 0) {
      console.log(`  ${c.green('✓')} ${sName} avviato`);
      started++;
    } else {
      const msg = (r.stderr || r.stdout || 'errore').split('\n').filter(Boolean).slice(-1)[0];
      console.log(`  ${c.red('✗')} ${sName} — ${msg}`);
    }
  }

  console.log('');
  console.log(`Risultato: ${c.green(started + ' avviati')}, ${c.yellow(skipped + ' gia attivi')}`);
  console.log(c.dim('  Il Capitano scalera' + ' gli altri agenti secondo le sue soglie.'));
  console.log('');
}

export function startAction(agentArg, options) {
  // Container mode: deleghiamo a /app/.launcher/start-agent.sh dentro
  // jht. Stessa identica logica della web UI, coerente col boot del
  // bridge Sentinella e con le dipendenze CLI installate nell'immagine.
  if (usingContainer()) {
    return startActionContainer(agentArg, options);
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
