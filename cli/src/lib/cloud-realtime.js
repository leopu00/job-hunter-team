// cloud-realtime.js
//
// Client Supabase Realtime per il daemon VPS — [JHT-REALTIME-SYNC] tappa 1 del piano
// event-driven (vedi docs/internal/architecture/daemon-sync-redesign.md
// e docs/internal/architecture/daemon-sync-redesign.md).
//
// PERCHÉ: oggi il daemon polla `team_state` ogni ~5s (sync-check) + corsie 60s → ~900
// query/h/utente. Con Realtime il daemon si ISCRIVE alle tabelle che cambiano di rado
// (team_state, position_tickets) e reagisce solo all'evento → da ~900 a ~30-50 q/h.
//
// DIETRO FLAG `JHT_REALTIME_SYNC=1` (default OFF → comportamento odierno invariato).
//
// AUTH: riusa le credenziali di cloud.json (supabase_url + supabase_refresh_token) +
// anon key pubblica, ESATTAMENTE come supabase-direct/cloud-direct. Il refresh_token
// autentica COME l'utente → la RLS (`auth.uid() = user_id`) consegna SOLO le sue righe.
// GoTrue ruota il refresh_token a ogni uso → va persistito subito su cloud.json
// (onAuthStateChange), altrimenti al riavvio il token salvato è invalido.

import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { JHT_HOME } from '../jht-paths.js';

const CLOUD_FILE = join(JHT_HOME, 'cloud.json');

// Anon key del progetto prod: PUBBLICA by-design (è nel bundle del browser, ogni
// accesso è protetto dalla RLS). Stessa di cloud-direct.js. Sovrascrivibile via env
// JHT_SUPABASE_ANON_KEY o cloud.json.supabase_anon_key.
const DEFAULT_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtaXR0d3ZvaHNud3d3aXNxZHJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMDIzMDgsImV4cCI6MjA4OTY3ODMwOH0.g7twGaXdmmqBtukaioaJ1OV2mXVJqpEhkyzXaEIH44I';

/** Il daemon deve girare in modalità event-driven (Realtime) invece che poll? */
export function realtimeSyncEnabled() {
  return process.env.JHT_REALTIME_SYNC === '1';
}

/** Estrae le credenziali Realtime da cloud.json (o null se mancanti). */
export function getRealtimeCreds(config) {
  const supabaseUrl = config?.supabase_url;
  const refreshToken = config?.supabase_refresh_token;
  const anonKey = process.env.JHT_SUPABASE_ANON_KEY || config?.supabase_anon_key || DEFAULT_ANON_KEY;
  if (!supabaseUrl || !refreshToken || !anonKey) return null;
  return { supabaseUrl, anonKey, refreshToken, userId: config.user_id };
}

/** Persiste il refresh_token ruotato su cloud.json (best-effort, 0600). */
async function persistRefreshToken(newToken) {
  try {
    const c = JSON.parse(await readFile(CLOUD_FILE, 'utf-8'));
    c.supabase_refresh_token = newToken;
    await mkdir(JHT_HOME, { recursive: true });
    await writeFile(CLOUD_FILE, JSON.stringify(c, null, 2) + '\n');
    await chmod(CLOUD_FILE, 0o600);
  } catch { /* best-effort: al prossimo refresh riprova */ }
}

/**
 * Crea il client Supabase Realtime autenticato e pronto per le subscribe.
 *
 * @param {object} o
 * @param {object} o.config  cloud.json già caricato (supabase_url + supabase_refresh_token + user_id)
 * @param {(level:'info'|'warn', msg:string)=>void} [o.log]
 * @returns {Promise<{client, subscribe, trackPresence, close, isConnected}>}
 *
 * - subscribe(name, { table, event='*', filter }, handler): iscrive un listener
 *   postgres_changes; `handler(payload)` è protetto da try/catch. La RLS consegna
 *   solo le righe dell'utente; `filter` (es. `user_id=eq.<id>`) è opzionale.
 * - trackPresence(key?): segnala "VPS online" via presence del websocket.
 * - close(): rimuove i canali e chiude il socket.
 */
export async function createRealtimeSync({ config, log = () => {} } = {}) {
  const creds = getRealtimeCreds(config);
  if (!creds) {
    throw new Error('cloud-realtime: missing credentials (supabase_url / supabase_refresh_token / anon key)');
  }

  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(creds.supabaseUrl, creds.anonKey, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 5 } },
  });

  // Auth con refresh_token: ottiene la session (access+refresh) → il client passa
  // l'access token al Realtime (RLS). autoRefreshToken lo tiene fresco.
  const { data, error } = await client.auth.refreshSession({ refresh_token: creds.refreshToken });
  if (error || !data?.session?.access_token) {
    throw new Error(`cloud-realtime auth: ${error?.message || 'no session from refresh_token'}`);
  }
  await persistRefreshToken(data.session.refresh_token);

  // CRUCIALE per postgres_changes con RLS: il socket Realtime DEVE usare lo
  // user-JWT (non l'anon key) PRIMA di qualsiasi subscribe, altrimenti la RLS
  // valuta come anon e blocca SILENZIOSAMENTE la consegna (canale SUBSCRIBED ma
  // zero eventi). L'auto-wiring di supabase-js è asincrono e può arrivare dopo la
  // subscribe → lo forziamo qui.
  try { await client.realtime.setAuth(data.session.access_token); }
  catch (e) { log('warn', `initial setAuth: ${e.message}`); }

  // Ad ogni rotazione del token (TOKEN_REFRESHED) → ripersisti + riallinea il
  // Realtime al nuovo access token.
  client.auth.onAuthStateChange((event, session) => {
    if (session?.refresh_token) void persistRefreshToken(session.refresh_token);
    if (session?.access_token) {
      try { client.realtime.setAuth(session.access_token); } catch { /* best-effort */ }
    }
  });

  const channels = [];

  function subscribe(name, { table, event = '*', filter } = {}, handler) {
    const opts = { event, schema: 'public', table };
    if (filter) opts.filter = filter;
    const ch = client
      .channel(`jht-${name}`)
      .on('postgres_changes', opts, (payload) => {
        try { handler(payload); } catch (e) { log('warn', `handler ${name}: ${e.message}`); }
      })
      .subscribe((status, err) => {
        log('info', `channel ${name}: ${status}${err ? ' — ' + err.message : ''}`);
      });
    channels.push(ch);
    return ch;
  }

  async function trackPresence(key = creds.userId || 'vps') {
    const ch = client.channel('jht-presence', { config: { presence: { key } } });
    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        try { await ch.track({ online_at: new Date().toISOString() }); } catch { /* best-effort */ }
      }
    });
    channels.push(ch);
    return ch;
  }

  async function close() {
    for (const ch of channels) { try { await client.removeChannel(ch); } catch { /* ignore */ } }
    try { await client.realtime.disconnect(); } catch { /* ignore */ }
  }

  function isConnected() {
    try { return client.realtime.isConnected(); } catch { return false; }
  }

  return { client, subscribe, trackPresence, close, isConnected };
}
