/**
 * File bridge poller (HTTP long-poll).
 *
 * Serve il "bridge effimero" dei file: il web pubblico (Vercel) non può
 * leggere il filesystem del container, quindi quando l'utente chiede di
 * aprire un CV/allegato il file sale ON-DEMAND in un bucket Supabase di
 * transito e viene purgato dopo un TTL corto. Vedi
 * docs/internal/file-bridge-on-demand-2026-06-07.md
 *
 * Coerente con gli altri poller (team-commands-poller.js): long-poll HTTP
 * su base_url col token jht_sync_ di cloud.json, backoff esponenziale
 * 5s→60s, rispetto del .weekly-halt.flag, shutdown pulito su SIGTERM/SIGINT.
 * La VPS NON ha credenziali Supabase: carica i file via signed upload URL
 * usa-e-getta mintata dal web.
 *
 * Responsabilità per ciclo:
 *   1. (ogni ~60s) pubblica l'INDICE dei file su /api/cloud-sync/file-index
 *   2. (ogni ciclo) serve le richieste pending: claim → upload → ready/error
 *   3. (ogni ciclo) triggera il purge degli oggetti scaduti
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import pc from 'picocolors';
import { tierInterval, errorBackoff, POLL_IDLE_MS } from './poll-tier.js';
import { cloudSyncHeaders } from './client-identity.js';

const JHT_HOME = process.env.JHT_HOME || join(process.env.HOME || '/jht_home', '.jht');
const CLOUD_FILE = join(JHT_HOME, 'cloud.json');
const WEEKLY_HALT_FLAG = join(JHT_HOME, '.weekly-halt.flag');

// Cartelle dei file utente sul container (mirror di web/lib/jht-paths.ts).
const JHT_USER_DIR = process.env.JHT_USER_DIR || join(homedir(), 'Documents', 'Job Hunter Team');
const FILE_DIRS = [
  { dir: join(JHT_USER_DIR, 'cv'), category: 'cv' },
  { dir: join(JHT_USER_DIR, 'allegati'), category: 'attachment' },
  { dir: join(JHT_USER_DIR, 'output'), category: 'other' },
];

// Cadenza adattiva (vedi poll-tier.js): 5s solo quando c'è una richiesta file
// recente, poi ≤30s. L'indice file + purge NON sono latency-critical (l'indice
// popola la CV Preview del profilo; il purge pulisce oggetti col TTL 10min):
// girano a tempo ogni ~5min per contenere la quota Vercel per-utente. Il
// download per-posizione risolve per basename e non dipende dall'indice.
const INDEX_EVERY_MS = 300000;

const MIME = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

function mimeFor(name) {
  return MIME[extname(name).toLowerCase()] || 'application/octet-stream';
}

function log(level, msg, meta) {
  const ts = new Date().toISOString();
  const tag = level === 'error' ? pc.red('[file-bridge-poller]') : pc.dim('[file-bridge-poller]');
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  const stream = level === 'error' || level === 'warn' ? console.error : console.log;
  stream(`${tag} ${ts} ${msg}${metaStr}`);
}

async function loadCloudConfig() {
  try {
    const raw = await readFile(CLOUD_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') log('error', 'cloud.json read failed', { err: err.message });
    return null;
  }
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

async function apiSend(method, baseUrl, token, path, payload) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: cloudSyncHeaders(token, { 'Content-Type': 'application/json' }),
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${body.error || 'unknown'}`);
  return body;
}

/**
 * Risolve un file richiesto per nome confinando il lookup alle cartelle note
 * (anti path-traversal): basename + realpath dentro la dir.
 */
