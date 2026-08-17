// supabase-direct.js
//
// Accesso DIRETTO a Supabase dal daemon VPS — Fase 1 di [JHT-DAEMON-SUPABASE-DIRECT].
// Vedi docs/internal/architecture/daemon-sync-redesign.md.
//
// PERCHÉ: oggi ogni lettura di background (ticket, flag-sync, desired-state) passa
// per le route HTTP di Vercel → 1 invocazione serverless + ~2,8 Observability Events
// FATTURATI a ogni giro, anche a vuoto. Su Supabase Pro le query NON si pagano a
// chiamata (paghi il compute always-on): spostare le LETTURE qui azzera quel costo.
//
// COME: REST puro (PostgREST + GoTrue) via `fetch`, niente SDK e niente dipendenze
// nuove. Il daemon ha già `supabase_url` + `supabase_refresh_token` + `user_id` in
// `cloud.json` (salvati al pairing dal login Google). Con il refresh_token ci si
// autentica COME l'utente: la RLS (`auth.uid() = user_id`) garantisce l'accesso ai
// soli dati suoi — niente service-role sulla VPS.
//
// NB: GoTrue RUOTA il refresh_token a ogni uso. Va persistito subito (callback
// `onRefreshToken`), altrimenti al riavvio il token salvato è invalido.

/** Errore di autenticazione Supabase (refresh_token scaduto/revocato → re-pairing). */
export class SupabaseAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SupabaseAuthError';
  }
}

const REFRESH_SKEW_MS = 60_000; // rinnova 60s prima della scadenza

/**
 * Crea un client Supabase-diretto minimale (auth refresh + REST read/patch).
 *
 * @param {object} o
 * @param {string} o.supabaseUrl   es. https://<ref>.supabase.co
 * @param {string} o.anonKey       chiave anon/publishable (pubblica)
 * @param {string} o.refreshToken  refresh_token dell'utente (da cloud.json)
 * @param {string} [o.userId]      user_id (per filtri espliciti; la RLS già scoping)
 * @param {(newToken: string) => (void|Promise<void>)} [o.onRefreshToken]
 *        chiamata quando GoTrue ruota il refresh_token → persistilo su cloud.json.
 * @param {(level: 'warn'|'info', msg: string) => void} [o.log]
 */
