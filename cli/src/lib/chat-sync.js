/**
 * chat-sync.js — [JHT-CHAT-UNIFY] una sola conversazione utente ↔ agente.
 *
 * ── Il problema che chiude ──────────────────────────────────────────────
 * La stessa chat viveva in due posti che non si parlavano:
 *   · il VIDEOGIOCO scrive e legge `/jht_home/agents/<ruolo>/chat.jsonl`
 *     (turno utente appeso al file + payload `[@utente -> @X] [CHAT] …`
 *     consegnato al pane tmux con `jht-tmux-send`);
 *   · il WEB scrive e legge `pending_user_messages` (SQLite → cloud).
 * Scrivere nel gioco non si vedeva sul web e viceversa. E dal web il
 * messaggio non arrivava MAI al pane dell'agente: restava nella SQLite ad
 * aspettare che l'agente si ricordasse di chiamare `jht-check-user-replies`
 * (di sua iniziativa, "in cima al loop"). Da lì le ore di attesa.
 *
 * ── La forma ────────────────────────────────────────────────────────────
 * Il punto di unificazione è il BOX, non la UI. `chat.jsonl` resta la
 * conversazione che il gioco legge; `pending_user_messages` ne è il mirror
 * sincronizzabile. Questo modulo tiene i due allineati nei due versi e
 * consegna i turni dell'utente al pane tmux — la stessa strada del gioco,
 * quindi con le stesse garanzie (busy-wait + verify + submit).
 *
 *   chat.jsonl  ──ingest──►  SQLite  ──push──►  cloud  ──Realtime──►  web
 *        ▲                     ▲                  │
 *        └────mirror───────────┘                  │
 *        └────deliver (tmux)◄──── pull ───────────┘
 *
 * ── Costo ───────────────────────────────────────────────────────────────
 * Tutti i passi cominciano con una verifica LOCALE (stat del file, SELECT
 * su SQLite). A conversazione ferma il giro non tocca né Supabase né
 * Vercel: è la regola di casa (mai polling browser→Vercel, quota Supabase
 * protetta). Il risveglio dal cloud passa da `team_state.chat_requested_at`,
 * che il daemon legge GIÀ nel giro veloce insieme a `sync_requested_at`.
 */

import { existsSync, statSync, openSync, readSync, closeSync, appendFileSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';

/**
 * Le tre figure con cui l'utente conversa. Il web mostra esattamente
 * queste (scelta utente); nel gioco si può parlare con tutto il roster, ma
 * solo queste tre hanno il protocollo di risposta garantito — e sono le
 * uniche che ha senso specchiare sul cloud.
 */
export const CHAT_AGENTS = ['assistente', 'capitano', 'mentor'];

/** Quanti byte di coda leggere da chat.jsonl per giro (i file crescono). */
const TAIL_BYTES = 96 * 1024;

/** Turni consegnati al pane per giro: oltre, si aspetta il tick dopo. */
const MAX_DELIVER_PER_TICK = 5;

/**
 * Quanto indietro può andare il mirror SQLite → `chat.jsonl`. Serve solo al
 * PRIMO giro dopo l'aggiornamento, quando tutto lo storico ha `chat_ts`
 * NULL: senza questo tetto la chat del gioco si riempirebbe di mesi di
 * notifiche vecchie tutte insieme.
 */
const MIRROR_MAX_AGE_MS = Number(process.env.JHT_CHAT_MIRROR_MAX_AGE_MS || 48 * 3600 * 1000);

/** `jht-tmux-send` fa busy-wait fino a 90s: il cap qui gli lascia margine. */
const DELIVER_TIMEOUT_MS = Number(process.env.JHT_CHAT_DELIVER_TIMEOUT_MS || 120_000);

/**
 * Quanto un turno dell'utente può restare in coda prima che l'attesa
 * diventi un guasto da dichiarare. Il giro veloce del daemon è ~5s e il
 * paracadute ~5min; un pane occupato da un turno lungo può rimandare la
 * consegna di qualche minuto ed è normale. Sotto questa soglia gridare
 * sarebbe rumore, sopra è il sintomo che nessuno sta più ritirando.
 */
const STALL_AFTER_MS = Number(process.env.JHT_CHAT_STALL_AFTER_MS || 300_000);

/** Ogni quanto RIPETERE una segnalazione che resta vera (vedi shouldAnnounceStall). */
const STALL_REPEAT_MS = Number(process.env.JHT_CHAT_STALL_REPEAT_MS || 900_000);

/** Una richiesta cloud della chat non può bloccare il giro veloce per sempre. */
const CLOUD_REQUEST_TIMEOUT_MS = Number(process.env.JHT_CHAT_HTTP_TIMEOUT_MS || 15_000);

// ── Funzioni pure (il grosso della logica, testabile senza box) ─────────

/** Directory dell'agente sotto `<JHT_HOME>/agents/`. */
export function chatFileFor(jhtHome, agent) {
  return join(jhtHome, 'agents', agent, 'chat.jsonl');
}

/**
 * Nome della sessione tmux di un agente. Il roster scala con suffisso
 * numerico (`scout-1`): la chat è col RUOLO, quindi il suffisso si toglie.
 * Stessa regola di `resolveTmuxSession` in user-messages-poller.js.
 */
export function tmuxSessionFor(agent) {
  return String(agent).trim().toLowerCase().replace(/-\d+$/, '').toUpperCase();
}

/** `{"role":"user","text":"…","ts":…}` → oggetto normalizzato, o null. */
export function parseChatLine(line) {
  const raw = String(line || '').trim();
  if (!raw.startsWith('{')) return null;
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null; // riga corrotta (quoting shell a mano): si salta, non si esplode
  }
  if (!obj || typeof obj !== 'object') return null;
  const text = typeof obj.text === 'string' ? obj.text : '';
  const ts = Number(obj.ts);
  if (!text.trim() || !Number.isFinite(ts)) return null;
  return { role: typeof obj.role === 'string' ? obj.role : 'assistant', text, ts };
}

