/**
 * Team commands poller (HTTP long-poll).
 *
 * Renamed 2026-05-31: precedente nome `realtime-subscriber.js` era
 * ingannevole — questo file NON usa WebSocket/Supabase Realtime, fa
 * long-poll HTTP. Vedi `docs/internal/architecture/cloud-sync-architecture.md` §
 * "Nota architetturale sulla nomenclatura".
 *
 * Long-running process che fa long-poll su
 * /api/cloud-sync/team-commands ogni N secondi (default 5s) usando
 * il jht_sync_ token salvato in cloud.json. Quando trova comandi
 * pending: claim (PATCH status=running), esegue `jht team <action>`,
 * UPDATE status=done|error + processed_at.
 *
 * Pourquoi polling al posto di Supabase Realtime WS:
 *   - cloud.json esistente conserva solo jht_sync_ token, NON il
 *     refresh_token Supabase necessario per autenticare il WS user.
 *   - Polling 5s è più che ok per UX Start button (utente accetta
 *     5s di "Starting..." spinner).
 *   - Auth riusa l'infra esistente (jht_sync_ Bearer), zero nuove
 *     credenziali sul disco.
 *   - Failure mode più semplice da debuggare (HTTP retry vs WS
 *     reconnect/heartbeat/keepalive).
 *
 * Resilienza:
 *   - Auto-retry su errori HTTP/network: backoff esponenziale 5s→60s.
 *   - SIGTERM/SIGINT: shutdown pulito (smette di polling).
 *   - Atomic claim server-side (RLS + WHERE status=pending) →
 *     doppio subscriber non rompe nulla.
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import pc from 'picocolors';
import { tierInterval, errorBackoff, POLL_IDLE_MS } from './poll-tier.js';
import { cloudSyncHeaders } from './client-identity.js';

const JHT_HOME = process.env.JHT_HOME || join(process.env.HOME || '/jht_home', '.jht');
const CLOUD_FILE = join(JHT_HOME, 'cloud.json');
const WEEKLY_HALT_FLAG = join(JHT_HOME, '.weekly-halt.flag');
const JHT_BIN = '/app/cli/bin/jht.js';

// Cadenza adattiva (vedi poll-tier.js): 5s solo dopo un comando, poi ≤30s.
// I comandi (es. dalla pagina sentinella cloud) vengono raccolti entro ≤30s.

function log(level, msg, meta) {
  const ts = new Date().toISOString();
  const tag = level === 'error' ? pc.red('[team-commands-poller]') : pc.dim('[team-commands-poller]');
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  const stream = level === 'error' || level === 'warn' ? console.error : console.log;
  stream(`${tag} ${ts} ${msg}${metaStr}`);
}

async function loadCloudConfig() {
  try {
    const raw = await readFile(CLOUD_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      log('error', 'cloud.json read failed', { err: err.message });
    }
    return null;
  }
}

const VALID_TARGETS = new Set([
  'all',
  'assistente',
  'capitano',
  'sentinella',
  'scout',
  'scorer',
  'analista',
  'scrittore',
  'critico',
  'mentor',
  'bridge',
]);

// Map (action, target) → { cmd, args } per spawn.
// 'all' = team-wide via `jht team <action>`.
// Single agent = `jht team <action> <agente>` (team.js gestisce già il caso).
// 'bridge' = script dedicato in .launcher/.
function resolveCommand(action, target) {
  if (target === 'bridge') {
    return {
      cmd: '/bin/bash',
      args: ['/app/.launcher/bridge-control.sh', action === 'start' ? 'start' : 'stop'],
    };
  }
  const jhtArgs = ['team', action];
  if (target && target !== 'all') jhtArgs.push(target);
  return { cmd: process.execPath, args: [JHT_BIN, ...jhtArgs] };
}

function execBusCommand(action, target) {
  return new Promise((resolve) => {
    const { cmd, args } = resolveCommand(action, target);
    log('info', 'exec.start', { cmd, args, action, target });
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, IS_CONTAINER: '1' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (err) => {
      log('error', 'exec.spawn-error', { err: err.message });
      resolve({ ok: false, exitCode: -1, stdout, stderr: err.message });
    });
    child.on('exit', (code) => {
      const ok = code === 0;
      log(ok ? 'info' : 'error', 'exec.exit', { code, action, target });
      resolve({ ok, exitCode: code, stdout, stderr });
    });
  });
}

async function apiGet(baseUrl, token, path) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'GET',
    headers: cloudSyncHeaders(token),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${body.error || 'unknown'}`);
  return body;
}

async function apiPatch(baseUrl, token, path, payload) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: cloudSyncHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${body.error || 'unknown'}`);
  return body;
}

async function processCommand(baseUrl, token, command) {
  const { id, action, payload } = command;
  const target = ((payload && typeof payload === 'object' && payload.target) || 'all')
    .toString()
    .toLowerCase();
  log('info', 'command.received', { id, action, target });

  // Atomic claim: pending → running. Se altro subscriber ha gia'
  // preso, 404 → skip senza errore.
  try {
    await apiPatch(baseUrl, token, `/api/cloud-sync/team-commands/${id}`, { status: 'running' });
  } catch (err) {
    log('warn', 'command.claim-skipped', { id, err: err.message });
    return;
  }

  const validActions = new Set(['start', 'stop', 'restart']);
  if (!validActions.has(action)) {
    await apiPatch(baseUrl, token, `/api/cloud-sync/team-commands/${id}`, {
      status: 'error',
      error: `invalid action: ${action}`,
    }).catch(() => {});
    log('error', 'command.invalid-action', { id, action });
    return;
  }
  if (!VALID_TARGETS.has(target)) {
    await apiPatch(baseUrl, token, `/api/cloud-sync/team-commands/${id}`, {
      status: 'error',
      error: `invalid target: ${target}`,
    }).catch(() => {});
    log('error', 'command.invalid-target', { id, target });
    return;
  }
  // bridge non ha restart; mappiamo a stop+start sarebbe out-of-scope qui.
  if (target === 'bridge' && action === 'restart') {
    await apiPatch(baseUrl, token, `/api/cloud-sync/team-commands/${id}`, {
      status: 'error',
      error: 'bridge does not support restart; use stop+start',
    }).catch(() => {});
    return;
  }

  const res = await execBusCommand(action, target);
  // jht team start stampa errori user-facing su stdout (colori ANSI),
  // non su stderr. Quando exit != 0, prefer stdout per dare un messaggio
  // utile alla UI ("✗ ASSISTENTE — claude non trovato..."), fallback su
  // stderr e exit code. Strip ANSI per leggibilità.
  const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
  let errMsg;
  if (!res.ok) {
    const raw = res.stdout?.trim() || res.stderr?.trim() || `exit code ${res.exitCode}`;
    errMsg = stripAnsi(raw).slice(-2000);
  }
  await apiPatch(baseUrl, token, `/api/cloud-sync/team-commands/${id}`, {
    status: res.ok ? 'done' : 'error',
    error: errMsg,
  }).catch((err) => {
    log('error', 'command.update-failed', { id, err: err.message });
  });
  log(res.ok ? 'info' : 'error', 'command.processed', {
    id,
    action,
    target,
    ok: res.ok,
    exitCode: res.exitCode,
  });
}

export async function runTeamCommandsPoller() {
  const config = await loadCloudConfig();
  if (!config?.enabled) {
    log('warn', 'startup.skipped', { reason: 'cloud sync not enabled' });
    process.exit(0);
  }
  const baseUrl = (config.base_url || '').replace(/\/+$/, '');
  const token = config.token;
  if (!baseUrl || !token) {
    log('error', 'startup.missing-credentials', {
      hasBaseUrl: !!baseUrl,
      hasToken: !!token,
    });
    process.exit(1);
  }

  log('info', 'startup.begin', { baseUrl, userId: config.user_id });

  let shuttingDown = false;
  let consecutiveErrors = 0;

  const shutdown = (signal) => {
    log('info', 'shutdown.received', { signal });
    shuttingDown = true;
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Heartbeat ogni 5min: utile per chi grepa i log a vedere che vivo.
  const heartbeat = setInterval(() => {
    log('info', 'heartbeat.alive');
  }, 5 * 60 * 1000);

  // HALT-WEEKLY guard: come per `cloud daemon` (vedi handleDaemon in
  // cli/src/commands/cloud.js), saltiamo il poll quando il flag e' attivo.
  // Ogni poll = 1 Function Invocation Vercel + Postgres roundtrip; durante
  // HALT-WEEKLY (team operativi killati) non c'e' nulla da fare.
  // Vedi docs/internal/postmortems/2026-05-21-halt-weekly-incident.md +
  // docs/internal/postmortems/2026-05-22-vercel-quota-exhaustion.md.
  let haltLogTick = 0;
  let lastActivityAt = Date.now();
  while (!shuttingDown) {
    if (existsSync(WEEKLY_HALT_FLAG)) {
      if (haltLogTick % 60 === 0) {
        log('info', 'poll.skipped', { reason: 'weekly-halt-flag active' });
      }
      haltLogTick += 1;
      await new Promise((resolve) => setTimeout(resolve, POLL_IDLE_MS));
      continue;
    }
    if (haltLogTick > 0) {
      log('info', 'poll.resumed', { reason: 'weekly-halt-flag removed' });
      haltLogTick = 0;
    }

    let backoff = tierInterval(lastActivityAt, { allowDeepIdle: false });
    try {
      const r = await apiGet(baseUrl, token, '/api/cloud-sync/team-commands?status=pending&limit=20');
      consecutiveErrors = 0;
      const commands = Array.isArray(r.commands) ? r.commands : [];
      if (commands.length > 0) {
        // Attività confermata: torna a tier active (5s) per i comandi seguenti.
        lastActivityAt = Date.now();
        backoff = tierInterval(lastActivityAt, { allowDeepIdle: false });
        log('info', 'poll.found-pending', { count: commands.length });
        for (const cmd of commands) {
          if (shuttingDown) break;
          try { await processCommand(baseUrl, token, cmd); }
          catch (err) {
            log('error', 'process.crashed', { id: cmd.id, err: err.message });
          }
        }
      }
    } catch (err) {
      consecutiveErrors += 1;
      backoff = errorBackoff(tierInterval(lastActivityAt, { allowDeepIdle: false }), consecutiveErrors);
      log('error', 'poll.failed', { err: err.message, consecutiveErrors, nextBackoffMs: backoff });
    }
    if (shuttingDown) break;
    await new Promise((resolve) => setTimeout(resolve, backoff));
  }

  clearInterval(heartbeat);
  log('info', 'shutdown.done');
  process.exit(0);
}