export function createSupabaseDirect({ supabaseUrl, anonKey, refreshToken, userId, onRefreshToken, log } = {}) {
  if (!supabaseUrl) throw new Error('supabase-direct: missing supabaseUrl');
  if (!anonKey) throw new Error('supabase-direct: missing anonKey (env JHT_SUPABASE_ANON_KEY or cloud.json.supabase_anon_key)');
  if (!refreshToken) throw new Error('supabase-direct: missing refreshToken (cloud.json.supabase_refresh_token)');

  const base = supabaseUrl.replace(/\/+$/, '');
  const authUrl = `${base}/auth/v1/token?grant_type=refresh_token`;
  const restBase = `${base}/rest/v1`;
  const noop = () => {};
  const logFn = typeof log === 'function' ? log : noop;

  let accessToken = null;
  let expiresAtMs = 0;
  let currentRefresh = refreshToken;

  /** Scambia il refresh_token con un access_token fresco. Ruota e persiste. */
  async function refresh(signal) {
    let res;
    try {
      res = await fetch(authUrl, {
        method: 'POST',
        headers: { apikey: anonKey, 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({ refresh_token: currentRefresh }),
      });
    } catch (err) {
      throw new Error(`supabase-direct refresh network: ${err.message}`);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      // 400/401 = refresh_token scaduto o revocato → serve re-pairing.
      if (res.status === 400 || res.status === 401) {
        throw new SupabaseAuthError(
          `refresh_token rejected (HTTP ${res.status}${body.error_description ? `: ${body.error_description}` : ''}). Pair the device again from the desktop app.`,
        );
      }
      throw new Error(`supabase-direct refresh HTTP ${res.status}`);
    }
    accessToken = body.access_token || null;
    const expiresIn = Number(body.expires_in) || 3600;
    expiresAtMs = Date.now() + expiresIn * 1000;
    if (!accessToken) throw new Error('supabase-direct refresh: access_token missing from response');
    // GoTrue ruota il refresh_token → persistilo SUBITO.
    if (body.refresh_token && body.refresh_token !== currentRefresh) {
      currentRefresh = body.refresh_token;
      try {
        await onRefreshToken?.(currentRefresh);
      } catch (err) {
        logFn('warn', `failed to persist refresh_token: ${err.message}`);
      }
    }
  }

  /** Garantisce un access_token valido (refresh se mancante o in scadenza). */
  async function ensureToken(signal) {
    if (!accessToken || Date.now() >= expiresAtMs - REFRESH_SKEW_MS) {
      await refresh(signal);
    }
    return accessToken;
  }

  /**
   * Chiamata REST (PostgREST). Su 401 fa UN refresh + retry (token scaduto a metà).
   * @param {string} path es. `position_tickets?status=eq.open`
   * @param {object} [opts] { method, headers, body, prefer }
   */
  async function rest(path, opts = {}) {
    const doFetch = async () => {
      await ensureToken(opts.signal);
      const headers = {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.prefer ? { Prefer: opts.prefer } : {}),
        ...(opts.headers || {}),
      };
      return fetch(`${restBase}/${path}`, {
        method: opts.method || 'GET',
        headers,
        signal: opts.signal,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
    };

    let res = await doFetch();
    if (res.status === 401) {
      // access_token scaduto durante l'uso → forza refresh e ritenta una volta.
      accessToken = null;
      res = await doFetch();
    }
    if (res.status === 401) {
      throw new SupabaseAuthError('PostgREST returned 401 after refresh: invalid session.');
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`supabase-direct REST ${res.status} su ${path}: ${txt.slice(0, 200)}`);
    }
    // PATCH con Prefer return=minimal può non avere body.
    if (res.status === 204) return null;
    return res.json().catch(() => null);
  }

  // ── Letture di alto livello (rimpiazzano le GET Vercel del daemon) ──

  /**
   * Ticket 'open' creati dall'utente sul web. Rimpiazza
   * GET /api/cloud-sync/tickets (PULL). Ritorna la STESSA shape che il daemon
   * già consuma: { id, position_legacy_id, request_text, kind, status, created_at }.
   * @param {object} [o] { since?: ISO string — solo created_at > since }
   */
  async function readOpenTickets({ since } = {}) {
    const params = new URLSearchParams();
    params.set('select', 'id,position_legacy_id,request_text,kind,status,created_at');
    params.set('status', 'eq.open');
    if (since) params.set('created_at', `gt.${since}`);
    params.set('order', 'created_at.asc');
    const rows = await rest(`position_tickets?${params.toString()}`);
    return Array.isArray(rows) ? rows : [];
  }

  /**
   * Posizioni con un flag desired-state cambiato dopo `since` (write/geocode/
   * recheck/salary_precise + esclusione utente). Rimpiazza
   * GET /api/cloud-sync/pull-desired-state. NB: `positions` NON ha `updated_at`
   * (vedi schema), quindi il cursore è sui timestamp dei flag stessi
   * (`*_requested_at`/`user_excluded_at`) via filtro OR.
   * @param {object} [o] { since?: ISO string, limit?: number }
   */
  async function readDesiredStateChanges({ since, limit = 500 } = {}) {
    const cols = 'legacy_id,write_requested,write_requested_at,write_request_kind,geocode_requested,' +
      'geocode_requested_at,recheck_requested,recheck_requested_at,salary_precise_requested,' +
      'salary_precise_requested_at,status,user_excluded_reason,user_excluded_note,' +
      'user_excluded_at,user_excluded_prev_status';
    const params = new URLSearchParams();
    params.set('select', cols);
    if (since) {
      params.set('or', `(write_requested_at.gt.${since},geocode_requested_at.gt.${since},` +
        `recheck_requested_at.gt.${since},salary_precise_requested_at.gt.${since},` +
        `user_excluded_at.gt.${since})`);
    }
    // ORDER deterministico. Il filtro è un OR su 5 colonne timestamp diverse:
    // PostgREST non sa ordinare per il GREATEST() delle 5 (non è una colonna),
    // quindi non esiste una singola chiave che coincida col cursore lato client
    // (che traccia il max dei 5 ts). Ordiniamo per la PK `legacy_id` (indicizzata):
    // NON allinea l'ordine al cursore, ma rende il sottoinsieme sotto `limit`
    // STABILE e ripetibile tick-su-tick (prima era arbitrario → il cursore non
    // convergeva mai). Ogni riga restituita ha comunque almeno un ts > since,
    // quindi il max lato client avanza e la convergenza è garantita finché il
    // numero di cambi nella finestra sta sotto `limit` (caso normale). Fix
    // completo sotto truncation = colonna materializzata `desired_state_changed_at`
    // (max dei 5, mantenuta da trigger) da ordinare .asc → out of scope qui.
    params.set('order', 'legacy_id.asc');
    params.set('limit', String(limit));
    const rows = await rest(`positions?${params.toString()}`);
    return Array.isArray(rows) ? rows : [];
  }

  /**
   * [JHT-MSG-BACKFLOW] Reply/ack scritti dall'utente sulla chat WEB
   * (pending_user_messages, campi user-side). Vanno riportati alla SQLite
   * locale dove l'agente li legge. Cursore sui timestamp delle azioni utente
   * (user_reply_at / acknowledged_at): `updated_at` è inutilizzabile perché
   * il full-push VPS lo bumpa a ogni tick su tutte le righe.
   * @param {object} [o] { since?: ISO string, limit?: number }
   */
  async function readPendingReplyChanges({ since, limit = 500 } = {}) {
    const params = new URLSearchParams();
    params.set('select', 'legacy_id,acknowledged_at,user_reply,user_reply_at');
    if (since) {
      params.set('or', `(user_reply_at.gt.${since},acknowledged_at.gt.${since})`);
    }
    params.set('order', 'legacy_id.asc');
    params.set('limit', String(limit));
    const rows = await rest(`pending_user_messages?${params.toString()}`);
    return Array.isArray(rows) ? rows : [];
  }

  /**
   * #186 — candidature decise dall'utente sul web (`applications`, campi
   * user-side). Il click in cloud-mode scrive solo su Supabase: senza questa
   * lettura il box non lo sa mai, e il team pianifica su una fotografia in cui
   * quelle candidature non esistono.
   *
   * Il cursore e' `updated_at` della candidatura, e a differenza di quello dei
   * flag posizione e' UNA colonna sola: quindi si puo' ordinare per la stessa
   * chiave su cui si filtra, e la finestra converge anche quando il numero di
   * cambi supera `limit`. Regge anche l'annullamento, che azzera `applied_at`
   * — un cursore su quel campo perderebbe per sempre le righe annullate.
   *
   * `applications` sul cloud non ha `legacy_id`: la chiave e' `position_id`
   * (UUID). L'id che il box conosce arriva dall'embed su `positions`, con
   * `!inner` perche' una candidatura orfana non e' applicabile da nessuna
   * parte. Lo appiattiamo qui, cosi' chi applica vede la stessa forma di riga
   * delle altre corsie.
   * @param {object} [o] { since?: ISO string, limit?: number }
   */
  async function readAppliedChanges({ since, limit = 500 } = {}) {
    const params = new URLSearchParams();
    params.set(
      'select',
      'applied,applied_at,applied_via,status,updated_at,positions!inner(legacy_id)'
    );
    if (since) params.set('updated_at', `gt.${since}`);
    params.set('order', 'updated_at.asc');
    params.set('limit', String(limit));
    const rows = await rest(`applications?${params.toString()}`);
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => ({
      legacy_id: r?.positions?.legacy_id ?? null,
      applied: r?.applied ?? false,
      applied_at: r?.applied_at ?? null,
      applied_via: r?.applied_via ?? null,
      status: r?.status ?? null,
      updated_at: r?.updated_at ?? null,
    }));
  }

  /**
   * [JHT-CHAT-UNIFY] Turni scritti dall'utente dalla chat web e non ancora
   * consegnati al pane dell'agente (`author='user'`, `delivered_at IS NULL`).
   * Sono righe NATIVE del cloud: legacy_id negativo, nessun gemello in SQLite
   * finché non le importa il box (vedi mig 060).
   *
   * Letta solo quando `team_state.chat_requested_at` segnala che c'è qualcosa
   * — a chat ferma questa query non parte mai.
   * @param {object} [o] { limit?: number }
   */
  async function readUndeliveredUserChat({ limit = 50 } = {}) {
    const params = new URLSearchParams();
    params.set(
      'select',
      'id,legacy_id,agent,body,source_id,source_action,source_payload,source_directive_id,created_at',
    );
    params.set('author', 'eq.user');
    // NATIVE DEL CLOUD, cioe' scritte dal browser: `legacy_id` negativo (mig
    // 060). Il filtro era dichiarato nel commento e non nella query, e senza
    // di esso il box si ripescava i PROPRI turni — quelli che aveva appena
    // pushato, con id positivo — reimportandoli come nuovi. Il gemello
    // nasceva con `chat_ts` troncato al secondo (frazione .000), che e' la
    // firma vista sulla coppia 291/292.
    params.set('legacy_id', 'lt.0');
    params.set('delivered_at', 'is.null');
    params.set('order', 'created_at.asc');
    params.set('limit', String(limit));
    const rows = await rest(`pending_user_messages?${params.toString()}`);
    return Array.isArray(rows) ? rows : [];
  }

  /**
   * Marca consegnati i turni dell'utente (dopo che sono arrivati nel pane).
   * `delivered_at` è nella policy UPDATE dell'utente (mig 010), quindi passa
   * con la sessione dell'utente: nessun service-role sul box.
   */
  async function markUserChatDelivered(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    const list = ids.map((id) => `"${String(id).replace(/"/g, '')}"`).join(',');
    await rest(`pending_user_messages?id=in.(${list})`, {
      method: 'PATCH',
      body: { delivered_at: new Date().toISOString() },
      prefer: 'return=minimal',
    });
  }

  /**
   * Riga `team_state` dell'utente (PK user_id → al più 1 riga, già scoping RLS).
   * Rimpiazza GET /api/team-state (sync rendezvous + desired-state/reconcile).
   * @param {string[]} [select] colonne; default i campi sync + desired-state.
   */
  async function readTeamState(select, { signal } = {}) {
    const cols = (select && select.length
      ? select
      : ['user_id', 'should_run', 'agents_enabled', 'restart_token',
         'sync_requested_at', 'sync_completed_at', 'active_device_id']
    ).join(',');
    const rows = await rest(`team_state?select=${encodeURIComponent(cols)}&limit=1`, { signal });
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  /**
   * Aggiorna campi della propria riga team_state (es. ack `sync_completed_at`).
   * Filtro user_id esplicito oltre alla RLS.
   */
  async function patchTeamState(fields, { signal } = {}) {
    const filter = userId ? `user_id=eq.${userId}` : 'user_id=not.is.null';
    await rest(`team_state?${filter}`, {
      method: 'PATCH',
      body: fields,
      prefer: 'return=minimal',
      signal,
    });
  }

  return {
    ensureToken,
    rest,
    readOpenTickets,
    readDesiredStateChanges,
    readPendingReplyChanges,
    readAppliedChanges,
    readUndeliveredUserChat,
    markUserChatDelivered,
    readTeamState,
    patchTeamState,
    getRefreshToken: () => currentRefresh,
  };
}
