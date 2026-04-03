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

module.exports = {
  AGENTS, DEFAULT_TEAM, c,
  tmuxAvailable, claudeAvailable, getActiveSessions,
  sessionName, isSessionActive, resolveConfig, getWorkspace, parseAgentArg,
};
