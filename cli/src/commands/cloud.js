import { readFile, writeFile, mkdir, chmod, unlink, stat } from 'node:fs/promises';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pc from 'picocolors';
import { JHT_HOME, JHT_DB_PATH } from '../jht-paths.js';

const CLOUD_FILE = join(JHT_HOME, 'cloud.json');
const PAIRING_TOKEN_FILE = join(JHT_HOME, '.pairing-token');
const PROFILE_DIR = join(JHT_HOME, 'profile');
const PROFILE_YAML_PATH = join(PROFILE_DIR, 'candidate_profile.yml');
const PROFILE_SUMMARIES_DIR = join(PROFILE_DIR, 'summaries');
const WEEKLY_HALT_FLAG = join(JHT_HOME, '.weekly-halt.flag');
// Cursor delta-sync: per ogni tabella memorizziamo l'ultimo updated_at
// pushato. Al tick successivo selezioniamo solo righe con updated_at >
// cursor. Crollo bandwidth ~95% (vedi docs/internal/2026-05-22-vercel-quota-exhaustion.md).
const CLOUD_CURSOR_FILE = join(JHT_HOME, '.cloud-sync-cursor.json');
const DEFAULT_BASE_URL = 'https://jobhunterteam.ai';

/**
 * Legge il candidate_profile.yml come stringa raw. Lato cloud
 * /api/cloud-sync/push lo parsa con js-yaml e fa upsert su
 * candidate_profiles. Limitiamo a 64 KB: un profilo realistico sta
 * ben sotto, file piu' grandi sono probabilmente garbage/binari.
 */
function readProfilePayload() {
  if (!existsSync(PROFILE_YAML_PATH)) return null;
  let yamlRaw;
  try {
    yamlRaw = readFileSync(PROFILE_YAML_PATH, 'utf-8');
  } catch { return null; }
  if (!yamlRaw || yamlRaw.length > 64 * 1024) return null;

  // Summaries: 4 markdown discorsivi (about, preferences, goals, strengths).
  // Li passiamo come oggetto { name: content } per upsert su tabella
  // future-friendly. Limite 32 KB/file.
  const summaries = {};
  if (existsSync(PROFILE_SUMMARIES_DIR)) {
    try {
      for (const file of readdirSync(PROFILE_SUMMARIES_DIR)) {
        if (!file.endsWith('.md')) continue;
        const full = join(PROFILE_SUMMARIES_DIR, file);
        const content = readFileSync(full, 'utf-8');
        if (content.length <= 32 * 1024) {
          summaries[file.replace(/\.md$/, '')] = content;
        }
      }
    } catch { /* directory unreadable, skip */ }
  }

  return { yaml: yamlRaw, summaries };
}