/** Il ruolo JSONL diventa l'autore del turno. Solo 'user' è l'utente. */
export function authorFromRole(role) {
  return String(role || '').toLowerCase() === 'user' ? 'user' : 'agent';
}

/**
 * Busta che l'agente si aspetta nel pane. IDENTICA a quella del gioco
 * (`vps_backend.gd::_do_send_chat`) e a quella del bridge Telegram: gli
 * agenti hanno una sola skill di risposta e un solo formato da riconoscere.
 */
export function chatEnvelope(agent, text) {
  return `[@utente -> @${agent}] [CHAT] ${text}`;
}

/** Riga JSONL nel formato che scrivono `jht-send` e il gioco. */
export function jsonlLine({ role, text, ts, done = true }) {
  return `${JSON.stringify({ role, text, ts, done })}\n`;
}

/**
 * Le righe del file che la SQLite non ha ancora. Il confronto è sul `ts`
 * (chiave di dedup del mirror, colonna `chat_ts`): l'id locale non esiste
 * nel file e il testo non è univoco ("ok" arriva mille volte).
 *
 * `knownTs` è un Set di numeri. Ritorna gli oggetti già parsati, in ordine.
 */
export function pickUnmirrored(lines, knownTs) {
  const out = [];
  const seen = new Set();
  for (const line of lines) {
    const parsed = parseChatLine(line);
    if (!parsed) continue;
    if (knownTs.has(parsed.ts) || seen.has(parsed.ts)) continue;
    seen.add(parsed.ts);
    out.push(parsed);
  }
  return out;
}

/**
 * Decide se vale la pena rileggere il file: se dimensione e mtime non si
 * sono mossi, il contenuto non si è mosso. È la guardia che tiene il giro a
 * costo zero quando nessuno sta chattando.
 */
export function fileChanged(prev, stat) {
  if (!prev) return true;
  return prev.size !== stat.size || prev.mtimeMs !== stat.mtimeMs;
}

/** Un rendezvous è pendente se la richiesta è più recente della consegna. */
export function chatPending(requestedAt, deliveredAt) {
  if (!requestedAt) return false;
  if (!deliveredAt) return true;
  // Date.parse e mai confronto lessicografico: `+00:00` e `Z` ordinano
  // diversamente da come si datano (stessa trappola del cursore congelato
  // del 15/07, postmortem 413).
  const req = Date.parse(requestedAt);
  const done = Date.parse(deliveredAt);
  if (!Number.isFinite(req)) return false;
  if (!Number.isFinite(done)) return true;
  return req > done;
}

// ── Coda di lettura del file ────────────────────────────────────────────

