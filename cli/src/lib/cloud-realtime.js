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
import { writePrivateJson } from './secure-config-io.js';

const CLOUD_FILE = join(JHT_HOME, 'cloud.json');

// Anon key del progetto prod: PUBBLICA by-design (è nel bundle del browser, ogni
// accesso è protetto dalla RLS). Stessa di cloud-direct.js. Sovrascrivibile via env
// JHT_SUPABASE_ANON_KEY o cloud.json.supabase_anon_key.
const DEFAULT_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtaXR0d3ZvaHNud3d3aXNxZHJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMDIzMDgsImV4cCI6MjA4OTY3ODMwOH0.g7twGaXdmmqBtukaioaJ1OV2mXVJqpEhkyzXaEIH44I';

/**
 * Il daemon deve girare in modalità event-driven invece che poll?
 *
 * I pairing moderni portano già le credenziali utente necessarie: Realtime è
 * quindi il default sicuro. `JHT_REALTIME_SYNC=0` resta l'opt-out di rollout;
 * `=1` forza il tentativo e degrada poi al fallback bounded se le credenziali
 * non sono disponibili.
 */
export function realtimeSyncEnabled(config = null) {
  if (process.env.JHT_REALTIME_SYNC === '0') return false;
  if (process.env.JHT_REALTIME_SYNC === '1') return true;
  return !!getRealtimeCreds(config);
}

/** Estrae le credenziali Realtime da cloud.json (o null se mancanti). */
export function getRealtimeCreds(config) {
  const supabaseUrl = config?.supabase_url;
  const refreshToken = config?.supabase_refresh_token;
  const anonKey = process.env.JHT_SUPABASE_ANON_KEY || config?.supabase_anon_key || DEFAULT_ANON_KEY;
  if (!supabaseUrl || !refreshToken || !anonKey) return null;
  return { supabaseUrl, anonKey, refreshToken, userId: config.user_id };
}

/**
 * The Supabase errors that say the SESSION is gone (its refresh token was used before, or never
 * existed, or the session ended), as opposed to a network hiccup. GoTrue answers 400 with the code
 * `refresh_token_already_used` when a token is presented again after its reuse window, and then ends
 * the whole session: no token of it works any more, and only a new pairing brings it back.
 */
const SESSION_GONE_CODES = new Set([
  'refresh_token_already_used', 'refresh_token_not_found', 'session_not_found', 'session_expired',
]);
const SESSION_GONE_TEXT = /invalid refresh token|already used|refresh token not found|session (?:not found|expired)/i;

export function sessionGone(error) {
  if (!error) return false;
  return SESSION_GONE_CODES.has(error.code) || SESSION_GONE_TEXT.test(String(error.message || ''));
}

/** The daemon could not authenticate because the session of this device is gone: the user must pair it again. */
export class RealtimeSessionLostError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RealtimeSessionLostError';
    this.code = 'session_lost';
  }
}

async function storedRefreshToken() {
  try {
    const token = JSON.parse(await readFile(CLOUD_FILE, 'utf-8'))?.supabase_refresh_token;
    return typeof token === 'string' && token ? token : null;
  } catch {
    return null;
  }
}

// The writes of the rotated token go one after the other: each one reads cloud.json and writes it back
// whole, so two at once could leave the older token on disk, and a stale token on disk is a session
// lost at the next start. `close()` waits for the last one.
let writes = Promise.resolve();

/**
 * Persiste il refresh_token ruotato su cloud.json (0600), in coda; un errore si dice, non si ingoia.
 * È l'UNICO punto di scrittura del token nel processo: anche il lettore diretto (cloud-direct.js) passa di qui.
 */
export function persistRefreshToken(newToken, log = () => {}) {
  writes = writes.then(async () => {
    try {
      const c = JSON.parse(await readFile(CLOUD_FILE, 'utf-8'));
      c.supabase_refresh_token = newToken;
      writePrivateJson(CLOUD_FILE, c);
      await chmod(CLOUD_FILE, 0o600);
    } catch (e) {
      log('warn', `could not save the rotated refresh token to cloud.json (${e.code || e.message}): the next start may need the device paired again`);
    }
  });
  return writes;
}

/**
 * Crea il client Supabase Realtime autenticato e pronto per le subscribe.
 *
 * @param {object} o
 * @param {object} o.config  cloud.json già caricato (supabase_url + supabase_refresh_token + user_id)
 * @param {(level:'info'|'warn', msg:string)=>void} [o.log]
 * @param {()=>void} [o.onSessionLost]  called once if the session ends while the daemon runs (a refresh the server refuses)
 * @returns {Promise<{client, subscribe, trackPresence, close, isConnected}>}
 *
 * - subscribe(name, { table, event='*', filter }, handler): iscrive un listener
 *   postgres_changes; `handler(payload)` è protetto da try/catch. Ogni canale
 *   porta il filtro `user_id=eq.<utente della sessione>` (quello passato in
 *   `filter` lo sostituisce), e un payload che nomina un altro user_id non
 *   arriva all'handler: la RLS non resta l'unica difesa di un evento che fa
 *   agire il box (lo STOP d'emergenza si legge dal payload di team_state).
 * - trackPresence(key?): segnala "VPS online" via presence del websocket.
 * - close(): rimuove i canali e chiude il socket.
 */
