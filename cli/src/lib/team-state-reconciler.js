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
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import pc from 'picocolors';

const JHT_HOME = process.env.JHT_HOME || join(process.env.HOME || '/jht_home', '.jht');
const CLOUD_FILE = join(JHT_HOME, 'cloud.json');
const WEEKLY_HALT_FLAG = join(JHT_HOME, '.weekly-halt.flag');
// Gate locale "team-halted": creato dal reconciler quando applica stop,
// cancellato quando applica start. agent-watchdog, doctor-watchdog,
// pid1 auto-start e jht team start lo controllano per rispettare la
// decisione utente. Semantica distinta da .weekly-halt.flag (= limite
// rate budget weekly). Source of truth: team_state.should_run.
const TEAM_HALTED_FLAG = join(JHT_HOME, '.team-halted.flag');
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
  if (!res.ok) {
    const err = new Error(`${method} ${path} → HTTP ${res.status}: ${json.error || 'unknown'}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
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
  // Gate centrale .team-halted.flag: cancello PRIMA di start (così
  // watchdog/spawner possono partire) e creo DOPO stop (così watchdog
  // smette di respawn). Ordine importante: il flag deve essere coerente
  // con lo stato che stiamo per applicare nel container.
  if (command === 'started' || command === 'restarted') {
    try { await unlink(TEAM_HALTED_FLAG); } catch { /* not present */ }
  }
  const r = await execJht(args);
  if (command === 'stopped' && r.ok) {
    try {
      await writeFile(
        TEAM_HALTED_FLAG,
        `halted_by=team-state-reconciler\nat=${new Date().toISOString()}\n`,
        { mode: 0o644 }
      );
    } catch (err) {
      log('warn', 'team-halted-flag write failed', { err: err.message });
    }
  }
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

  let shuttingDown = false;

  const shutdown = (signal) => {
    log('info', 'shutdown.received', { signal });
    shuttingDown = true;
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Claim con retry su 409 (altro device active con heartbeat recente):
  // wait & retry ogni 60s. Quando l'altro device sparisce (heartbeat
  // scaduto > 5min lato server), il claim riesce. Non si fa force=true
  // automatico (sarebbe rude); l'utente deve decidere via UI/CLI.
  const CLAIM_RETRY_MS = 60_000;
  const deviceLabel = process.env.JHT_DEVICE_LABEL || (process.env.IS_CONTAINER === '1' ? 'container' : 'cli');
  while (!shuttingDown) {
    try {
      const claim = await apiCall('POST', baseUrl, token, '/api/team-state/claim', {
        device_label: deviceLabel,
      });
      log('info', 'claim.done', {
        device_id: claim.claimed_device_id,
        evicted: claim.evicted_device_id || null,
      });
      break;
    } catch (err) {
      if (err.status === 409 && err.body?.error === 'device_already_claimed') {
        log('warn', 'claim.conflict', {
          owner_device_id: err.body.current_device_id,
          heartbeat_age_seconds: err.body.heartbeat_age_seconds,
          retrying_in_seconds: CLAIM_RETRY_MS / 1000,
        });
        await new Promise((r) => setTimeout(r, CLAIM_RETRY_MS));
        continue;
      }
      // Altro errore (rete, 5xx): log + breve backoff, riprova
      log('error', 'claim.failed', { err: err.message });
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }
  if (shuttingDown) {
    log('info', 'shutdown.during-claim');
    process.exit(0);
  }
  let consecutiveErrors = 0;
  let lastHeartbeatAt = 0;

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
