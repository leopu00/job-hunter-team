/**
 * team_state desired-state reconciler.
 *
 * Long-running process che fa long-poll su /api/team-state ogni N secondi
 * (default 5s) usando il jht_sync_ token. Confronta desired (should_run,
 * agents_enabled, restart_token) con observed (is_running, last_restart_token)
 * e applica il diff:
 *   - desired.should_run=true && observed.is_running=false → `jht team start`
 *   - desired.should_run=false && observed.is_running=true → `jht team stop`
 *   - desired.restart_token != observed.last_restart_token → `jht team restart`
 *
 * Heartbeat: PATCH last_heartbeat_at ogni HEARTBEAT_EVERY_MS (default 30s).
 *
 * Claim active_device: al boot POSTa /api/team-state/claim per registrarsi
 * come device attivo del user (single-team enforcement gratis).
 *
 * Parallelo a realtime-subscriber.js (team_commands) finché Step 5 del
 * cutover non completa. I due subscriber sono ortogonali: leggono tabelle
 * diverse e chiamano `jht team <action>` che è idempotente.
 *
 * Caveat noto: il reconciler si fida dell'observed scritto in DB; se il
 * team viene avviato manualmente dal Mac (fuori dal flow web), la prima
 * iterazione può duplicare start prima di convergere. Mitigato dal fatto
 * che `jht team start` è idempotente quando tmux session esiste già.
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import pc from 'picocolors';

const JHT_HOME = process.env.JHT_HOME || join(process.env.HOME || '/jht_home', '.jht');
const CLOUD_FILE = join(JHT_HOME, 'cloud.json');
const WEEKLY_HALT_FLAG = join(JHT_HOME, '.weekly-halt.flag');
const JHT_BIN = '/app/cli/bin/jht.js';

const POLL_INTERVAL_MS = 5000;
const POLL_INTERVAL_MAX_MS = 60000;
const HEARTBEAT_EVERY_MS = 30000;

function log(level, msg, meta) {
  const ts = new Date().toISOString();
  const tag = level === 'error' ? pc.red('[team-state]') : pc.dim('[team-state]');
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  const stream = level === 'error' || level === 'warn' ? console.error : console.log;
  stream(`${tag} ${ts} ${msg}${metaStr}`);
}

async function loadCloudConfig() {
  try {
    return JSON.parse(await readFile(CLOUD_FILE, 'utf-8'));
  } catch (err) {
    if (err.code !== 'ENOENT') log('error', 'cloud.json read failed', { err: err.message });
    return null;
  }
}

function stripAnsi(s) {
  return (s || '').replace(/\x1b\[[0-9;]*m/g, '');
}

async function apiCall(method, baseUrl, token, path, body) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${json.error || 'unknown'}`);
  return json;
}

function execJht(args) {
  return new Promise((resolve) => {
    log('info', 'exec.start', { args });
    const child = spawn(process.execPath, [JHT_BIN, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, IS_CONTAINER: '1' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c.toString(); });
    child.stderr.on('data', (c) => { stderr += c.toString(); });
    child.on('exit', (code) => {
      const ok = code === 0;
      log(ok ? 'info' : 'error', 'exec.exit', { code, args });
      resolve({ ok, code, stdout, stderr });
    });
    child.on('error', (err) => {
      log('error', 'exec.spawn-error', { err: err.message });
      resolve({ ok: false, code: -1, stdout, stderr: err.message });
    });
  });
}

async function applyAction(baseUrl, token, command, args) {
  const r = await execJht(args);
  const updates = {
    last_action: command,
    last_action_at: new Date().toISOString(),
  };
  if (command === 'started') updates.is_running = r.ok;
  if (command === 'stopped') updates.is_running = !r.ok;
  if (r.ok) updates.last_error = null;
  else {
    updates.last_error = stripAnsi(r.stderr || r.stdout || `exit ${r.code}`).slice(-500);
    updates.last_error_at = new Date().toISOString();
  }
  return { r, updates };
}

async function reconcile(baseUrl, token, state) {
  // Priorità 1: restart (token cambiato)
  if (state.restart_token && state.restart_token !== state.last_restart_token) {
    log('info', 'reconcile.restart', { token: state.restart_token });
    const { updates } = await applyAction(baseUrl, token, 'restarted', ['team', 'restart']);
    updates.last_restart_token = state.restart_token;
    await apiCall('PATCH', baseUrl, token, '/api/team-state', updates).catch((err) =>
      log('error', 'reconcile.observe-write-failed', { err: err.message })
    );
    return 'restarted';
  }

  // Priorità 2: start (desired true, observed false)
  if (state.should_run && !state.is_running) {
    log('info', 'reconcile.start');
    const { updates } = await applyAction(baseUrl, token, 'started', ['team', 'start']);
    await apiCall('PATCH', baseUrl, token, '/api/team-state', updates).catch((err) =>
      log('error', 'reconcile.observe-write-failed', { err: err.message })
    );
    return 'started';
  }

  // Priorità 3: stop (desired false, observed true)
  if (!state.should_run && state.is_running) {
    log('info', 'reconcile.stop');
    const { updates } = await applyAction(baseUrl, token, 'stopped', ['team', 'stop']);
    await apiCall('PATCH', baseUrl, token, '/api/team-state', updates).catch((err) =>
      log('error', 'reconcile.observe-write-failed', { err: err.message })
    );
    return 'stopped';
  }

  return null;
}

export async function runTeamStateReconciler() {
  const config = await loadCloudConfig();
  if (!config?.enabled) {
    log('warn', 'startup.skipped', { reason: 'cloud sync not enabled' });
    process.exit(0);
  }
  const baseUrl = (config.base_url || '').replace(/\/+$/, '');
  const token = config.token;
  if (!baseUrl || !token) {
    log('error', 'startup.missing-credentials', { hasBaseUrl: !!baseUrl, hasToken: !!token });
    process.exit(1);
  }

  log('info', 'startup.begin', { baseUrl, userId: config.user_id });

  try {
    const claim = await apiCall('POST', baseUrl, token, '/api/team-state/claim', {});
    log('info', 'claim.done', { device_id: claim.claimed_device_id });
  } catch (err) {
    log('error', 'claim.failed', { err: err.message });
  }

  let shuttingDown = false;
  let consecutiveErrors = 0;
  let lastHeartbeatAt = 0;

  const shutdown = (signal) => {
    log('info', 'shutdown.received', { signal });
    shuttingDown = true;
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  while (!shuttingDown) {
    if (existsSync(WEEKLY_HALT_FLAG)) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }

    let backoff = POLL_INTERVAL_MS;
    try {
      const r = await apiCall('GET', baseUrl, token, '/api/team-state');
      consecutiveErrors = 0;
      const state = r.state;
      if (state) {
        await reconcile(baseUrl, token, state);
        if (Date.now() - lastHeartbeatAt >= HEARTBEAT_EVERY_MS) {
          await apiCall('PATCH', baseUrl, token, '/api/team-state', {
            last_heartbeat_at: new Date().toISOString(),
          }).catch((err) => log('warn', 'heartbeat.failed', { err: err.message }));
          lastHeartbeatAt = Date.now();
        }
      }
    } catch (err) {
      consecutiveErrors += 1;
      backoff = Math.min(POLL_INTERVAL_MAX_MS, POLL_INTERVAL_MS * 2 ** Math.min(consecutiveErrors, 4));
      log('error', 'poll.failed', { err: err.message, consecutiveErrors, nextBackoffMs: backoff });
    }

    if (shuttingDown) break;
    await new Promise((r) => setTimeout(r, backoff));
  }

  log('info', 'shutdown.done');
  process.exit(0);
}