/** Ultime righe complete di un file di testo, senza caricarlo tutto. */
export function readTailLines(path, maxBytes = TAIL_BYTES) {
  if (!existsSync(path)) return [];
  const size = statSync(path).size;
  const start = Math.max(0, size - maxBytes);
  const length = size - start;
  if (length <= 0) return [];
  const buf = Buffer.alloc(length);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, buf, 0, length, start);
  } finally {
    closeSync(fd);
  }
  const text = buf.toString('utf-8');
  const lines = text.split('\n');
  // Se abbiamo tagliato a metà, la prima riga è monca: si scarta (la
  // rileggeremo mai — ma è vecchia di 96 KB di conversazione, quindi già
  // specchiata da un pezzo).
  if (start > 0) lines.shift();
  return lines.filter((l) => l.trim() !== '');
}

// ── Cursore del mirror (per non rileggere file fermi) ───────────────────

export async function loadChatCursor(file) {
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(await readFile(file, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function saveChatCursor(file, cursor) {
  await writeFile(file, JSON.stringify(cursor, null, 2), 'utf-8');
}

// ── Passo 1: chat.jsonl → SQLite ────────────────────────────────────────

/**
 * Importa nella SQLite i turni comparsi in `chat.jsonl` e non ancora
 * specchiati. Copre entrambe le direzioni del gioco: il turno che l'utente
 * ha scritto dal gioco E la risposta che l'agente ha scritto con `jht-send`
 * (che non passa da `jht-notify-user` e quindi non sarebbe mai arrivata sul
 * web: è metà del bug "gli agenti non rispondono sul sito").
 *
 * @returns {{inserted:number, cursor:object}}
 */
export function ingestChatJsonl(db, { jhtHome, agents = CHAT_AGENTS, cursor = {} } = {}) {
  const nextCursor = { ...cursor };
  let inserted = 0;

  const insert = db.prepare(
    `INSERT INTO pending_user_messages
       (agent, body, kind, author, chat_ts, delivered_via, delivered_at, created_at)
     VALUES (?, ?, 'notification', ?, ?, 'web', ?, ?)`
  );

  for (const agent of agents) {
    const path = chatFileFor(jhtHome, agent);
    if (!existsSync(path)) continue;
    const stat = statSync(path);
    if (!fileChanged(cursor[agent], stat)) continue;
    nextCursor[agent] = { size: stat.size, mtimeMs: stat.mtimeMs };

    // Solo i ts recenti: leggiamo la coda del file (96 KB), quindi non
    // possiamo incontrare turni più vecchi di così. Caricare l'intera
    // colonna di una conversazione lunga sarebbe sprecato a ogni giro.
    const known = new Set(
      db
        .prepare(
          `SELECT chat_ts FROM pending_user_messages
            WHERE agent = ? AND chat_ts IS NOT NULL
            ORDER BY id DESC LIMIT 1000`
        )
        .all(agent)
        .map((r) => Number(r.chat_ts))
    );

    for (const turn of pickUnmirrored(readTailLines(path), known)) {
      const author = authorFromRole(turn.role);
      const at = new Date(turn.ts * 1000).toISOString().replace('T', ' ').slice(0, 19);
      // `delivered_at` valorizzato: il turno è già passato per il pane
      // (l'ha scritto il gioco o l'agente stesso), non va riconsegnato.
      insert.run(agent, turn.text, author, turn.ts, at, at);
      inserted += 1;
    }
  }

  return { inserted, cursor: nextCursor };
}

// ── Passo 2: SQLite → chat.jsonl ────────────────────────────────────────

/**
 * Porta nel file che il gioco legge i turni nati fuori da lì: le notifiche
 * scritte con `jht-notify-user` (che va dritto in SQLite) e i turni
 * dell'utente arrivati dal web. Senza questo passo la chat del gioco
 * resterebbe cieca su metà conversazione.
 *
 * `chat_ts` viene valorizzato subito dopo la scrittura: è la guardia che
 * impedisce a `ingestChatJsonl` di reimportare la stessa riga al giro dopo.
 */
export function mirrorDbTurnsToJsonl(
  db,
  { jhtHome, agents = CHAT_AGENTS, maxAgeMs = MIRROR_MAX_AGE_MS, now = Date.now() } = {},
) {
  const placeholders = agents.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT id, agent, body, author, created_at
         FROM pending_user_messages
        WHERE chat_ts IS NULL AND agent IN (${placeholders})
        ORDER BY id ASC`
    )
    .all(...agents);
  if (rows.length === 0) return { mirrored: 0, backfilled: 0 };

  const stamp = db.prepare('UPDATE pending_user_messages SET chat_ts = ? WHERE id = ?');
  let mirrored = 0;
  let backfilled = 0;

  for (const row of rows) {
    // Un ts monotono e univoco: `created_at` ha risoluzione al secondo e
    // due notifiche nello stesso secondo collasserebbero sulla stessa
    // chiave di dedup. L'id locale (unico, crescente) va nei millesimi.
    const base = Date.parse(String(row.created_at).replace(' ', 'T') + 'Z');
    const baseMs = Number.isFinite(base) ? base : now;
    const ts = baseMs / 1000 + (row.id % 1000) / 1000;

    // Al primo giro dopo l'aggiornamento TUTTO lo storico ha chat_ts NULL:
    // riversarlo nel file rovescerebbe mesi di notifiche nella chat del
    // gioco, in blocco e fuori contesto. Le righe vecchie si marcano come
    // già specchiate senza scriverle — restano nella chat WEB, che le ha
    // sempre avute, e il file riparte da qui.
    if (now - baseMs > maxAgeMs) {
      stamp.run(ts, row.id);
      backfilled += 1;
      continue;
    }

    const path = chatFileFor(jhtHome, row.agent);
    try {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, jsonlLine({ role: row.author === 'user' ? 'user' : 'assistant', text: row.body, ts }), 'utf-8');
    } catch {
      continue; // file non scrivibile: riprova al giro dopo, chat_ts resta NULL
    }
    stamp.run(ts, row.id);
    mirrored += 1;
  }

  return { mirrored, backfilled };
}

// ── Passo 3: SQLite → cloud (push veloce, solo il nuovo) ────────────────

/**
 * I turni non ancora saliti. `cloud_synced_at` è la colonna che lo schema
 * documenta da sempre come "settata da jht cloud push" e che nessuno
 * scriveva: da qui in poi la scrive questo passo.
 *
 * NB: solo righe con id positivo — quelle a id negativo sul cloud sono
 * native del web e non esistono qui (vedi mig 060).
 */
export function takeChatRowsToPush(db, { limit = 100 } = {}) {
  return db
    .prepare(
      `SELECT id, agent, body, kind, author, chat_ts, related_position_id,
              delivered_via, delivered_at, acknowledged_at,
              user_reply, user_reply_at, agent_seen_reply_at, created_at
         FROM pending_user_messages
        WHERE cloud_synced_at IS NULL
        ORDER BY id ASC
        LIMIT ?`
    )
    .all(limit);
}

export function markChatRowsPushed(db, ids) {
  if (!ids.length) return;
  const stamp = db.prepare('UPDATE pending_user_messages SET cloud_synced_at = CURRENT_TIMESTAMP WHERE id = ?');
  for (const id of ids) stamp.run(id);
}

/**
 * Riga SQLite → riga cloud. Stesso mapping del full-push, ma scritta qui
 * perché questo passo va DIRETTO su Supabase (zero Vercel): il timestamp
 * SQLite `YYYY-MM-DD HH:MM:SS` è UTC senza suffisso e PostgREST lo
 * interpreterebbe come ora locale del server.
 */
export function toCloudRow(row, userId) {
  const utc = (v) => {
    if (!v) return null;
    const s = String(v);
    if (s.includes('T') || s.endsWith('Z') || /[+-]\d\d:\d\d$/.test(s)) return s;
    return `${s.replace(' ', 'T')}Z`;
  };
  return {
    user_id: userId,
    legacy_id: row.id,
    agent: row.agent,
    body: row.body,
    kind: row.kind || 'notification',
    author: row.author === 'user' ? 'user' : 'agent',
    chat_ts: row.chat_ts ?? null,
    delivered_via: row.delivered_via ?? null,
    delivered_at: utc(row.delivered_at),
    acknowledged_at: utc(row.acknowledged_at),
    user_reply: row.user_reply ?? null,
    user_reply_at: utc(row.user_reply_at),
    agent_seen_reply_at: utc(row.agent_seen_reply_at),
    created_at: utc(row.created_at) || new Date().toISOString(),
  };
}

// ── Il canale col cloud della corsia chat ───────────────────────────────

/** Cloud di default, quando `cloud.json` non porta un `base_url`. */
const DEFAULT_BASE_URL = 'https://jobhunterteam.ai';

/**
 * Il verso web→agente ha bisogno di due sole cose dal cloud: leggere i turni
 * dell'utente non ancora consegnati e dire "consegnati". Esistono DUE strade
 * per farlo, con la stessa forma, e la corsia non deve sapere quale sta
 * usando:
 *
 *   · `directChatChannel` — Supabase diretto (`JHT_SUPABASE_DIRECT=1`).
 *     Preferito quando c'è: meno hop, e su Supabase Pro le letture non si
 *     pagano a chiamata.
 *   · `vercelChatChannel` — `/api/cloud-sync/chat` col token del box.
 *
 * PERCHÉ ESISTE IL SECONDO — non è ridondante, è l'unico che gira sul fleet.
 * Il lettore diretto è OPT-IN e documentato come "default OFF → nessun
 * cambio sul fleet" (docs/internal/architecture/daemon-sync-redesign.md):
 * su 4 box di produzione su 5 quel flag è spento e `cloud.json` non ha
 * nemmeno `supabase_url`/`supabase_refresh_token`, quindi `getDirectReader`
 * ritorna `null`. Finché il pull viveva solo sul lettore diretto, su un box
 * in configurazione standard il turno scritto dal web restava su Supabase e
 * non veniva ritirato MAI: chat morta in silenzio, senza un errore in log
 * (diagnosticato sul box di produzione, 2026-07-30). Il verso opposto
 * funzionava perché passa dal token del box su Vercel — che è esattamente il
 * canale che questo ramo riusa.
 */
export function directChatChannel(reader) {
  return {
    kind: 'direct',
    readUndeliveredUserChat: (opts) => reader.readUndeliveredUserChat(opts),
    async closeRendezvous(ids = []) {
      if (ids.length > 0) await reader.markUserChatDelivered(ids);
      await reader.patchTeamState({ chat_delivered_at: new Date().toISOString() });
    },
  };
}

/**
 * Classificazione stabile e priva di dettagli infrastrutturali per gli errori
 * di trasporto. Il valore può finire in `team_state.last_error`: non deve mai
 * contenere URL, hostname, token o il body restituito dal server.
 */
export function cloudRequestFailure(error) {
  const name = String(error?.name || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();
  if (name.includes('timeout') || name === 'aborterror' || code === 'etimedout') return 'timeout';
  return 'request_failed';
}

/**
 * Stessa forma, sul token del box via Vercel. Ack e chiusura del rendezvous
 * viaggiano in UNA sola POST: sono la stessa decisione ("ho consegnato"), e
 * separarle lascerebbe la finestra in cui i turni risultano consegnati ma il
 * rendezvous ancora aperto — cioè il giro dopo rilegge una coda vuota.
 */
export function vercelChatChannel(
  config,
  { fetchFn = fetch, timeoutMs = CLOUD_REQUEST_TIMEOUT_MS } = {},
) {
  const requestTimeoutMs = Math.max(1_000, Number(timeoutMs) || CLOUD_REQUEST_TIMEOUT_MS);
  const baseUrl = String(config?.base_url || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const url = `${baseUrl}/api/cloud-sync/chat`;
  const headers = {
    Authorization: `Bearer ${config?.token}`,
    'Content-Type': 'application/json',
  };
  return {
    kind: 'vercel',
    async readUndeliveredUserChat({ limit = 50 } = {}) {
      const res = await fetchFn(`${url}?limit=${encodeURIComponent(limit)}`, {
        headers,
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (!res.ok) throw new Error(`GET /api/cloud-sync/chat: HTTP ${res.status}`);
      const body = await res.json().catch(() => null);
      return Array.isArray(body?.messages) ? body.messages : [];
    },
    async closeRendezvous(ids = []) {
      const res = await fetchFn(url, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(requestTimeoutMs),
        body: JSON.stringify({ delivered_ids: ids }),
      });
      if (!res.ok) throw new Error(`POST /api/cloud-sync/chat: HTTP ${res.status}`);
    },
  };
}

/**
 * Il canale da usare per questo box: diretto se c'è, altrimenti Vercel.
 * `null` solo per un box senza token — cioè non appaiato, dove non c'è
 * nessun cloud da cui ritirare niente.
 */
export function chatChannelFor(config, reader, options = {}) {
  if (reader) return directChatChannel(reader);
  if (!config?.token) return null;
  return vercelChatChannel(config, options);
}

// ── Passo 4: cloud → pane tmux dell'agente ──────────────────────────────

/**
 * Consegna un turno dell'utente al pane, esattamente come fa il gioco.
 * Il testo NON attraversa mai una shell: `spawn` con argv, nessun quoting.
 *
 * exit 4 = TUI occupata oltre il budget (agente VIVO su un turno lungo):
 * si lascia la riga non consegnata e si ritenta al giro dopo — mai
 * scartare un messaggio dell'utente.
 */
export function sendToPane(agent, text, { spawnFn = spawn, timeoutMs = DELIVER_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const child = spawnFn('jht-tmux-send', [tmuxSessionFor(agent), chatEnvelope(agent, text)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, JHT_TMUX_SEND_FROM: 'user-chat' },
    });
    let stderr = '';
    let settled = false;
    const done = (code, err) => {
      if (settled) return;
      settled = true;
      resolve({ ok: code === 0, code, error: err || stderr.trim().slice(0, 300) });
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* già morto */ }
      done(-1, `timeout dopo ${timeoutMs}ms`);
    }, timeoutMs);
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => { clearTimeout(timer); done(-1, err.message); });
    child.on('close', (code) => { clearTimeout(timer); done(code); });
  });
}


/**
 * `ts` deterministico di un turno nato sul cloud. Il web usa
 * `legacy_id = -epoch_ms` (mig 060): l'istante di invio è già lì dentro, e
 * ricavarlo da lì rende il valore stabile fra i tentativi — requisito della
 * dedup, che è per `chat_ts`. `created_at` è il fallback per righe scritte a
 * mano o da client futuri.
 */
export function chatTsOf(row) {
  const legacy = Number(row?.legacy_id);
  if (Number.isFinite(legacy) && legacy < 0) return Math.abs(legacy) / 1000;
  const created = Date.parse(row?.created_at ?? '');
  return Number.isFinite(created) ? created / 1000 : Date.now() / 1000;
}

/**
 * Turni dell'utente arrivati dal cloud → SQLite. NON consegna: si limita a
 * far entrare il turno nella conversazione locale. Da lì lo prendono in
 * carico gli stessi due passi che servono i turni scritti in locale — il
 * mirror verso `chat.jsonl` e la consegna al pane — così esiste UNA sola
 * strada di consegna, non due da tenere allineate.
 *
 * `cloud_synced_at` nasce già valorizzato: la riga sul cloud ESISTE (è
 * quella nativa a legacy_id negativo) e ripusharla creerebbe un doppione
 * con un legacy_id diverso.
 *
 * @returns id delle righe CLOUD importate (anche quelle già presenti: sono
 *          da marcare consegnate comunque, o resterebbero in coda per sempre)
 */
export function importCloudUserTurns(db, rows, { jhtHome, agents = CHAT_AGENTS } = {}) {
  const insert = db.prepare(
    `INSERT INTO pending_user_messages
       (agent, body, kind, author, chat_ts, delivered_via, cloud_synced_at, created_at)
     VALUES (?, ?, 'notification', 'user', ?, 'web', CURRENT_TIMESTAMP, ?)`
  );
  const already = db.prepare(
    'SELECT 1 AS hit FROM pending_user_messages WHERE agent = ? AND chat_ts = ? LIMIT 1'
  );

  const imported = [];
  for (const row of rows) {
    const agent = String(row.agent || '').toLowerCase();
    const body = typeof row.body === 'string' ? row.body : '';
    if (!body.trim()) continue;
    // Fuori dalle tre figure con cui si chatta dal web: non c'è un pane a
    // cui consegnarlo. Si marca comunque, altrimenti resta in coda a vita.
    if (!agents.includes(agent)) {
      imported.push(row.id);
      continue;
    }
    const ts = chatTsOf(row);
    if (already.get(agent, ts)?.hit !== 1) {
      const at = new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19);
      insert.run(agent, body, ts, at);
      // …e SUBITO nel file che legge il gioco. Non può farlo il mirror
      // (passo 3): quello lavora sulle righe con `chat_ts` NULL, e qui il
      // valore è già impostato perché è la chiave di dedup dell'import.
      // Senza questa riga il messaggio scritto dal web arriverebbe
      // all'agente ma resterebbe invisibile nella chat del videogioco —
      // cioè le due storie tornerebbero a divergere proprio nel caso che
      // questo lavoro doveva chiudere.
      if (jhtHome) {
        const path = chatFileFor(jhtHome, agent);
        try {
          mkdirSync(dirname(path), { recursive: true });
          appendFileSync(path, jsonlLine({ role: 'user', text: body, ts }), 'utf-8');
        } catch {
          // File non scrivibile: il turno resta comunque in SQLite e viene
          // consegnato al pane. La chat del gioco lo rivedrà al redeploy.
        }
      }
    }
    imported.push(row.id);
  }
  return imported;
}

// ── Passo 4: turni dell'utente → pane tmux dell'agente ──────────────────

/**
 * Consegna al pane i turni dell'utente non ancora consegnati, da qualunque
 * parte siano arrivati (web via cloud, o desktop in locale). È il passo che
 * chiude il buco vero: fino a qui il messaggio dell'utente restava nella
 * SQLite finché l'agente non si ricordava di chiamare
 * `jht-check-user-replies` di sua iniziativa — per ore, o mai.
 *
 * `delivered_at` si timbra SOLO a consegna riuscita: `jht-tmux-send` che
 * torna 4 (TUI occupata oltre il budget) vuol dire agente VIVO su un turno
 * lungo, e il messaggio si ritenta. Un messaggio dell'utente non si scarta.
 *
 * @returns {{delivered:number, failed:number}}
 */
export async function deliverPendingUserTurns(
  db,
  { agents = CHAT_AGENTS, sendFn = sendToPane, log = () => {}, max = MAX_DELIVER_PER_TICK } = {},
) {
  const placeholders = agents.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT id, agent, body
         FROM pending_user_messages
        WHERE author = 'user' AND delivered_at IS NULL AND agent IN (${placeholders})
        ORDER BY id ASC
        LIMIT ?`
    )
    .all(...agents, max);
  if (rows.length === 0) return { delivered: 0, failed: 0 };

  const stamp = db.prepare(
    'UPDATE pending_user_messages SET delivered_at = CURRENT_TIMESTAMP WHERE id = ?'
  );
  let delivered = 0;
  let failed = 0;

  for (const row of rows) {
    const res = await sendFn(row.agent, row.body);
    if (!res.ok) {
      failed += 1;
      log(
        'warn',
        `chat: consegna a ${tmuxSessionFor(row.agent)} fallita (exit ${res.code}): ${res.error} — ritento al prossimo giro`,
      );
      // Un pane morto blocca solo la SUA coda: gli altri agenti proseguono.
      continue;
    }
    stamp.run(row.id);
    delivered += 1;
  }

  return { delivered, failed };
}

// ── Passo 6: la corsia sa dire quando NON funziona ──────────────────────
//
// Il 24/07 tre turni scritti dal web sono rimasti in coda sei ore e il
// daemon non ha detto NULLA: zero righe di log, zero errori, un box che da
// fuori sembrava sano. Un guasto muto è peggio di uno rumoroso, perché non
// si distingue da "sta ancora pensando" — l'utente vedeva le sue bolle
// inviate e aspettava una risposta che non poteva arrivare.
//
// Queste funzioni non riparano niente: fanno EMERGERE lo stato. Sono pure
// (o quasi: una sola SELECT) proprio perché il percorso che le usa gira
// ogni pochi secondi e va potuto testare senza un box.

/** Timestamp SQLite (`YYYY-MM-DD HH:MM:SS`, UTC senza suffisso) → epoch ms. */
export function parseStamp(value) {
  if (!value) return NaN;
  const s = String(value);
  if (s.includes('T') || s.endsWith('Z') || /[+-]\d\d:\d\d$/.test(s)) return Date.parse(s);
  return Date.parse(`${s.replace(' ', 'T')}Z`);
}

/** Attesa leggibile a colpo d'occhio in un log: `6h 12m`, `3m`, `45s`. */
export function formatWaited(ms) {
  const sec = Math.max(0, Math.floor(Number(ms) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m`;
}

/**
 * Quanti turni dell'utente aspettano ancora il pane, e da quando. È la
 * coda che il daemon deve saper guardare in faccia: `delivered_at` NULL
 * significa "l'agente non l'ha mai visto", per qualunque ragione.
 */
export function undeliveredUserTurns(db, { agents = CHAT_AGENTS } = {}) {
  const placeholders = agents.map(() => '?').join(', ');
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n, MIN(created_at) AS oldest
         FROM pending_user_messages
        WHERE author = 'user' AND delivered_at IS NULL AND agent IN (${placeholders})`
    )
    .get(...agents);
  return { count: Number(row?.n || 0), oldest: row?.oldest ?? null };
}

/**
 * Diagnosi della corsia: `null` se sta lavorando, altrimenti il guasto.
 *
 * Tre modi di essere muti, in ordine di gravità:
 *   · `no-inbound-channel` — il campanello del web suona (`chat_requested_at`
 *     più recente di `chat_delivered_at`) e il box non ha proprio il canale
 *     per andare a prendersi i turni. Nessuna grazia: aspettare non lo fa
 *     comparire, e finché manca NESSUN messaggio dal web arriverà mai;
 *   · `inbound-read-failed` — il canale c'è ma la lettura è fallita;
 *   · `delivery-stuck` — i turni sono entrati in SQLite e nessuno li porta
 *     al pane da più di `graceMs` (pane morto, sessione tmux sbagliata,
 *     agente fermo).
 *
 * `summary` è STABILE a parità di guasto — ci finisce dentro
 * `team_state.last_error`, e il trigger di audit (mig 019) scrive una riga
 * di storia a ogni valore diverso: la durata, che cambia sempre, sta solo
 * nel log.
 */
export function diagnoseChatLane({
  pending = false,
  requestedAt = null,
  canRead = true,
  readError = null,
  queued = 0,
  oldestQueuedAt = null,
  deliverFailed = 0,
  now = Date.now(),
  graceMs = STALL_AFTER_MS,
} = {}) {
  const waitedSince = (value) => {
    const ms = parseStamp(value);
    return Number.isFinite(ms) ? Math.max(0, now - ms) : 0;
  };
  // La stessa frase in coda a ogni segnalazione: dice PERCHÉ importa, che
  // è l'informazione che mancava a chi guardava i log del 24/07.
  const tail = "l'utente vede il messaggio come inviato e aspetta una risposta che non può arrivare";

  if (pending && !canRead) {
    const waitingMs = waitedSince(requestedAt);
    return {
      reason: 'no-inbound-channel',
      count: 0,
      waitingMs,
      summary: 'chat: turni scritti dal web non ritirabili (nessun canale di lettura verso il cloud)',
      message:
        `chat: il web ha turni in attesa da ${formatWaited(waitingMs)} e questo box non ha modo di ritirarli ` +
        `(nessun canale di lettura verso il cloud) — ${tail}`,
    };
  }

  if (pending && readError) {
    const waitingMs = waitedSince(requestedAt);
    return {
      reason: 'inbound-read-failed',
      count: 0,
      waitingMs,
      summary: `chat: lettura dei turni dal cloud fallita (${String(readError).slice(0, 160)})`,
      message:
        `chat: lettura dei turni dal cloud fallita (${String(readError).slice(0, 160)}), ` +
        `in attesa da ${formatWaited(waitingMs)} — ${tail}`,
    };
  }

  if (queued > 0) {
    const waitingMs = waitedSince(oldestQueuedAt);
    if (waitingMs >= graceMs) {
      const why = deliverFailed > 0
        ? `${deliverFailed} consegne al pane fallite in questo giro`
        : 'nessuna consegna riuscita';
      return {
        reason: 'delivery-stuck',
        count: queued,
        waitingMs,
        summary: `chat: ${queued} turni dell'utente non consegnati all'agente`,
        message:
          `chat: ${queued} turni dell'utente fermi da ${formatWaited(waitingMs)} senza arrivare al pane ` +
          `(${why}) — ${tail}`,
      };
    }
  }

  return null;
}

/**
 * Un guasto va detto, ma detto una volta ogni tanto.
 *
 * Il daemon passa di qui ogni pochi secondi: ripetere la stessa riga a
 * ogni giro riempirebbe i log di migliaia di copie identiche, cioè
 * costruirebbe un rumore che nessuno legge — di nuovo un guasto
 * invisibile, per la via opposta. Si parla al CAMBIO di stato (guasto
 * nuovo o diverso) e poi a intervalli.
 *
 * @param {{summary:string, at:number}|null} prev ultima segnalazione emessa
 */
export function shouldAnnounceStall(prev, summary, { now = Date.now(), everyMs = STALL_REPEAT_MS } = {}) {
  if (!summary) return false;
  if (!prev || prev.summary !== summary) return true;
  return now - Number(prev.at || 0) >= everyMs;
}
