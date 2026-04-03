#!/usr/bin/env node
// cli/src/commands/team.js — Comandi per gestione team agenti
// Sottocomandi: list, start, stop, status

const { Command } = require('commander');
const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ── Definizione agenti ──────────────────────────────────────────────────────
const AGENTS = [
  { role: 'alfa',       prefix: 'ALFA',       multi: false, effort: 'high',   desc: 'Coordinatore pipeline Job Hunter' },
  { role: 'scout',      prefix: 'SCOUT',      multi: true,  effort: 'high',   desc: 'Cerca posizioni lavorative' },
  { role: 'analista',   prefix: 'ANALISTA',    multi: true,  effort: 'high',   desc: 'Analizza job description e aziende' },
  { role: 'scorer',     prefix: 'SCORER',      multi: true,  effort: 'medium', desc: 'Calcola punteggio match' },
  { role: 'scrittore',  prefix: 'SCRITTORE',   multi: true,  effort: 'high',   desc: 'Scrive CV e cover letter' },
  { role: 'critico',    prefix: 'CRITICO',     multi: false, effort: 'high',   desc: 'Revisione qualita CV' },
  { role: 'sentinella', prefix: 'SENTINELLA',  multi: false, effort: 'low',    desc: 'Monitora token usage e rate limit' },
  { role: 'assistente', prefix: 'ASSISTENTE',  multi: false, effort: 'medium', desc: 'Aiuta utente a navigare la piattaforma' },
];

const DEFAULT_TEAM = ['alfa', 'scout:1', 'analista:1', 'scorer:1', 'scrittore:1', 'critico', 'sentinella'];

// ── Colori terminale ────────────────────────────────────────────────────────
const c = {
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
};

// ── Utility ─────────────────────────────────────────────────────────────────