function resolveLocalFile(name) {
  const safe = basename(name);
  for (const { dir } of FILE_DIRS) {
    const candidate = join(dir, safe);
    if (!existsSync(candidate)) continue;
    try {
      const real = realpathSync(candidate);
      const realDir = realpathSync(dir);
      if (real === realDir || real.startsWith(realDir + '/')) return real;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Costruisce lo snapshot dell'indice dei file presenti sul disco. */
async function buildIndex() {
  const files = [];
  for (const { dir, category } of FILE_DIRS) {
    if (!existsSync(dir)) continue;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile()) continue;
      const full = join(dir, e.name);
      try {
        const st = await stat(full);
        const buf = await readFile(full);
        files.push({
          name: e.name,
          category,
          sha256: createHash('sha256').update(buf).digest('hex'),
          size: st.size,
          mime: mimeFor(e.name),
          location_on_vps: full,
        });
      } catch {
        /* file sparito/illeggibile: skip */
      }
    }
  }
  return files;
}

async function processRequest(baseUrl, token, request) {
  const { id, file_name: fileName } = request;
  log('info', 'request.received', { id, fileName });

  const realPath = resolveLocalFile(fileName);
  if (!realPath) {
    await apiSend('PATCH', baseUrl, token, `/api/cloud-sync/file-bridge/${id}`, {
      status: 'error',
      error: 'file not found in the container',
    }).catch(() => {});
    log('error', 'request.file-missing', { id, fileName });
    return;
  }

  // Claim atomico + signed upload URL.
  let claim;
  try {
    claim = await apiSend('PATCH', baseUrl, token, `/api/cloud-sync/file-bridge/${id}`, {
      status: 'uploading',
    });
  } catch (err) {
    log('warn', 'request.claim-skipped', { id, err: err.message });
    return; // 409 già reclamata, o errore transitorio → ritenta prossimo ciclo
  }
  if (!claim?.uploadUrl) {
    log('error', 'request.no-upload-url', { id });
    return;
  }

  // Upload diretto su Supabase Storage via signed URL (PUT con il buffer).
  try {
    const buf = await readFile(realPath);
    const putRes = await fetch(claim.uploadUrl, {
      method: 'PUT',
      headers: {
        'content-type': mimeFor(fileName),
        'x-upsert': 'true',
        'cache-control': 'max-age=3600',
      },
      body: buf,
    });
    if (!putRes.ok) {
      const txt = await putRes.text().catch(() => '');
      throw new Error(`upload HTTP ${putRes.status}: ${txt.slice(0, 200)}`);
    }
  } catch (err) {
    await apiSend('PATCH', baseUrl, token, `/api/cloud-sync/file-bridge/${id}`, {
      status: 'error',
      error: err.message,
    }).catch(() => {});
    log('error', 'request.upload-failed', { id, err: err.message });
    return;
  }

  // Pronto al download.
  await apiSend('PATCH', baseUrl, token, `/api/cloud-sync/file-bridge/${id}`, {
    status: 'ready',
  }).catch((err) => log('error', 'request.ready-failed', { id, err: err.message }));
  log('info', 'request.ready', { id, fileName });
}

export async function runFileBridgePoller() {
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
  let consecutiveErrors = 0;
  let lastActivityAt = Date.now();
  let lastIndexAt = 0;

  const shutdown = (signal) => {
    log('info', 'shutdown.received', { signal });
    shuttingDown = true;
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  const heartbeat = setInterval(() => log('info', 'heartbeat.alive'), 5 * 60 * 1000);

  let haltLogTick = 0;
  while (!shuttingDown) {
    // HALT-WEEKLY guard: come gli altri reader, salta il poll quando il flag
    // è attivo (team killato, niente da servire).
    if (existsSync(WEEKLY_HALT_FLAG)) {
      if (haltLogTick % 60 === 0) log('info', 'poll.skipped', { reason: 'weekly-halt-flag active' });
      haltLogTick += 1;
      await new Promise((r) => setTimeout(r, POLL_IDLE_MS));
      continue;
    }
    if (haltLogTick > 0) {
      log('info', 'poll.resumed');
      haltLogTick = 0;
    }

    let backoff = tierInterval(lastActivityAt, { allowDeepIdle: false });
    try {
      // 1. Indice + purge a tempo (~60s), indipendenti dal tier di poll.
      if (Date.now() - lastIndexAt >= INDEX_EVERY_MS) {
        lastIndexAt = Date.now();
        const files = await buildIndex();
        const r = await apiSend('POST', baseUrl, token, '/api/cloud-sync/file-index', { files });
        log('info', 'index.published', { indexed: r.indexed ?? files.length });
        await apiSend('POST', baseUrl, token, '/api/cloud-sync/file-bridge/purge')
          .then((p) => { if (p.purged) log('info', 'purge.done', { purged: p.purged }); })
          .catch((err) => log('warn', 'purge.failed', { err: err.message }));
      }

      // 2. Richieste pending (ogni tick: è la parte reattiva).
      const r = await apiGet(baseUrl, token, '/api/cloud-sync/file-bridge?status=pending&limit=20');
      consecutiveErrors = 0;
      const requests = Array.isArray(r.requests) ? r.requests : [];
      if (requests.length > 0) {
        // Attività confermata: torna a 5s per servire i file in coda.
        lastActivityAt = Date.now();
        backoff = tierInterval(lastActivityAt, { allowDeepIdle: false });
        log('info', 'poll.found-pending', { count: requests.length });
        for (const req of requests) {
          if (shuttingDown) break;
          try { await processRequest(baseUrl, token, req); }
          catch (err) { log('error', 'process.crashed', { id: req.id, err: err.message }); }
        }
      }
    } catch (err) {
      consecutiveErrors += 1;
      backoff = errorBackoff(tierInterval(lastActivityAt, { allowDeepIdle: false }), consecutiveErrors);
      log('error', 'poll.failed', { err: err.message, consecutiveErrors, nextBackoffMs: backoff });
    }
    if (shuttingDown) break;
    await new Promise((r) => setTimeout(r, backoff));
  }

  clearInterval(heartbeat);
  log('info', 'shutdown.done');
  process.exit(0);
}