export async function createRealtimeSync({ config, log = () => {}, onSessionLost = () => {}, createClient: create = null } = {}) {
  const creds = getRealtimeCreds(config);
  if (!creds) {
    throw new Error('cloud-realtime: missing credentials (supabase_url / supabase_refresh_token / anon key)');
  }

  // `create`: a client factory for the tests; the daemon passes none.
  const createClient = create ?? (await import('@supabase/supabase-js')).createClient;
  const client = createClient(creds.supabaseUrl, creds.anonKey, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 5 } },
  });

  // Auth con refresh_token: ottiene la session (access+refresh) → il client passa
  // l'access token al Realtime (RLS). autoRefreshToken lo tiene fresco.
  let { data, error } = await client.auth.refreshSession({ refresh_token: creds.refreshToken });
  if (sessionGone(error)) {
    // `config` was read when the daemon started. If another process of this box rotated the token
    // since (a second daemon on the same cloud.json, a start that overlapped the stop of the old
    // one), cloud.json holds the newer one: try it, once. The same token again would only be one
    // more use of a token the server already refused.
    const stored = await storedRefreshToken();
    if (stored && stored !== creds.refreshToken) {
      log('info', 'refresh token refused; cloud.json holds a different one (rotated by another process): trying it once');
      ({ data, error } = await client.auth.refreshSession({ refresh_token: stored }));
    }
  }
  if (error || !data?.session?.access_token) {
    const message = `cloud-realtime auth: ${error?.message || 'no session from refresh_token'}`;
    throw sessionGone(error) ? new RealtimeSessionLostError(message) : new Error(message);
  }
  await persistRefreshToken(data.session.refresh_token, log);
  // L'utente è quello della sessione, non quello scritto in cloud.json: è lui
  // che la RLS vede, ed è lui che i filtri dei canali devono nominare.
  const userId = data.session.user?.id || creds.userId;
  if (!userId) throw new Error('cloud-realtime auth: no user in the session');

  // CRUCIALE per postgres_changes con RLS: il socket Realtime DEVE usare lo
  // user-JWT (non l'anon key) PRIMA di qualsiasi subscribe, altrimenti la RLS
  // valuta come anon e blocca SILENZIOSAMENTE la consegna (canale SUBSCRIBED ma
  // zero eventi). L'auto-wiring di supabase-js è asincrono e può arrivare dopo la
  // subscribe → lo forziamo qui.
  try { await client.realtime.setAuth(data.session.access_token); }
  catch (e) { log('warn', `initial setAuth: ${e.message}`); }

  // Ad ogni rotazione del token (TOKEN_REFRESHED) → ripersisti + riallinea il
  // Realtime al nuovo access token.
  let lostTold = false;
  client.auth.onAuthStateChange((event, session) => {
    // supabase-js ends the session (SIGNED_OUT) when a refresh is refused for good. Until now the daemon
    // went on for days with no word of it; the user hears of it once, as at boot.
    if (event === 'SIGNED_OUT') {
      log('warn', 'the Supabase session ended while the daemon was running (refresh refused)');
      if (!lostTold) {
        lostTold = true;
        try { onSessionLost(); } catch { /* the notice never stops the daemon */ }
      }
      return;
    }
    if (session?.refresh_token) void persistRefreshToken(session.refresh_token, log);
    if (session?.access_token) {
      try { client.realtime.setAuth(session.access_token); } catch { /* best-effort */ }
    }
  });

  const channels = [];

  function subscribe(name, { table, event = '*', filter } = {}, handler, onStatus = () => {}) {
    const opts = { event, schema: 'public', table, filter: filter || `user_id=eq.${userId}` };
    const ch = client
      .channel(`jht-${name}`)
      .on('postgres_changes', opts, (payload) => {
        const owners = [payload?.new?.user_id, payload?.old?.user_id].filter((v) => v != null);
        if (owners.some((owner) => owner !== userId)) {
          log('warn', `channel ${name}: dropped an event of another user`);
          return;
        }
        try { handler(payload); } catch (e) { log('warn', `handler ${name}: ${e.message}`); }
      })
      .subscribe((status, err) => {
        log('info', `channel ${name}: ${status}${err ? ' — ' + err.message : ''}`);
        try { onStatus(status, err); } catch { /* stato osservativo */ }
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
    // No rotation may start while the process is leaving: its answer could not be saved, and the
    // next start would present a token the server has already used.
    try { await client.auth.stopAutoRefresh?.(); } catch { /* ignore */ }
    for (const ch of channels) { try { await client.removeChannel(ch); } catch { /* ignore */ } }
    try { await client.realtime.disconnect(); } catch { /* ignore */ }
    await writes;
  }

  function isConnected() {
    try { return client.realtime.isConnected(); } catch { return false; }
  }

  return { client, subscribe, trackPresence, close, isConnected, userId };
}