function tmuxAvailable() {
  try {
    execSync('command -v tmux', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function claudeAvailable() {
  try {
    execSync('command -v claude', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function getActiveSessions() {
  try {
    const out = execSync('tmux list-sessions -F "#{session_name}" 2>/dev/null', { encoding: 'utf8' });
    return out.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function sessionName(role, instance) {
  const agent = AGENTS.find((a) => a.role === role);
  if (!agent) return null;
  if (agent.multi && instance) return `${agent.prefix}-${instance}`;
  return agent.prefix;
}

function isSessionActive(name) {
  return getActiveSessions().includes(name);
}

function resolveConfig() {
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    dir = path.dirname(dir);
    if (fs.existsSync(path.join(dir, '.launcher', 'config.sh'))) {
      return { repoRoot: dir, launcherDir: path.join(dir, '.launcher') };
    }
  }
  return { repoRoot: null, launcherDir: null };
}

function getWorkspace() {
  const { repoRoot } = resolveConfig();
  if (!repoRoot) return process.env.JHT_WORKSPACE || null;

  if (process.env.JHT_WORKSPACE) return process.env.JHT_WORKSPACE.replace(/^~/, process.env.HOME);

  const envFile = path.join(repoRoot, '.env');
  if (fs.existsSync(envFile)) {
    const content = fs.readFileSync(envFile, 'utf8');
    const match = content.match(/^JHT_WORKSPACE=(.+)$/m);
    if (match) return match[1].trim().replace(/^~/, process.env.HOME);
  }

  return null;
}

function parseAgentArg(arg) {
  const lower = arg.toLowerCase();
  const match = lower.match(/^([a-z]+)[-:]?(\d+)?$/);
  if (!match) return null;
  const [, role, inst] = match;
  const agent = AGENTS.find((a) => a.role === role);
  if (!agent) return null;
  return { role, instance: agent.multi ? (inst || '1') : null };
}

// ── Comando: team list ──────────────────────────────────────────────────────

function listAction() {
  const sessions = getActiveSessions();

  console.log('');
  console.log(c.bold('Agenti disponibili:'));
  console.log('');
  console.log(
    `  ${'Ruolo'.padEnd(14)} ${'Sessione'.padEnd(16)} ${'Tipo'.padEnd(10)} ${'Effort'.padEnd(8)} Descrizione`
  );
  console.log(`  ${'─'.repeat(14)} ${'─'.repeat(16)} ${'─'.repeat(10)} ${'─'.repeat(8)} ${'─'.repeat(40)}`);

  for (const agent of AGENTS) {
    const sName = agent.multi ? `${agent.prefix}-N` : agent.prefix;
    const tipo = agent.multi ? 'multiplo' : 'singolo';
    const active = sessions.some((s) => s.startsWith(agent.prefix));
    const status = active ? c.green('●') : c.dim('○');

    console.log(
      `  ${status} ${agent.role.padEnd(12)} ${sName.padEnd(16)} ${tipo.padEnd(10)} ${agent.effort.padEnd(8)} ${agent.desc}`
    );
  }

  console.log('');
  console.log(c.dim('  Team default: ' + DEFAULT_TEAM.join(', ')));
  console.log('');
}

// ── Comando: team status ────────────────────────────────────────────────────

function statusAction() {
  if (!tmuxAvailable()) {
    console.error(c.red('Errore: tmux non trovato.'));
    process.exit(1);
  }

  const sessions = getActiveSessions();
  const agentSessions = sessions.filter((s) =>
    AGENTS.some((a) => s === a.prefix || s.startsWith(a.prefix + '-'))
  );

  if (agentSessions.length === 0) {
    console.log('');
    console.log(c.yellow('Nessun agente attivo.'));
    console.log(c.dim('  Avvia il team con: jht team start'));
    console.log('');
    return;
  }

  console.log('');
  console.log(c.bold(`Agenti attivi: ${agentSessions.length}`));
  console.log('');

  for (const s of agentSessions.sort()) {
    const agent = AGENTS.find((a) => s === a.prefix || s.startsWith(a.prefix + '-'));
    const desc = agent ? c.dim(agent.desc) : '';
    console.log(`  ${c.green('●')} ${s.padEnd(20)} ${desc}`);
  }

  console.log('');
}

// ── Registrazione comando Commander ─────────────────────────────────────────

function registerTeamCommand(program) {
  const team = new Command('team').description('Gestione team agenti Job Hunter');

  team
    .command('list')
    .description('Mostra agenti disponibili e il loro stato')
    .action(listAction);

  team
    .command('status')
    .description('Mostra agenti attualmente attivi')
    .action(statusAction);

  team
    .command('start [agente]')
    .description('Avvia un agente o il team default (es: jht team start scout:1)')
    .option('-m, --mode <mode>', 'Modalita: default o fast', 'default')
    .action(startAction);

  team
    .command('stop [agente]')
    .description('Ferma un agente o tutti gli agenti')
    .option('-a, --all', 'Ferma tutti gli agenti')
    .action(stopAction);

  program.addCommand(team);
}

// ── Comando: team start ─────────────────────────────────────────────────────

function startAction(agentArg, options) {
  if (!tmuxAvailable()) {
    console.error(c.red('Errore: tmux non trovato. Installa con: brew install tmux'));
    process.exit(1);
  }
  if (!claudeAvailable()) {
    console.error(c.red('Errore: Claude CLI non trovato. Scarica da https://claude.ai/download'));
    process.exit(1);
  }

  const workspace = getWorkspace();
  if (!workspace) {
    console.error(c.red('Errore: JHT_WORKSPACE non configurato.'));
    console.error('  Impostalo in .env o come variabile d\'ambiente.');
    process.exit(1);
  }

  const { repoRoot } = resolveConfig();
  const mode = options.mode || 'default';
  const targets = agentArg ? [agentArg] : DEFAULT_TEAM;

  console.log('');
  console.log(c.bold('Avvio agenti...'));
  console.log(c.dim(`  Mode: ${mode} | Workspace: ${workspace}`));
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

    const agentDir = agent.multi ? path.join(workspace, `${role}-${instance}`) : path.join(workspace, role);
    if (!fs.existsSync(agentDir)) fs.mkdirSync(agentDir, { recursive: true });

    if (repoRoot) {
      const template = path.join(repoRoot, 'agents', role, `${role}.md`);
      const dest = path.join(agentDir, 'CLAUDE.md');
      if (!fs.existsSync(dest) && fs.existsSync(template)) fs.copyFileSync(template, dest);
    }

    try {
      execSync(`tmux new-session -d -s "${sName}" -c "${agentDir}"`, { stdio: 'ignore' });
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

// ── Comando: team stop ──────────────────────────────────────────────────────

function stopAction(agentArg, options) {
  if (!tmuxAvailable()) {
    console.error(c.red('Errore: tmux non trovato.'));
    process.exit(1);
  }

  const sessions = getActiveSessions();
  let targets;

  if (options.all || !agentArg) {
    targets = sessions.filter((s) =>
      AGENTS.some((a) => s === a.prefix || s.startsWith(a.prefix + '-'))
    );
    if (targets.length === 0) {
      console.log(c.yellow('Nessun agente attivo da fermare.'));
      return;
    }
  } else {
    const parsed = parseAgentArg(agentArg);
    if (!parsed) {
      console.error(c.red(`Ruolo "${agentArg}" non riconosciuto.`));
      console.error('Ruoli validi: ' + AGENTS.map((a) => a.role).join(', '));
      process.exit(1);
    }
    const sName = sessionName(parsed.role, parsed.instance);
    if (!isSessionActive(sName)) {
      console.log(c.yellow(`${sName} non e attivo.`));
      return;
    }
    targets = [sName];
  }

  console.log('');
  console.log(c.bold('Fermo agenti...'));
  console.log('');

  let stopped = 0;
  for (const s of targets.sort()) {
    try {
      execSync(`tmux send-keys -t "${s}" "/exit" C-m`, { stdio: 'ignore' });
    } catch { /* sessione gia chiusa */ }

    try {
      execSync(`sleep 1 && tmux kill-session -t "${s}"`, { stdio: 'ignore' });
      console.log(`  ${c.green('✓')} ${s} fermato`);
      stopped++;
    } catch {
      console.log(`  ${c.yellow('⚠')} ${s} — non trovato (gia chiuso?)`);
    }
  }

  console.log('');
  console.log(`${c.green(stopped + ' agenti fermati')}`);
  console.log('');
}

module.exports = { registerTeamCommand };
