/**
 * user_to_agent_messages poller.
 *
 * Long-running process: long-poll GET /api/messages?status=pending,
 * per ogni messaggio fa claim atomico (PATCH status=delivered) e poi
 * forward al tmux pane corrispondente via `jht-tmux-send`.
 *
 * Pattern parallelo a team-state-reconciler.js:
 *  - GET periodico con tier adattivo (5s active / 30s idle / 120s deep-idle)
 *    basato sull'ultima consegna riuscita. Reset a active appena arriva
 *    un nuovo messaggio. Riduzione carico Vercel ~90% in caso idle h24
 *  - Backoff esponenziale on error fino a 60s
 *  - Rispetta .team-halted.flag (user Stop) e .weekly-halt.flag (rate budget)
 *  - Killswitch 401/403: shutdown dopo 3 auth fail consecutivi
 *
 * Claim atomico:
 *  PATCH /api/messages con {id, status:'delivered'} usa `update().eq(id).eq(user_id)
 *  .maybeSingle()` lato server (route.ts). Idempotente: se due reader competono
 *  per lo stesso id, uno solo riceve `data!=null`; l'altro torna 404 dopo che
 *  delivered_at è stato già scritto. La PATCH single-source-of-truth è il claim.
 *
 * Mapping agent → tmux session:
 *  Browser POSTa `agent` lowercase (1-64 char). Il poller estrae il ruolo base
 *  (rimuove suffisso `-N` di scaling, es. `scout-1` → `scout`) e fa uppercase.
 *  Whitelist allineata a VALID_TARGETS di realtime-subscriber.js. Target speciali
 *  (`all`, `bridge`) sono skippati: non hanno una sessione tmux di chat con cui
 *  parlare con l'utente.
 *
 * Lifecycle stato messaggio:
 *  pending → delivered (claim ok + tmux ok)
 *  pending → expired   (tmux fail: session morta o testo rifiutato)
 *  delivered → replied (gestito altrove quando l'agente risponde, fuori scope)
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import pc from 'picocolors';

const JHT_HOME = process.env.JHT_HOME || join(process.env.HOME || '/jht_home', '.jht');
const CLOUD_FILE = join(JHT_HOME, 'cloud.json');
const WEEKLY_HALT_FLAG = join(JHT_HOME, '.weekly-halt.flag');
const TEAM_HALTED_FLAG = join(JHT_HOME, '.team-halted.flag');

// Tre tier di polling adattivo basati sull'ultima consegna riuscita.
// L'idea: se l'utente sta chattando con un agente, vogliamo latency bassa
// (5s); se non scrive da minuti, possiamo rilassare; se non scrive da
// mezz'ora possiamo quasi spegnerci. Lo stato attivo si infera dalle
// consegne effettive — proxy onesto di "utente attivo" senza dover toccare
// il browser. Reset a active al primo messaggio in coda.
const POLL_INTERVAL_ACTIVE_MS = 5000;
const POLL_INTERVAL_IDLE_MS = 30000;
const POLL_INTERVAL_DEEP_IDLE_MS = 120000;
const IDLE_THRESHOLD_MS = 5 * 60 * 1000;        // 5 min
const DEEP_IDLE_THRESHOLD_MS = 30 * 60 * 1000;  // 30 min
const POLL_INTERVAL_MAX_MS = 60000;
const FETCH_LIMIT = 50;

// Killswitch dedicato auth-fail (token revocato / pairing rotto):
// più aggressivo del counter generico perché 401/403 non recupera mai
// senza intervento utente. Allineato a handlePush in cloud.js.
const MAX_CONSECUTIVE_AUTH_FAILS = 3;

// Whitelist allineata a realtime-subscriber.js (VALID_TARGETS).
// 'all' e 'bridge' sono inclusi nella lista web (resta valida la POST)
// ma il poller li skippa: non c'è un tmux pane utente-facing.
const TMUX_TARGETS = new Set([
  'assistente',
  'capitano',
  'sentinella',
  'scout',
  'scorer',
  'analista',
  'scrittore',
  'critico',
  'mentor',
]);

function log(level, msg, meta) {
  const ts = new Date().toISOString();
  const tag = level === 'error' ? pc.red('[user-msg]') : pc.dim('[user-msg]');
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

// Ruolo base senza suffisso di scaling. `scout-1` → `scout`, `scout` → `scout`.
function resolveTmuxSession(agent) {
  if (typeof agent !== 'string') return null;
  const base = agent.trim().toLowerCase().split('-')[0];
  if (!TMUX_TARGETS.has(base)) return null;
  return base.toUpperCase();
}

function execTmuxSend(session, message) {
  return new Promise((resolve) => {
    // jht-tmux-send è linkato in /usr/local/bin via Dockerfile (skill discovery).
    // Exit codes: 0 ok, 2 session-missing, 3 testo-rifiutato.
    const child = spawn('jht-tmux-send', [session, message], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, JHT_TMUX_SEND_FROM: 'user-web' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c.toString(); });
    child.stderr.on('data', (c) => { stderr += c.toString(); });
    child.on('error', (err) => {
      resolve({ ok: false, code: -1, stderr: err.message, stdout });
    });
    child.on('exit', (code) => {
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

async function deliverMessage(baseUrl, token, msg) {
  const session = resolveTmuxSession(msg.agent);
  if (!session) {
    // Agente non-tmux (all/bridge/unknown): marca expired per non re-processarlo.
    log('warn', 'deliver.skip-unknown-target', { id: msg.id, agent: msg.agent });
    await apiCall('PATCH', baseUrl, token, '/api/messages', {
      id: msg.id,
      status: 'expired',
    }).catch((err) => log('error', 'mark-expired-failed', { id: msg.id, err: err.message }));
    return { ok: false, reason: 'unknown-target' };
  }

  // Claim atomico: chi vince la PATCH delivered ha il diritto di forward.
  let claimed;
  try {
    claimed = await apiCall('PATCH', baseUrl, token, '/api/messages', {
      id: msg.id,
      status: 'delivered',
    });
  } catch (err) {
    if (err.status === 404) {
      // Già consegnato da altro reader, o cancellato. Skip silenzioso.
      return { ok: false, reason: 'already-claimed' };
    }
    throw err;
  }

  const r = await execTmuxSend(session, msg.message);
  if (r.ok) {
    log('info', 'deliver.ok', { id: msg.id, session, len: msg.message.length });
    return { ok: true };
  }

  // tmux fail dopo claim: marca expired così non ritenta + l'utente vede
  // sulla UI che la consegna non è andata. last_error non esiste sulla
  // tabella, ma lo status=expired è segnale sufficiente per ora.
  log('error', 'deliver.tmux-fail', {
    id: msg.id,
    session,
    code: r.code,
    stderr: (r.stderr || '').slice(-200),
  });
  await apiCall('PATCH', baseUrl, token, '/api/messages', {
    id: msg.id,
    status: 'expired',
  }).catch((err) => log('error', 'mark-expired-failed', { id: msg.id, err: err.message }));
  return { ok: false, reason: 'tmux-fail', code: r.code };
}

export async function runUserMessagesPoller() {
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

  let consecutiveErrors = 0;
  let consecutiveAuthFails = 0;
  let lastDeliveryAt = Date.now();
  let currentTier = 'active';

  // Tier basato su quanto tempo è passato dall'ultima consegna riuscita.
  // Active = 5s, idle = 30s, deep-idle = 120s.
  function tierInterval() {
    const elapsed = Date.now() - lastDeliveryAt;
    if (elapsed < IDLE_THRESHOLD_MS) {
      currentTier = 'active';
      return POLL_INTERVAL_ACTIVE_MS;
    }
    if (elapsed < DEEP_IDLE_THRESHOLD_MS) {
      currentTier = 'idle';
      return POLL_INTERVAL_IDLE_MS;
    }
    currentTier = 'deep-idle';
    return POLL_INTERVAL_DEEP_IDLE_MS;
  }

  while (!shuttingDown) {
    // Halt gates: rispetta user Stop e weekly rate budget. Il poller NON
    // si auto-shutdown: resta vivo e ricomincia a polling appena i flag
    // spariscono (es. user click Start, weekly reset).
    if (existsSync(TEAM_HALTED_FLAG) || existsSync(WEEKLY_HALT_FLAG)) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_IDLE_MS));
      continue;
    }

    let backoff = tierInterval();
    try {
      const r = await apiCall(
        'GET',
        baseUrl,
        token,
        `/api/messages?status=pending&limit=${FETCH_LIMIT}`,
      );
      consecutiveErrors = 0;
      consecutiveAuthFails = 0;
      const messages = Array.isArray(r.messages) ? r.messages : [];
      // GET ordina sent_at DESC; per FIFO inverto.
      messages.sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at)));
      if (messages.length > 0) {
        // Attività utente confermata: torna a tier active.
        const prevTier = currentTier;
        lastDeliveryAt = Date.now();
        backoff = tierInterval();
        if (prevTier !== 'active') {
          log('info', 'tier.bump-active', { from: prevTier, pending: messages.length });
        }
      }
      for (const msg of messages) {
        if (shuttingDown) break;
        try {
          await deliverMessage(baseUrl, token, msg);
        } catch (err) {
          log('error', 'deliver.failed', { id: msg.id, err: err.message });
        }
      }
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        consecutiveAuthFails += 1;
        log('error', 'auth.failed', {
          status: err.status,
          consecutiveAuthFails,
          max: MAX_CONSECUTIVE_AUTH_FAILS,
        });
        if (consecutiveAuthFails >= MAX_CONSECUTIVE_AUTH_FAILS) {
          log('error', 'shutdown.auth-killswitch', {
            reason: 'token revoked or broken pairing, requires user intervention',
          });
          process.exit(2);
        }
      } else {
        consecutiveErrors += 1;
        // Backoff esponenziale sul tier base corrente.
        const base = tierInterval();
        backoff = Math.min(
          POLL_INTERVAL_MAX_MS,
          base * 2 ** Math.min(consecutiveErrors, 4),
        );
        log('error', 'poll.failed', {
          err: err.message,
          consecutiveErrors,
          tier: currentTier,
          nextBackoffMs: backoff,
        });
      }
    }

    if (shuttingDown) break;
    await new Promise((r) => setTimeout(r, backoff));
  }

  log('info', 'shutdown.done');
  process.exit(0);
}
