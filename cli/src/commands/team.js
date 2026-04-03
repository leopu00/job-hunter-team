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

  program.addCommand(team);
}

module.exports = {
  AGENTS, DEFAULT_TEAM, c,
  tmuxAvailable, claudeAvailable, getActiveSessions,
  sessionName, isSessionActive, resolveConfig, getWorkspace, parseAgentArg,
  registerTeamCommand,
};
