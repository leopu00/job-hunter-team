/**
 * Realtime subscriber per team_commands.
 *
 * Long-running process che si collega a Supabase Realtime via
 * WebSocket e ascolta INSERT sulla tabella public.team_commands
 * filtrata per user_id corrente. Quando arriva un comando esegue
 * `jht team start/stop/restart` dentro il container (siamo gia' nel
 * container, `IS_CONTAINER=1`, quindi spawn diretto), poi aggiorna
 * la riga con processed_at + status = 'done' | 'error'.
 *
 * Architettura:
 *
 *   Web (Start button)
 *     │ POST /api/team/command
 *     ▼
 *   Supabase: INSERT public.team_commands
 *     │ Realtime publication broadcast
 *     ▼
 *   Subscriber (questo file, dentro container VPS)
 *     │ on('postgres_changes', INSERT, filter user_id=N)
 *     ▼
 *   spawn `node /app/cli/bin/jht.js team <action>`
 *     │ exit code → UPDATE status/processed_at/error
 *     ▼
 *   Web subscribe sulla stessa riga vede status='done' → toast OK
 *
 * Resilienza:
 *   - Backlog all'avvio: SELECT pending → process sync prima di subscribe.
 *   - Reconnect WS: il client Supabase ha auto-reconnect built-in;
 *     loggiamo gli eventi system.
 *   - Refresh token: Supabase SDK ruota access_token automaticamente
 *     dal refresh_token salvato.
 *   - Idempotenza: usiamo `UPDATE … WHERE status = 'pending'` cosi'
 *     se due subscriber per qualche motivo girassero (failover) solo
 *     uno completa il claim.
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import pc from 'picocolors';

// Anon key public del progetto JHT Supabase. Hardcoded perche':
//   1. JHT ha 1 solo progetto Supabase (no multi-tenant)
//   2. anon key e' pubblico per design (RLS protegge i dati)
//   3. evita un round-trip al web per fetch della config
// Se mai si moltiplicano i progetti, splittare in env var.
const SUPABASE_URL_DEFAULT = 'https://smittwvohsnwwwisqdrh.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtaXR0d3ZvaHNud3d3aXNxZHJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMDIzMDgsImV4cCI6MjA4OTY3ODMwOH0.g7twGaXdmmqBtukaioaJ1OV2mXVJqpEhkyzXaEIH44I';

const JHT_HOME = process.env.JHT_HOME || join(process.env.HOME || '/jht_home', '.jht');
const CLOUD_FILE = join(JHT_HOME, 'cloud.json');
const JHT_BIN = '/app/cli/bin/jht.js';

function log(level, msg, meta) {
  const ts = new Date().toISOString();
  const tag = level === 'error' ? pc.red('[realtime-subscriber]') : pc.dim('[realtime-subscriber]');
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  // stderr per warn/error, stdout per info/debug (pid1 cattura entrambi
  // ma il prefisso 'daemon|' nei log facilita il grep).
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

// Esegue `jht team <action>` come child process. Risolve con
// { ok, exitCode, stdout, stderr }. Non lancia mai: tutti gli errori
// sono trasformati in { ok: false, ... } per gestione uniforme.
function execTeamAction(action) {
  return new Promise((resolve) => {
    const args = [JHT_BIN, 'team', action];
    log('info', 'exec.start', { args });
    const child = spawn(process.execPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, IS_CONTAINER: '1' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      log('error', 'exec.spawn-error', { err: err.message });
      resolve({ ok: false, exitCode: -1, stdout, stderr: err.message });
    });
    child.on('exit', (code) => {
      const ok = code === 0;
      log(ok ? 'info' : 'error', 'exec.exit', { code, action });
      resolve({ ok, exitCode: code, stdout, stderr });
    });
  });
}

// Processa un singolo comando team. Aggiorna riga su DB:
//   pending → running (claim)
//   → exec
//   → done | error
// L'UPDATE iniziale .eq('status', 'pending') previene double-processing
// se due subscriber girassero contemporaneamente per qualche reason.
async function processCommand(supabase, command) {
  const { id, action } = command;
  log('info', 'command.received', { id, action });

  // Claim atomico: pending → running. Se la riga non e' piu' pending
  // (altro subscriber l'ha presa), abort silenzioso.
  const { data: claimed, error: claimErr } = await supabase
    .from('team_commands')
    .update({ status: 'running' })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (claimErr) {
    log('error', 'command.claim-failed', { id, err: claimErr.message });
    return;
  }
  if (!claimed) {
    log('warn', 'command.skip-already-claimed', { id });
    return;
  }

  const validActions = new Set(['start', 'stop', 'restart']);
  if (!validActions.has(action)) {
    await supabase
      .from('team_commands')
      .update({
        status: 'error',
        processed_at: new Date().toISOString(),
        error: `invalid action: ${action}`,
      })
      .eq('id', id);
    log('error', 'command.invalid-action', { id, action });
    return;
  }

  const res = await execTeamAction(action);
  await supabase
    .from('team_commands')
    .update({
      status: res.ok ? 'done' : 'error',
      processed_at: new Date().toISOString(),
      error: res.ok ? null : (res.stderr || `exit code ${res.exitCode}`).slice(0, 2000),
    })
    .eq('id', id);
  log(res.ok ? 'info' : 'error', 'command.processed', {
    id,
    action,
    ok: res.ok,
    exitCode: res.exitCode,
  });
}

// Backlog drain: al boot processiamo qualunque pending arretrato.
// Necessario perche' Realtime push solo eventi nuovi durante la
// connessione attiva — un comando arrivato mentre il container era
// down sarebbe perso senza questa SELECT.
async function processBacklog(supabase, userId) {
  const { data, error } = await supabase
    .from('team_commands')
    .select('id, action')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('requested_at', { ascending: true })
    .limit(50);
  if (error) {
    log('error', 'backlog.query-failed', { err: error.message });
    return;
  }
  if (!data || data.length === 0) {
    log('info', 'backlog.empty');
    return;
  }
  log('info', 'backlog.draining', { count: data.length });
  for (const cmd of data) {
    await processCommand(supabase, cmd);
  }
}

export async function runRealtimeSubscriber() {
  const config = await loadCloudConfig();
  if (!config?.enabled) {
    log('warn', 'startup.skipped', { reason: 'cloud sync not enabled' });
    process.exit(0);
  }
  const refreshToken = config.supabase_refresh_token;
  const supabaseUrl = config.supabase_url || SUPABASE_URL_DEFAULT;
  const userId = config.user_id;

  if (!refreshToken || !userId) {
    log('error', 'startup.missing-credentials', {
      hasRefreshToken: !!refreshToken,
      hasUserId: !!userId,
    });
    log('info', 'startup.hint', {
      msg: 'Run `jht cloud pair --force` to refresh cloud.json with supabase credentials',
    });
    process.exit(1);
  }

  log('info', 'startup.begin', { supabaseUrl, userId });

  const supabase = createClient(supabaseUrl, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession: false,
      detectSessionInUrl: false,
    },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  });

  // Scambia refresh_token → access_token e installa la session.
  // Da qui in poi tutti i .from() chiamati con questo client passano
  // il JWT user via RLS auth.uid().
  try {
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
    if (error) throw error;
    if (!data?.session) throw new Error('refreshSession returned no session');
    log('info', 'auth.session-established', { expiresIn: data.session.expires_in });
  } catch (err) {
    log('error', 'auth.refresh-failed', { err: err.message });
    log('info', 'auth.hint', {
      msg: 'refresh_token may have expired. Run jht cloud pair --force from desktop.',
    });
    process.exit(1);
  }

  // Drain del backlog PRIMA della subscribe: cosi' comandi arrivati
  // mentre il subscriber era down vengono eseguiti.
  await processBacklog(supabase, userId);

  // Subscribe a INSERT sulla tabella, filtrata server-side per user_id.
  // RLS gia' restringe SELECT alle proprie righe ma filter esplicito
  // su Realtime channel riduce traffico WebSocket.
  const channel = supabase
    .channel('team_commands_subscriber')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'team_commands',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const cmd = payload?.new;
        if (!cmd?.id || !cmd?.action) {
          log('warn', 'realtime.malformed-payload', { payload });
          return;
        }
        // fire-and-forget: il channel callback deve restare leggero.
        processCommand(supabase, cmd).catch((err) => {
          log('error', 'realtime.process-crashed', { id: cmd.id, err: err.message });
        });
      },
    )
    .subscribe((status, err) => {
      log('info', 'realtime.channel-status', { status });
      if (err) log('error', 'realtime.channel-error', { err: err.message || String(err) });
    });

  log('info', 'subscriber.ready', { channel: 'team_commands_subscriber' });

  // SIGTERM da pid1/docker stop: unsubscribe pulita.
  const shutdown = async (signal) => {
    log('info', 'shutdown.received', { signal });
    try { await supabase.removeChannel(channel); } catch { /* best-effort */ }
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Heartbeat per i log: ogni 5min logghiamo "alive" cosi' un osservatore
  // sa che il processo gira. Non serve per la logica.
  setInterval(() => {
    log('info', 'heartbeat.alive');
  }, 5 * 60 * 1000);
}