async function loadCloudConfig() {
  try {
    const raw = await readFile(CLOUD_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveCloudConfig(config) {
  await mkdir(JHT_HOME, { recursive: true });
  await writeFile(CLOUD_FILE, JSON.stringify(config, null, 2) + '\n');
  await chmod(CLOUD_FILE, 0o600);
}

function parseToken(raw) {
  const token = (raw ?? '').trim();
  if (!token.startsWith('jht_sync_')) return null;
  if (token.length < 20) return null;
  return token;
}

async function handleEnable(options) {
  const token = parseToken(options.token);
  if (!token) {
    console.error(pc.red('Token mancante o malformato.'));
    console.error('Uso: ' + pc.bold('jht cloud enable --token jht_sync_xxxxxxxx'));
    console.error(pc.dim('Genera un token su https://jobhunterteam.ai/settings/cloud-sync'));
    process.exitCode = 1;
    return;
  }

  const baseUrl = (options.url || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const pingUrl = `${baseUrl}/api/cloud-sync/ping`;

  console.log(pc.dim(`Verifica token su ${pingUrl}…`));

  let res;
  try {
    res = await fetch(pingUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    console.error(pc.red(`Errore di rete: ${err.message}`));
    process.exitCode = 1;
    return;
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(
      pc.red(`Verifica fallita (HTTP ${res.status}): ${body.error || 'errore sconosciuto'}`)
    );
    process.exitCode = 1;
    return;
  }

  await saveCloudConfig({
    enabled: true,
    base_url: baseUrl,
    token,
    user_id: body.user_id,
    token_name: body.token?.name ?? null,
    enabled_at: new Date().toISOString(),
  });

  console.log(pc.green('✓ Cloud sync abilitato'));
  console.log(pc.dim(`  Base URL:   ${baseUrl}`));
  console.log(pc.dim(`  Token name: ${body.token?.name ?? 'unnamed'}`));
  console.log(pc.dim(`  User ID:    ${body.user_id}`));
  console.log(pc.dim(`  File:       ${CLOUD_FILE} (0600)`));

  // Auto-push: l'utente ha appena collegato il VPS, vuole vedere i dati sul
  // dashboard subito — non ha senso forzarlo a un secondo comando.
  if (options.noPush) {
    console.log(pc.dim(`  Push iniziale skippato (--no-push). Esegui: jht cloud push`));
    return;
  }
  // Se il DB non esiste ancora (team mai avviato): skip silenzioso. Il
  // pairing e' completo, non e' un errore. L'utente puo' fare push dopo
  // il primo `jht team start`.
  try {
    await stat(JHT_DB_PATH);
  } catch {
    console.log(pc.dim(`  Nessun DB locale ancora (${JHT_DB_PATH}). Push skippato.`));
    console.log(pc.dim(`  Avvia il team con 'jht team start' e poi 'jht cloud push'.`));
    return;
  }
  console.log('');
  console.log(pc.dim('Sincronizzo i dati locali al cloud...'));
  // process.exitCode di handlePush e' best-effort: se push fallisce, l'enable
  // resta valido (token salvato) ma stampiamo l'errore. L'utente puo' riprovare.
  const prevExitCode = process.exitCode;
  await handlePush({});
  if (process.exitCode === 1) {
    console.log(pc.yellow('  Enable e\' OK ma push iniziale e\' fallito. Riprova: jht cloud push'));
    process.exitCode = prevExitCode;
  }
}

/**
 * Post-pairing check: chiama GET /api/team-state con il token appena ottenuto
 * e verifica se esiste già un device active per quell'utente.
 *
 * Ritorna:
 *   { conflict: false }                              — libero, OK
 *   { conflict: true, active_device_id, age_seconds } — qualcun altro tiene il claim
 *
 * Errori HTTP/rete sono silenziosi (warn ma non blocca): meglio finire il
 * pairing senza preflight che rompere la UX se Vercel ha hiccup.
 *
 * Nota: usiamo il token stesso come Bearer (PATCH-friendly authn). Per ora il
 * server include il proprio token_id come default device_id implicito; quindi
 * confrontiamo active_device_id vs il prefix del token salvato. È informativo:
 * il vero enforcement avviene al claim del reconciler.
 */
async function checkActiveDeviceConflict(baseUrl, token) {
  try {
    const res = await fetch(`${baseUrl}/api/team-state`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { conflict: false };
    const body = await res.json().catch(() => ({}));
    const state = body.state;
    if (!state || !state.active_device_id) return { conflict: false };
    // Heartbeat fresco? Allineato con HEARTBEAT_STALE_MS del server (5min).
    const hbAt = state.last_heartbeat_at ? Date.parse(state.last_heartbeat_at) : 0;
    const age = Date.now() - hbAt;
    if (age >= 5 * 60 * 1000) return { conflict: false }; // stale → libero
    return {
      conflict: true,
      active_device_id: state.active_device_id,
      claimed_at: state.active_device_claimed_at,
      age_seconds: Math.floor(age / 1000),
    };
  } catch {
    return { conflict: false };
  }
}

async function handleLogin(options) {
  const baseUrl = (options.url || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const initUrl = `${baseUrl}/api/cloud-sync/device-init`;

  // 1. Init: chiede al server una coppia (device_code, user_code).
  console.log(pc.dim(`Inizio pairing su ${baseUrl}…`));
  let init;
  try {
    const res = await fetch(initUrl, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(
        pc.red(`Init pairing fallito (HTTP ${res.status}): ${body.error || 'errore sconosciuto'}`)
      );
      process.exitCode = 1;
      return;
    }
    init = body;
  } catch (err) {
    console.error(pc.red(`Errore di rete: ${err.message}`));
    process.exitCode = 1;
    return;
  }

  if (!init.device_code || !init.user_code || !init.verification_url) {
    console.error(pc.red('Risposta server malformata (manca device_code/user_code/verification_url).'));
    process.exitCode = 1;
    return;
  }

  // 2. Mostra istruzioni all'utente.
  const tokenNameHint = options.name ? ` (nome consigliato: "${options.name}")` : '';
  console.log('');
  console.log(pc.bold(`Apri questo URL nel browser:`));
  console.log(`  ${pc.cyan(init.verification_url)}`);
  if (init.verification_url_complete) {
    console.log(pc.dim(`  (link diretto col codice precompilato: ${init.verification_url_complete})`));
  }
  console.log('');
  console.log(pc.bold(`Codice da digitare:`));
  console.log(`  ${pc.green(pc.bold(init.user_code))}${tokenNameHint}`);
  console.log('');
  console.log(pc.dim(`Aspetto la tua conferma… (TTL ~${Math.round((init.expires_in ?? 600) / 60)} min, polling ogni ${init.interval ?? 2}s)`));
  console.log(pc.dim(`Premi Ctrl+C per annullare.`));

  // 3. Poll fino a status = approved | expired | timeout.
  const pollUrl = `${baseUrl}/api/cloud-sync/device-poll`;
  const intervalMs = Math.max(1, init.interval ?? 2) * 1000;
  const expiresAtMs = Date.now() + (init.expires_in ?? 600) * 1000;
  let approved = null;

  while (Date.now() < expiresAtMs) {
    await new Promise((r) => setTimeout(r, intervalMs));
    let res;
    try {
      res = await fetch(pollUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_code: init.device_code }),
      });
    } catch (err) {
      // Tolerante a network blip transitorio: continua il poll.
      console.error(pc.yellow(`  ⚠ poll error transitorio: ${err.message}, ritento...`));
      continue;
    }
    const body = await res.json().catch(() => ({}));

    if (res.status === 202 && body.status === 'pending') continue;
    if (res.status === 410) {
      console.error(pc.red(`\nSessione ${body.status || 'expired'}. Riavvia 'jht cloud login'.`));
      process.exitCode = 1;
      return;
    }
    if (res.status === 404) {
      console.error(pc.red(`\nSessione non trovata sul server. Riavvia 'jht cloud login'.`));
      process.exitCode = 1;
      return;
    }
    if (!res.ok) {
      console.error(pc.red(`\nPoll error (HTTP ${res.status}): ${body.error || 'errore sconosciuto'}`));
      process.exitCode = 1;
      return;
    }
    if (body.status === 'approved' && body.token) {
      approved = body;
      break;
    }
    // Status sconosciuto: log e continua, conservativo.
    console.error(pc.yellow(`  ⚠ poll status inatteso: ${body.status || 'undefined'}, continuo...`));
  }

  if (!approved) {
    console.error(pc.red(`\nTimeout pairing (${Math.round((init.expires_in ?? 600) / 60)} min). Riavvia 'jht cloud login'.`));
    process.exitCode = 1;
    return;
  }

  // 4. Salva config + auto-push.
  await saveCloudConfig({
    enabled: true,
    base_url: baseUrl,
    token: approved.token,
    user_id: approved.user_id,
    token_name: approved.token_name ?? null,
    enabled_at: new Date().toISOString(),
  });

  console.log('');
  console.log(pc.green(`✓ Pairing completato`));
  console.log(pc.dim(`  Base URL:   ${baseUrl}`));
  console.log(pc.dim(`  Token name: ${approved.token_name ?? 'unnamed'}`));
  console.log(pc.dim(`  User ID:    ${approved.user_id}`));
  console.log(pc.dim(`  File:       ${CLOUD_FILE} (0600)`));

  // Single-team preflight: se un altro device ha già il claim (heartbeat
  // < 5min), warn l'utente. Non blocca il login: l'utente potrebbe volere
  // forzare l'eviction. Vedi vps.md:392 "un solo team JHT per utente".
  const conflict = await checkActiveDeviceConflict(baseUrl, approved.token);
  if (conflict.conflict) {
    console.log('');
    console.log(
      pc.yellow(
        `⚠ Un altro device tiene il claim del team (heartbeat ${conflict.age_seconds}s fa).`
      )
    );
    console.log(
      pc.dim(
        `  active_device_id: ${conflict.active_device_id?.slice(0, 12)}…` +
        ` — claimed_at: ${conflict.claimed_at ?? 'unknown'}`
      )
    );
    console.log(
      pc.dim(
        `  Se avvii il team qui, il vecchio device verrà evicted (con notifica). ` +
        `Per testare in parallelo senza conflitti, spegni l'altro container prima.`
      )
    );
  }

  if (options.noPush) {
    console.log('');
    console.log(pc.dim(`Push iniziale skippato (--no-push). Esegui: jht cloud push`));
    return;
  }
  try {
    await stat(JHT_DB_PATH);
  } catch {
    console.log('');
    console.log(pc.dim(`Nessun DB locale ancora (${JHT_DB_PATH}). Push skippato.`));
    console.log(pc.dim(`Avvia il team con 'jht team start' e poi 'jht cloud push'.`));
    return;
  }
  console.log('');
  console.log(pc.dim('Sincronizzo i dati locali al cloud...'));
  const prevExitCode = process.exitCode;
  await handlePush({});
  if (process.exitCode === 1) {
    console.log(pc.yellow(`  Pairing OK ma push iniziale fallito. Riprova: jht cloud push`));
    process.exitCode = prevExitCode;
  }
}

async function handleStatus() {
  const config = await loadCloudConfig();
  if (!config || !config.enabled) {
    console.log(pc.dim('Cloud sync: ') + pc.yellow('disabilitato'));
    console.log(pc.dim('Abilita con: ') + pc.bold('jht cloud enable --token jht_sync_xxx'));
    return;
  }
  console.log(pc.dim('Cloud sync: ') + pc.green('abilitato'));
  console.log(pc.dim('Base URL:   ') + config.base_url);
  console.log(pc.dim('Token name: ') + (config.token_name ?? 'unnamed'));
  console.log(pc.dim('User ID:    ') + config.user_id);
  console.log(pc.dim('Enabled at: ') + config.enabled_at);
}

function readSqliteTable(db, table, columns) {
  try {
    return db.prepare(`SELECT ${columns.join(', ')} FROM ${table}`).all();
  } catch (err) {
    if (/no such table/i.test(err.message)) return [];
    throw err;
  }
}

/**
 * Legge una tabella SQLite filtrando per updated_at > cursor.
 * Se cursor e' null/undefined ritorna tutte le righe (first push o cursor
 * cancellato). Include updated_at nelle colonne selezionate (serve per
 * calcolare il nuovo cursor lato chiamante).
 *
 * Robust: se la tabella non esiste o non ha la colonna updated_at,
 * ricade su full SELECT (compatibile con schema vecchi / tabelle senza
 * timestamp di mutazione).
 */
function readSqliteTableDelta(db, table, columns, cursor) {
  const cols = columns.includes('updated_at') ? columns : [...columns, 'updated_at'];
  try {
    if (cursor) {
      return db.prepare(
        `SELECT ${cols.join(', ')} FROM ${table} WHERE updated_at > ?`
      ).all(cursor);
    }
    return db.prepare(`SELECT ${cols.join(', ')} FROM ${table}`).all();
  } catch (err) {
    if (/no such table/i.test(err.message)) return [];
    if (/no such column/i.test(err.message)) {
      // schema legacy senza updated_at: fallback a full read
      return readSqliteTable(db, table, columns);
    }
    throw err;
  }
}

/**
 * Carica il cursor di sync. Ritorna oggetto { positions, scores,
 * applications } dove ogni valore e' l'ISO string dell'ultimo updated_at
 * pushato per quella tabella. Missing keys = first push (legge tutto).
 */
function loadCloudCursor() {
  if (!existsSync(CLOUD_CURSOR_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CLOUD_CURSOR_FILE, 'utf-8'));
  } catch {
    // corrotto: meglio ripartire da zero (full push) che fallire
    return {};
  }
}

/**
 * Salva il cursor di sync. Scritto solo dopo push API HTTP 200. Su
 * errore di scrittura logghiamo ma non blocchiamo il daemon: al prossimo
 * tick verra' rifatto il delta (al massimo ri-pusha righe gia' upsertate,
 * idempotente lato server).
 */
async function saveCloudCursor(cursor) {
  try {
    await writeFile(CLOUD_CURSOR_FILE, JSON.stringify(cursor, null, 2));
  } catch (err) {
    console.error(pc.yellow(`  warn: cursor save failed (${err.message})`));
  }
}

/**
 * Dato un array di righe con campo updated_at, ritorna il MAX(updated_at)
 * come stringa ISO. Null se l'array e' vuoto o nessuna riga ha il campo.
 */
function maxUpdatedAt(rows) {
  let max = null;
  for (const r of rows) {
    const u = r?.updated_at;
    if (u && (max === null || u > max)) max = u;
  }
  return max;
}

async function handlePush(options) {
  const config = await loadCloudConfig();
  if (!config || !config.enabled) {
    console.error(pc.red('Cloud sync non abilitato.'));
    console.error(pc.dim('Abilita con: ') + pc.bold('jht cloud enable --token jht_sync_xxx'));
    process.exitCode = 1;
    return;
  }

  // Profile YAML: e' indipendente dal DB (esiste appena l'Assistente
  // raccoglie il primo dato dall'utente). Lo leggiamo SEMPRE, anche se
  // jobs.db non esiste ancora: senza questo la dashboard cloud resta
  // vuota fino al primo job trovato dallo Scout, deludendo l'utente che
  // si aspetta di vedere il proprio profilo subito dopo l'onboarding.
  const profilePayload = readProfilePayload();

  const dbPath = options.db || JHT_DB_PATH;
  const dbExists = await stat(dbPath).then(() => true).catch(() => false);
  if (!dbExists && !profilePayload) {
    console.error(pc.red(`Database non trovato: ${dbPath}`));
    console.error(pc.dim('Avvia il team almeno una volta o passa --db <path>'));
    process.exitCode = 1;
    return;
  }

  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    console.error(pc.red('node:sqlite non disponibile (richiede Node 22.5+).'));
    process.exitCode = 1;
    return;
  }

  let positions = [];
  let scores = [];
  let applications = [];
  let pendingMessages = [];
  // Cursor delta-sync: ad ogni tick leggiamo solo righe con updated_at >
  // ultimo pushato per quella tabella. Prima volta (cursor vuoto): full
  // read. Dopo push HTTP 200: aggiorniamo cursor con MAX(updated_at)
  // delle righe pushate.
  const cursor = options.full ? {} : loadCloudCursor();
  if (dbExists) {
    try {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      positions = readSqliteTableDelta(db, 'positions', [
        'id', 'title', 'company', 'url', 'location', 'remote_type', 'status',
        'notes', 'source', 'jd_text', 'requirements', 'found_by', 'found_at',
        'deadline', 'last_checked',
        'salary_declared_min', 'salary_declared_max', 'salary_declared_currency',
        'salary_estimated_min', 'salary_estimated_max', 'salary_estimated_currency',
        'salary_estimated_source',
      ], cursor.positions);
      scores = readSqliteTableDelta(db, 'scores', [
        'position_id', 'total_score', 'experience_fit', 'salary_fit',
        'stack_match', 'remote_fit', 'strategic_fit', 'breakdown', 'notes',
        'scored_by', 'scored_at',
      ], cursor.scores);
      applications = readSqliteTableDelta(db, 'applications', [
        'position_id', 'cv_path', 'cv_pdf_path', 'cl_path', 'cl_pdf_path',
        'status', 'critic_score', 'critic_verdict', 'critic_notes',
        'written_at', 'applied_at', 'applied_via', 'response', 'response_at',
        'written_by', 'reviewed_by', 'critic_reviewed_at', 'applied',
        'cv_drive_id', 'cl_drive_id',
      ], cursor.applications);
      // pending_user_messages e' la coda agente -> utente. Pushiamo TUTTE le
      // righe ad ogni tick: l'upsert lato server e' idempotente su
      // (user_id, legacy_id), e gli ack-time / reply-time vanno comunque
      // sincronizzati a ritroso (web -> local) — vedi /api/cloud-sync/pull
      // (futuro). Per ora il push e' write-only locale -> cloud.
      // NB: questa tabella non ha colonna updated_at, e' append + flag
      // updates. Lasciamo full-push, il volume e' piccolo.
      pendingMessages = readSqliteTable(db, 'pending_user_messages', [
        'id', 'agent', 'body', 'kind', 'related_position_id',
        'delivered_via', 'delivered_at', 'acknowledged_at',
        'user_reply', 'user_reply_at', 'agent_seen_reply_at',
        'created_at',
      ]);
      db.close();
    } catch (err) {
      console.error(pc.red(`Errore lettura SQLite: ${err.message}`));
      process.exitCode = 1;
      return;
    }
  }

  const profileChunks = profilePayload
    ? `, profile (${profilePayload.yaml.length}B yaml + ${Object.keys(profilePayload.summaries).length} summaries)`
    : '';
  const pendingChunks = pendingMessages.length > 0
    ? `, ${pendingMessages.length} pending messages`
    : '';
  const isFirstPush = !cursor.positions && !cursor.scores && !cursor.applications;
  const deltaMode = isFirstPush ? 'first-push (full)' : 'delta';
  console.log(
    pc.dim(
      `Payload [${deltaMode}]: ${positions.length} positions, ${scores.length} scores, ${applications.length} applications${pendingChunks}${profileChunks}`
    )
  );
  if (options.dryRun) {
    console.log(pc.yellow('--dry-run: nulla viene pushato.'));
    return;
  }
  if (
    positions.length === 0 && scores.length === 0 &&
    applications.length === 0 && pendingMessages.length === 0 &&
    !profilePayload
  ) {
    console.log(pc.yellow('Nessun dato da sincronizzare.'));
    return;
  }

  const pushUrl = `${config.base_url}/api/cloud-sync/push`;
  let res;
  try {
    res = await fetch(pushUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        positions, scores, applications,
        pending_user_messages: pendingMessages,
        ...(profilePayload ? { profile: profilePayload } : {}),
      }),
    });
  } catch (err) {
    console.error(pc.red(`Errore di rete: ${err.message}`));
    process.exitCode = 1;
    return;
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 409 not_active_device → un altro device ha fatto claim del team.
    // Questo push viene rifiutato deliberatamente (single-team enforcement,
    // vedi mig 019/023 + docs/internal/vps.md:392). Il daemon entra in
    // consecutive-fails countdown (vedi handleDaemon: 3 warn / 5 shutdown),
    // così non resta in loop infinito a sbattere la testa.
    if (res.status === 409 && body.error === 'not_active_device') {
      console.error(
        pc.red(
          `Push rifiutato (HTTP 409 not_active_device): un altro device ha il claim ` +
          `(active_device_id=${body.active_device_id ?? 'unknown'}).`
        )
      );
      console.error(
        pc.dim(
          `  Per riprendere: jht cloud claim --force (TODO) oppure spegni questo container.`
        )
      );
    } else {
      console.error(
        pc.red(`Push fallito (HTTP ${res.status}): ${body.error || 'errore sconosciuto'}`)
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log(pc.green('✓ Push completato'));
  console.log(pc.dim(`  positions:        ${body.positions?.upserted ?? 0} upserted`));
  console.log(pc.dim(`  scores:           ${body.scores?.upserted ?? 0} upserted`));
  console.log(pc.dim(`  applications:     ${body.applications?.upserted ?? 0} upserted`));
  console.log(pc.dim(`  pending messages: ${body.pending_user_messages?.upserted ?? 0} upserted`));

  // Aggiorna cursor delta-sync solo dopo HTTP 200: il prossimo tick
  // selezionera' solo righe con updated_at > cursor. Se una qualsiasi
  // tabella aveva almeno una riga pushata, avanziamo il suo cursor al
  // MAX(updated_at) di quelle righe. Tabelle vuote nel tick: cursor
  // invariato (mantenendo eventuale valore precedente).
  const newCursor = { ...cursor };
  const posMax = maxUpdatedAt(positions);
  const scoMax = maxUpdatedAt(scores);
  const appMax = maxUpdatedAt(applications);
  if (posMax) newCursor.positions = posMax;
  if (scoMax) newCursor.scores = scoMax;
  if (appMax) newCursor.applications = appMax;
  // Salviamo anche se nulla e' cambiato: la prima volta crea il file e
  // disabilita la modalita' "first-push" al prossimo tick. La 2a volta
  // in poi e' no-op a livello di contenuto.
  await saveCloudCursor(newCursor);
}

/**
 * Decodifica un pairing-token base64 generato da
 * desktop/auth/index.js#getPairingToken. Formato:
 *
 *   base64(JSON({ supabase_url, user_id, refresh_token, issued_at }))
 *
 * Ritorna null su qualsiasi anomalia (illegale, JSON sporco, campi
 * mancanti). Il chiamante stampa il messaggio di errore appropriato.
 */
function decodePairingToken(raw) {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  let decoded;
  try {
    decoded = Buffer.from(trimmed, 'base64').toString('utf-8');
  } catch {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (
    !payload ||
    typeof payload.user_id !== 'string' ||
    typeof payload.refresh_token !== 'string' ||
    typeof payload.supabase_url !== 'string'
  ) {
    return null;
  }
  return payload;
}

/**
 * `jht cloud pair` — usa un pairing-token (generato dal desktop launcher
 * via `vps:run-install`) per registrarsi come device dell'utente sul cloud
 * SENZA richiedere il device-flow interattivo browser-based.
 *
 * Chi invoca: pid1 al primo boot del container su VPS, oppure manualmente
 * dall'utente per debug. Idempotente: se cloud.json esiste gia' e --force
 * non e' passato, esce no-op.
 *
 * Flow:
 *   1. Legge /jht_home/.pairing-token (salvato da install.sh
 *      --pairing-token).
 *   2. Decodifica il payload base64 → {supabase_url, user_id, refresh_token}.
 *   3. POST /api/cloud-sync/device-register sul cloud, che:
 *      - verifica il refresh_token contro Supabase auth.v1
 *      - controlla che user_id coincida con quello del refresh
 *      - genera un jht_sync_* token e lo restituisce
 *   4. Salva cloud.json (stesso shape di handleEnable) → pid1 watcher fa
 *      partire il daemon.
 *   5. Cancella .pairing-token (one-shot, non ci serve piu').
 */
async function handlePair(options) {
  const baseUrl = (options.url || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const tokenPath = options.tokenFile || PAIRING_TOKEN_FILE;

  // Idempotenza: se gia' paired e niente --force, no-op.
  const existing = await loadCloudConfig();
  if (existing?.enabled && !options.force) {
    console.log(pc.dim('Cloud sync gia\' configurato — skip pair (usa --force per re-pair).'));
    // Cancello comunque .pairing-token se ancora presente: un re-run di
    // install.sh ce l'ha lasciato e non vogliamo materiale auth orfano
    // sul filesystem.
    try { await unlink(tokenPath); } catch { /* non c'e' o gia' cancellato */ }
    return;
  }

  // Lettura del pairing-token.
  let raw;
  try {
    raw = await readFile(tokenPath, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(pc.red(`Nessun pairing-token trovato in ${tokenPath}.`));
      console.error(pc.dim('Atteso scenario: install.sh deve essere stato lanciato con --pairing-token.'));
      console.error(pc.dim('Per pairing manuale usa invece: jht cloud login'));
    } else {
      console.error(pc.red(`Errore lettura pairing-token: ${err.message}`));
    }
    process.exitCode = 1;
    return;
  }

  const payload = decodePairingToken(raw);
  if (!payload) {
    console.error(pc.red('pairing-token corrotto o malformato.'));
    console.error(pc.dim(`File: ${tokenPath}`));
    process.exitCode = 1;
    return;
  }

  const deviceName = options.name || `vps-pairing-${new Date().toISOString().slice(0, 10)}`;
  const registerUrl = `${baseUrl}/api/cloud-sync/device-register`;
  console.log(pc.dim(`Registro questo device su ${registerUrl}…`));

  let res;
  try {
    res = await fetch(registerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: payload.user_id,
        refresh_token: payload.refresh_token,
        device_name: deviceName,
      }),
    });
  } catch (err) {
    console.error(pc.red(`Errore di rete: ${err.message}`));
    process.exitCode = 1;
    return;
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(pc.red(`Pairing fallito (HTTP ${res.status}): ${body.error || 'errore sconosciuto'}`));
    // 401 = refresh_token scaduto/revocato lato Supabase. Suggerisci la
    // via di uscita: re-pair dal desktop o passare a `jht cloud login`.
    if (res.status === 401) {
      console.error(pc.dim('Il refresh_token sembra scaduto. Re-genera il pairing dal desktop launcher,'));
      console.error(pc.dim('oppure usa il pairing browser-based: ') + pc.bold('jht cloud login'));
    }
    process.exitCode = 1;
    return;
  }

  if (!body.token || !body.user_id) {
    console.error(pc.red('Risposta server malformata (manca token/user_id).'));
    process.exitCode = 1;
    return;
  }

  // Salvataggio aggiuntivo per il Realtime subscriber: il pairing token
  // contiene supabase_url + refresh_token che servono al subscriber WS
  // per autenticarsi con Supabase direttamente (auth.setSession +
  // auto-refresh dell'access_token via SDK). Senza questi, il
  // subscriber dovrebbe fare un endpoint custom roundtrip.
  await saveCloudConfig({
    enabled: true,
    base_url: baseUrl,
    token: body.token,
    user_id: body.user_id,
    token_name: body.token_name ?? deviceName,
    enabled_at: new Date().toISOString(),
    paired_via: 'desktop-pairing-token',
    supabase_url: payload.supabase_url || null,
    supabase_refresh_token: payload.refresh_token || null,
  });

  // Cancella .pairing-token (one-shot): non ci serve piu' e non vogliamo
  // lasciare un refresh_token sul disco.
  try { await unlink(tokenPath); } catch { /* best-effort */ }

  console.log(pc.green('✓ Device registrato sul cloud'));
  console.log(pc.dim(`  Base URL:   ${baseUrl}`));
  console.log(pc.dim(`  Token name: ${body.token_name ?? deviceName}`));
  console.log(pc.dim(`  User ID:    ${body.user_id}`));
  console.log(pc.dim(`  File:       ${CLOUD_FILE} (0600)`));
  console.log(pc.dim(`  Pairing-token cancellato dopo l'uso.`));

  // Single-team preflight: warn se un altro device ha già il claim active.
  const conflict = await checkActiveDeviceConflict(baseUrl, body.token);
  if (conflict.conflict) {
    console.log('');
    console.log(
      pc.yellow(
        `⚠ Un altro device tiene il claim del team (heartbeat ${conflict.age_seconds}s fa).`
      )
    );
    console.log(
      pc.dim(
        `  active_device_id: ${conflict.active_device_id?.slice(0, 12)}… ` +
        `— il reconciler attenderà la scadenza (5min) o un'eviction esplicita.`
      )
    );
  }
}

async function handleDisable() {
  const config = await loadCloudConfig();
  if (!config) {
    console.log(pc.dim('Cloud sync gia disabilitato.'));
    return;
  }
  try {
    await unlink(CLOUD_FILE);
    console.log(pc.green('✓ Cloud sync disabilitato'));
    console.log(pc.dim('  Token rimosso dalla macchina locale.'));
    console.log(
      pc.dim('  Per revocare lato server vai su ') +
        `${config.base_url || DEFAULT_BASE_URL}/settings/cloud-sync`
    );
  } catch (err) {
    console.error(pc.red(`Errore: ${err.message}`));
    process.exitCode = 1;
  }
}

/**
 * Daemon di sync: loop infinito che chiama handlePush() ogni N secondi
 * (default 30). Pensato come PID 1 del container su VPS, dove la dashboard
 * Next.js locale e' inutile (bindata a 127.0.0.1) e l'utente vuole vedere
 * i dati direttamente su jobhunterteam.ai.
 *
 * Termina su SIGTERM/SIGINT (docker stop manda SIGTERM → uscita pulita
 * entro il grace period di 10s).
 *
 * Se cloud sync non e' abilitato, esce con errore: il chiamante (pid1
 * dispatcher) si occupa di degradare gracefully a dashboard.
 */
async function handleDaemon(options) {
  // Default 60s: ogni push genera ~10 query Postgres (auth chain + RLS + UPDATE
  // cloud_sync_tokens). A 30s saturavamo il Disk IO Budget Supabase con un
  // solo VPS attivo (vedi docs/sessions/2026-05-18-supabase-disk-io-investigation).
  // 60s e' un buon compromesso tra freshness dashboard e IO consumato.
  // Priorita: --interval CLI flag > env JHT_CLOUD_PUSH_INTERVAL_SEC > default 60s.
  const explicit = options.interval ?? process.env.JHT_CLOUD_PUSH_INTERVAL_SEC ?? '60';
  const intervalSec = Math.max(5, parseInt(explicit, 10) || 60);

  const config = await loadCloudConfig();
  if (!config || !config.enabled) {
    console.error(pc.red('Cloud sync non abilitato: il daemon non puo\' girare.'));
    console.error(pc.dim('Abilita con: ') + pc.bold('jht cloud login') + pc.dim(' (pairing browser)'));
    process.exitCode = 1;
    return;
  }

  console.log(pc.dim(`Cloud sync daemon: push ogni ${intervalSec}s verso ${config.base_url}`));

  let running = true;
  const shutdown = (sig) => {
    if (!running) return;
    running = false;
    console.log(pc.dim(`\nRicevuto ${sig}, esco dal loop...`));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // HALT-WEEKLY guard: se il flag esiste, l'utente ha ordinato stop team
  // (vedi docs/internal/2026-05-21-halt-weekly-incident.md). Saltiamo il
  // push: dati locali non cambiano, e ogni tick costa ~1 MB upload + 1
  // function invocation + ~500ms-2s CPU Postgres lato Vercel/Supabase
  // (vedi docs/internal/2026-05-22-vercel-quota-exhaustion.md). Logghiamo
  // ogni 10 tick per evitare spam ma confermare che il daemon e' vivo.
  let haltSkipCount = 0;
  // Consecutive failure tracking: dopo 3 fail consecutivi alziamo un warning
  // visibile; dopo MAX_CONSECUTIVE_FAILS auto-shutdown del daemon.
  // Origin: incident RobertHalf 2026-05-19 — daemon ha retentato in loop
  // silenzioso per 1h, saturando Supabase pool fino al 504 user-facing.
  // Meglio fermarsi e chiedere intervento manuale che bruciare quota cloud
  // a vuoto (vedi docs/internal/cloud-sync-architecture.md P1 #4).
  const MAX_CONSECUTIVE_FAILS = 5;
  const WARN_AT = 3;
  let consecutiveFails = 0;
  // Push iniziale immediato: se il container era spento per un po' e gli
  // agenti hanno scritto offline, il primo tick deve flushare subito.
  while (running) {
    if (existsSync(WEEKLY_HALT_FLAG)) {
      if (haltSkipCount % 10 === 0) {
        console.log(pc.dim(`  HALT-WEEKLY attivo (${WEEKLY_HALT_FLAG}) — push saltato.`));
      }
      haltSkipCount += 1;
    } else {
      if (haltSkipCount > 0) {
        console.log(pc.green(`  HALT-WEEKLY rimosso, riprendo push normali.`));
        haltSkipCount = 0;
      }
      let tickFailed = false;
      try {
        // Reset di process.exitCode tra un tick e l'altro: handlePush lo
        // setta a 1 su errore di rete o sqlite, ma noi vogliamo continuare
        // il loop al prossimo intervallo.
        const prev = process.exitCode;
        process.exitCode = 0;
        await handlePush({});
        if (process.exitCode === 1) {
          tickFailed = true;
        }
        process.exitCode = prev;
      } catch (err) {
        console.error(pc.yellow(`  daemon tick error: ${err.message}`));
        tickFailed = true;
      }

      if (tickFailed) {
        consecutiveFails += 1;
        if (consecutiveFails === WARN_AT) {
          console.error(
            pc.yellow(
              `  ⚠ ${WARN_AT} push consecutivi falliti. ` +
              `Probabile row corrotta o saturazione Supabase. ` +
              `Verifica logs container e dashboard Supabase. ` +
              `Auto-shutdown a ${MAX_CONSECUTIVE_FAILS} fail consecutivi.`
            )
          );
        }
        if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
          console.error(
            pc.red(
              `  ✗ ${MAX_CONSECUTIVE_FAILS} push consecutivi falliti, ` +
              `auto-shutdown daemon per evitare loop saturante Supabase. ` +
              `Investiga la causa (vedi docs/internal/cloud-sync-architecture.md ` +
              `incident RobertHalf 2026-05-19) e rilancia il daemon manualmente.`
            )
          );
          running = false;
          process.exitCode = 1;
          break;
        }
      } else if (consecutiveFails > 0) {
        console.log(pc.green(`  push ok dopo ${consecutiveFails} fail, contatore resettato.`));
        consecutiveFails = 0;
      }
    }
    if (!running) break;
    // Sleep interrompibile: spezziamo in chunk da 1s cosi' SIGTERM ferma
    // entro 1s invece di aspettare l'intero intervalSec.
    for (let i = 0; i < intervalSec && running; i++) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  console.log(pc.dim('Daemon terminato.'));
}

export function registerCloudCommand(program) {
  const cloud = program
    .command('cloud')
    .description('Gestione cloud sync (opt-in): enable, status, disable');

  cloud
    .command('login')
    .description('Pairing browser-based: nessun token paste manuale (consigliato)')
    .option('--url <url>', `Base URL del cloud (default ${DEFAULT_BASE_URL})`)
    .option('--name <name>', 'Suggerimento per il nome del token sul web (es. "vps-marco")')
    .option('--no-push', 'Salta il push iniziale dei dati locali (default: push automatico)')
    .action(handleLogin);

  // `pair` — non-interattivo: legge .pairing-token (salvato da install.sh
  // dopo `desktop/vps/index.js#runInstall`) e si registra sul cloud come
  // device dell'utente. Pid1 lo invoca al primo boot del container su VPS.
  cloud
    .command('pair')
    .description('Pair non-interattivo via .pairing-token (usato da pid1 al primo boot su VPS)')
    .option('--url <url>', `Base URL del cloud (default ${DEFAULT_BASE_URL})`)
    .option('--name <name>', 'Nome del token sul web (default: vps-pairing-YYYY-MM-DD)')
    .option('--token-file <path>', `Path del pairing-token (default ${PAIRING_TOKEN_FILE})`)
    .option('--force', 'Re-pair anche se cloud.json esiste gia\'')
    .action(handlePair);

  cloud
    .command('enable')
    .description('Abilita cloud sync con un token gia\' generato dal web (manual paste)')
    .option('--token <token>', 'Token jht_sync_... (obbligatorio)')
    .option('--url <url>', `Base URL del cloud (default ${DEFAULT_BASE_URL})`)
    .option('--no-push', 'Salta il push iniziale dei dati locali (default: push automatico)')
    .action(handleEnable);

  cloud
    .command('status')
    .description('Mostra stato cloud sync')
    .action(handleStatus);

  cloud
    .command('push')
    .description('Sincronizza metadati SQLite locale -> cloud (one-shot)')
    .option('--db <path>', 'Path del database SQLite (default ~/.jht/jobs.db)')
    .option('--dry-run', 'Mostra cosa verrebbe pushato senza chiamare il cloud')
    .action(handlePush);

  cloud
    .command('disable')
    .description('Rimuove il token dalla macchina locale (non revoca lato server)')
    .action(handleDisable);

  // `daemon` e' pensato come PID 1 del container su VPS: ciclo push
  // periodico finche' non riceve SIGTERM da docker stop. Cosi' i dati
  // scritti dagli agenti appaiono su jobhunterteam.ai senza che l'utente
  // lanci nulla a mano. Latency: <interval> secondi (default 60s, vedi
  // docs/sessions/2026-05-18-supabase-disk-io-investigation per il
  // motivo del cambio da 30s).
  cloud
    .command('daemon')
    .description('Loop di push continuo (usato come PID 1 del container su VPS)')
    .option('--interval <sec>', 'Secondi tra un push e il successivo (env JHT_CLOUD_PUSH_INTERVAL_SEC)')
    .action(handleDaemon);

  // `realtime-listen` — long-running WebSocket subscriber su Supabase
  // Realtime per ricevere comandi web in tempo reale (es. Start button
  // sulla dashboard cloud → INSERT team_commands → questo handler).
  // Co-spawnato da pid1 accanto a `cloud daemon`.
  cloud
    .command('realtime-listen')
    .description('Subscriber Realtime per comandi team (start/stop) dal web')
    .action(async () => {
      const { runRealtimeSubscriber } = await import('../lib/realtime-subscriber.js');
      await runRealtimeSubscriber();
    });

  // `team-state-listen` — desired-state reconciler che polla /api/team-state
  // e converge `should_run`/`restart_token` → `jht team start|stop|restart`.
  // Parallelo a `realtime-listen` durante il cutover (vedi Step 5 in
  // docs/internal/cloud-sync-architecture.md). Idempotente con team_commands:
  // i due subscriber chiamano gli stessi `jht team <action>`.
  cloud
    .command('team-state-listen')
    .description('Reconciler team_state (desired-state, parallelo a realtime-listen)')
    .action(async () => {
      const { runTeamStateReconciler } = await import('../lib/team-state-reconciler.js');
      await runTeamStateReconciler();
    });

  // `cloud preflight` — single-team enforcement check post-pairing.
  // Esce con codice 0 se il claim è libero/recuperabile, 2 se un altro device
  // ha il claim attivo (heartbeat <5min). Stampa info su stdout per script
  // (install.sh) che vogliono decidere se proseguire.
  cloud
    .command('preflight')
    .description('Controlla se esiste già un team active per questo utente (exit 0=libero, 2=occupato)')
    .action(async () => {
      const config = await loadCloudConfig();
      if (!config?.enabled) {
        console.error(pc.red('Cloud sync non abilitato: preflight richiede pairing prima.'));
        process.exitCode = 1;
        return;
      }
      const baseUrl = (config.base_url || '').replace(/\/+$/, '');
      const conflict = await checkActiveDeviceConflict(baseUrl, config.token);
      if (!conflict.conflict) {
        console.log(pc.green('✓ Nessun team attivo concorrente. Procedi liberamente.'));
        return;
      }
      console.log(
        pc.yellow(
          `⚠ Team già attivo su altro device (heartbeat ${conflict.age_seconds}s fa).`
        )
      );
      console.log(
        pc.dim(
          `  active_device_id: ${conflict.active_device_id?.slice(0, 12)}…\n` +
          `  claimed_at:       ${conflict.claimed_at ?? 'unknown'}\n` +
          `  Per evictare: avvia il container — il reconciler ritenterà ogni 60s\n` +
          `  e prenderà il claim quando il vecchio device sparisce (5min).`
        )
      );
      process.exitCode = 2;
    });
}
