import { readFile, writeFile, mkdir, chmod, unlink, stat } from 'node:fs/promises';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pc from 'picocolors';
import * as clack from '@clack/prompts';
import { JHT_HOME, JHT_DB_PATH } from '../jht-paths.js';
import { SupabaseAuthError } from '../lib/supabase-direct.js';
import { getDirectReader } from '../lib/cloud-direct.js';
import { realtimeSyncEnabled } from '../lib/cloud-realtime.js';
import {
  bootstrapLimits, decideBootstrapPush, nextBootstrapState,
  readBootstrapState, readFirstRunPhase, readLocalSignature, saveBootstrapState,
  BOOTSTRAP_STATE_FILE, FIRST_RUN_STATE_FILE,
} from '../lib/bootstrap-push.js';

const CLOUD_FILE = join(JHT_HOME, 'cloud.json');
const PAIRING_TOKEN_FILE = join(JHT_HOME, '.pairing-token');
const PROFILE_DIR = join(JHT_HOME, 'profile');
const PROFILE_YAML_PATH = join(PROFILE_DIR, 'candidate_profile.yml');
const PROFILE_SUMMARIES_DIR = join(PROFILE_DIR, 'summaries');
const WEEKLY_HALT_FLAG = join(JHT_HOME, '.weekly-halt.flag');
// Cursor delta-sync: per ogni tabella memorizziamo l'ultimo updated_at
// pushato. Al tick successivo selezioniamo solo righe con updated_at >
// cursor. Crollo bandwidth ~95% (vedi docs/internal/postmortems/2026-05-22-vercel-quota-exhaustion.md).
const CLOUD_CURSOR_FILE = join(JHT_HOME, '.cloud-sync-cursor.json');
// Cursor pull desired-state: ultimo updated_at letto da Supabase per
// recuperare flag user-driven (write_requested) scritti via web mentre
// il container era offline. Separato dal push cursor: due direzioni di
// flusso indipendenti (vedi docs/internal/architecture/cloud-sync-architecture.md).
const CLOUD_PULL_CURSOR_FILE = join(JHT_HOME, '.cloud-pull-cursor.json');
// Cursor sync ticket (round-trip cloud↔VPS, [JHT-DATA-SYNC] fase 2):
// { pull_since } = ultimo created_at importato dal cloud (ticket 'open' utente);
// { push_since } = ultimo updated_at pushato in cloud (risoluzioni del team).
const CLOUD_TICKETS_CURSOR_FILE = join(JHT_HOME, '.cloud-tickets-cursor.json');
// Cursor sync bacheca (team_directives, round-trip cloud↔VPS): { pull_since,
// push_since } su updated_at. Vedi handleDirectiveSync.
const CLOUD_DIRECTIVES_CURSOR_FILE = join(JHT_HOME, '.cloud-directives-cursor.json');
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
 * Disaster recovery: scarica lo snapshot completo (positions / scores /
 * applications) dal cloud via GET /api/cloud-sync/full-dump e lo applica
 * a SQLite locale con INSERT OR REPLACE. Distinto dal pull-desired-state
 * (merge dei flag user-driven) e dal push (delta locale → cloud).
 *
 * Vincoli MVP:
 *   - SQLite locale DEVE esistere (lo schema viene da `ensure_schema` su
 *     boot del team). Se mancante, esci con istruzioni "jht team start"
 *     una volta per creare schema, poi `jht cloud restore`.
 *   - Solo 3 tabelle ricostruite. companies e position_highlights vengono
 *     ricreate dal normale loop Analista dopo il restore (follow-up:
 *     mapping UUID→legacy_id per highlights, name-match per companies).
 *   - INSERT OR REPLACE su id SQLite = legacy_id cloud. Righe locali con
 *     id mai pushato (legacy_id=NULL cloud-side) restano intatte.
 *   - Cursor di push resettato a "now" per evitare ri-push delle righe
 *     appena scaricate al prossimo daemon tick.
 *
 * Opzioni:
 *   --confirm-restore   skip prompt interattivo (per CI / script)
 *   --db <path>         path SQLite alternativo (default JHT_DB_PATH)
 */
async function handleRestore(options) {
  const config = await loadCloudConfig();
  if (!config?.enabled) {
    console.error(pc.red('Cloud non configurato. Esegui `jht cloud login` o `jht cloud enable`.'));
    process.exitCode = 1;
    return;
  }
  const baseUrl = (config.base_url || '').replace(/\/+$/, '');
  const token = config.token;
  if (!baseUrl || !token) {
    console.error(pc.red('cloud.json malformato (manca base_url o token).'));
    process.exitCode = 1;
    return;
  }

  const dbPath = options.db || JHT_DB_PATH;
  if (!existsSync(dbPath)) {
    console.error(pc.red(`SQLite locale assente: ${dbPath}`));
    console.error(pc.dim('Lancia `jht team start` una volta per creare lo schema, poi riprova `jht cloud restore`.'));
    process.exitCode = 1;
    return;
  }

  // GET dump
  const dumpUrl = `${baseUrl}/api/cloud-sync/full-dump`;
  console.log(pc.dim(`Scarico snapshot da ${dumpUrl}...`));
  let body;
  try {
    const res = await fetch(dumpUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(pc.red(`Dump fallito (HTTP ${res.status}): ${body.error || 'errore sconosciuto'}`));
      process.exitCode = 1;
      return;
    }
  } catch (err) {
    console.error(pc.red(`Errore di rete: ${err.message}`));
    process.exitCode = 1;
    return;
  }

  const dump = body.dump || {};
  const cloudPositions = Array.isArray(dump.positions) ? dump.positions : [];
  const cloudScores = Array.isArray(dump.scores) ? dump.scores : [];
  const cloudApps = Array.isArray(dump.applications) ? dump.applications : [];

  // Conta righe locali per il diff diagnostico.
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch (err) {
    console.error(pc.red(`node:sqlite non disponibile (${err.message}). Richiesto Node >= 22.`));
    process.exitCode = 1;
    return;
  }

  const localCounts = { positions: 0, scores: 0, applications: 0 };
  try {
    const dbRead = new DatabaseSync(dbPath, { readOnly: true });
    localCounts.positions = dbRead.prepare('SELECT COUNT(*) AS n FROM positions').get().n;
    localCounts.scores = dbRead.prepare('SELECT COUNT(*) AS n FROM scores').get().n;
    localCounts.applications = dbRead.prepare('SELECT COUNT(*) AS n FROM applications').get().n;
    dbRead.close();
  } catch (err) {
    console.error(pc.red(`Lettura SQLite fallita: ${err.message}`));
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log(pc.bold('Restore disaster recovery'));
  console.log(pc.dim(`  Local:  ${localCounts.positions} positions, ${localCounts.scores} scores, ${localCounts.applications} applications`));
  console.log(pc.dim(`  Cloud:  ${cloudPositions.length} positions, ${cloudScores.length} scores, ${cloudApps.length} applications`));
  console.log('');
  console.log(pc.dim('  Modo: INSERT OR REPLACE su id SQLite = legacy_id cloud.'));
  console.log(pc.dim('  Righe locali NON pushate (legacy_id NULL cloud-side) restano intatte.'));
  console.log(pc.dim('  companies e position_highlights NON ricostruite (out of scope MVP).'));

  let confirmed = false;
  if (options.confirmRestore) {
    confirmed = true;
  } else {
    const ans = await clack.confirm({
      message: `Procedo con upsert di ${cloudPositions.length + cloudScores.length + cloudApps.length} righe in ${dbPath}?`,
      initialValue: false,
    });
    if (clack.isCancel(ans) || !ans) {
      console.log(pc.dim('Annullato.'));
      return;
    }
    confirmed = true;
  }

  // Mappa cloud_position_id (UUID) -> legacy_id (int). Usata per scores
  // e applications, che hanno position_id UUID cloud-side.
  const uuidToLegacy = new Map();
  for (const p of cloudPositions) {
    if (p.id && p.legacy_id != null) uuidToLegacy.set(p.id, Number(p.legacy_id));
  }

  let inserted = { positions: 0, scores: 0, applications: 0 };
  let skipped = { positions: 0, scores: 0, applications: 0 };

  try {
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA foreign_keys = OFF');  // Disabilito FK durante restore.

    // Positions: INSERT OR REPLACE su id = legacy_id. company_id resettato
    // a NULL (mapping cloud→sqlite non disponibile in MVP — l'Analista lo
    // ricostruisce al prossimo loop quando incontra la company).
    const posStmt = db.prepare(`
      INSERT OR REPLACE INTO positions (
        id, title, company, company_id, location, remote_type,
        salary_declared_min, salary_declared_max, salary_declared_currency,
        salary_estimated_min, salary_estimated_max, salary_estimated_currency,
        salary_estimated_source,
        url, source, jd_text, jd_summary, requirements, found_by, found_at, deadline,
        status, notes, last_checked, last_actor, role_family,
        loc_city, loc_region, loc_country, loc_country_code,
        work_country, work_country_code,
        is_multi_location, location_notes,
        office_lat, office_lon, office_address, office_geocoded, office_verified,
        write_requested, write_requested_at,
        geocode_requested, geocode_requested_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.exec('BEGIN');
    try {
      for (const p of cloudPositions) {
        const legacyId = Number(p.legacy_id);
        if (!Number.isInteger(legacyId) || legacyId <= 0) {
          skipped.positions++;
          continue;
        }
        posStmt.run(
          legacyId,
          p.title ?? '', p.company ?? '',
          p.location ?? null, p.remote_type ?? null,
          p.salary_declared_min ?? null, p.salary_declared_max ?? null, p.salary_declared_currency ?? null,
          p.salary_estimated_min ?? null, p.salary_estimated_max ?? null, p.salary_estimated_currency ?? null,
          p.salary_estimated_source ?? null,
          p.url ?? null, p.source ?? null, p.jd_text ?? null, p.jd_summary ?? null, p.requirements ?? null,
          p.found_by ?? null, p.found_at ?? null, p.deadline ?? null,
          p.status ?? 'new', p.notes ?? null, p.last_checked ?? null, p.last_actor ?? null, p.role_family ?? null,
          p.loc_city ?? null, p.loc_region ?? null, p.loc_country ?? null, p.loc_country_code ?? null,
          p.work_country ?? null, p.work_country_code ?? null,
          p.is_multi_location ? 1 : 0, p.location_notes ?? null,
          p.office_lat ?? null, p.office_lon ?? null, p.office_address ?? null,
          p.office_geocoded ? 1 : 0, p.office_verified ? 1 : 0,
          p.write_requested ? 1 : 0, p.write_requested_at ?? null,
          p.geocode_requested ? 1 : 0, p.geocode_requested_at ?? null,
          p.created_at ?? null, p.updated_at ?? null,
        );
        inserted.positions++;
      }

      const scoreStmt = db.prepare(`
        INSERT OR REPLACE INTO scores (
          position_id, total_score, experience_fit, salary_fit,
          stack_match, remote_fit, strategic_fit, breakdown, notes,
          scored_by, scored_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const s of cloudScores) {
        const legacy = uuidToLegacy.get(s.position_id);
        if (!legacy) { skipped.scores++; continue; }
        scoreStmt.run(
          legacy,
          s.total_score ?? 0,
          s.experience_fit ?? null, s.salary_fit ?? null,
          s.stack_match ?? null, s.remote_fit ?? null, s.strategic_fit ?? null,
          s.breakdown ?? null, s.notes ?? null,
          s.scored_by ?? null, s.scored_at ?? null,
          s.created_at ?? null, s.updated_at ?? null,
        );
        inserted.scores++;
      }

      const appStmt = db.prepare(`
        INSERT OR REPLACE INTO applications (
          position_id, cv_path, cv_pdf_path, cl_path, cl_pdf_path,
          status, critic_score, critic_verdict, critic_notes,
          written_at, applied_at, applied_via, response, response_at,
          written_by, reviewed_by, critic_reviewed_at, applied,
          cv_drive_id, cl_drive_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const a of cloudApps) {
        const legacy = uuidToLegacy.get(a.position_id);
        if (!legacy) { skipped.applications++; continue; }
        appStmt.run(
          legacy,
          a.cv_path ?? null, a.cv_pdf_path ?? null, a.cl_path ?? null, a.cl_pdf_path ?? null,
          a.status ?? null, a.critic_score ?? null, a.critic_verdict ?? null, a.critic_notes ?? null,
          a.written_at ?? null, a.applied_at ?? null, a.applied_via ?? null,
          a.response ?? null, a.response_at ?? null,
          a.written_by ?? null, a.reviewed_by ?? null, a.critic_reviewed_at ?? null,
          a.applied ? 1 : 0,
          a.cv_drive_id ?? null, a.cl_drive_id ?? null,
          a.created_at ?? null, a.updated_at ?? null,
        );
        inserted.applications++;
      }

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      db.close();
    }
  } catch (err) {
    console.error(pc.red(`Restore fallito: ${err.message}`));
    process.exitCode = 1;
    return;
  }

  // Cursor reset: "ora" così il prossimo push parte dopo le righe appena
  // scaricate (idempotente comunque lato server, ma evitiamo carico inutile).
  const nowIso = new Date().toISOString();
  await saveCloudCursor({
    positions: nowIso,
    scores: nowIso,
    applications: nowIso,
  });

  console.log('');
  console.log(pc.green('✓ Restore completato'));
  console.log(pc.dim(`  Positions:    ${inserted.positions} upsert (${skipped.positions} skip per legacy_id mancante)`));
  console.log(pc.dim(`  Scores:       ${inserted.scores} upsert (${skipped.scores} skip per position_id orfano)`));
  console.log(pc.dim(`  Applications: ${inserted.applications} upsert (${skipped.applications} skip per position_id orfano)`));
  console.log(pc.dim(`  Cursor sync reset a ${nowIso}`));
  console.log('');
  void confirmed;
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

// Vero se la tabella SQLite locale ha la colonna richiesta. Serve per
// includere nel push solo colonne che lo schema locale possiede davvero
// (es. logo_* della feature loghi): un jobs.db piu' vecchio del codice non
// deve far fallire il tick di sync.
function sqliteHasColumn(db, table, col) {
  try {
    return db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .some((r) => r.name === col);
  } catch {
    return false;
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
 * Carica il cursor di pull desired-state. Ritorna { since: ISO|null }.
 * Missing/corrupt = null → endpoint server applica default lookback 7gg.
 */
function loadPullCursor() {
  if (!existsSync(CLOUD_PULL_CURSOR_FILE)) return { since: null, messages_since: null };
  try {
    const parsed = JSON.parse(readFileSync(CLOUD_PULL_CURSOR_FILE, 'utf-8'));
    return {
      since: typeof parsed?.since === 'string' ? parsed.since : null,
      // [JHT-MSG-BACKFLOW] cursore dedicato reply/ack chat web (timeline
      // diversa dai flag posizione).
      messages_since: typeof parsed?.messages_since === 'string' ? parsed.messages_since : null,
    };
  } catch {
    return { since: null, messages_since: null };
  }
}

async function savePullCursor(cursor) {
  try {
    await writeFile(CLOUD_PULL_CURSOR_FILE, JSON.stringify(cursor, null, 2));
  } catch (err) {
    console.error(pc.yellow(`  warn: pull cursor save failed (${err.message})`));
  }
}

/**
 * Cursor sync ticket. Ritorna { pull_since, push_since } (ISO|null).
 * Missing/corrupt = entrambi null → pull fa lookback 7gg server-side, push
 * manda tutto (idempotente: gli UPDATE per cloud_id e gli INSERT linkano).
 */
function loadTicketsCursor() {
  if (!existsSync(CLOUD_TICKETS_CURSOR_FILE)) return { pull_since: null, push_since: null };
  try {
    const p = JSON.parse(readFileSync(CLOUD_TICKETS_CURSOR_FILE, 'utf-8'));
    return {
      pull_since: typeof p?.pull_since === 'string' ? p.pull_since : null,
      push_since: typeof p?.push_since === 'string' ? p.push_since : null,
    };
  } catch {
    return { pull_since: null, push_since: null };
  }
}

async function saveTicketsCursor(cursor) {
  try {
    await writeFile(CLOUD_TICKETS_CURSOR_FILE, JSON.stringify(cursor, null, 2));
  } catch (err) {
    console.error(pc.yellow(`  warn: tickets cursor save failed (${err.message})`));
  }
}

/** Cursor sync bacheca (team_directives). { pull_since, push_since } su updated_at. */
function loadDirectivesCursor() {
  if (!existsSync(CLOUD_DIRECTIVES_CURSOR_FILE)) return { pull_since: null, push_since: null };
  try {
    const p = JSON.parse(readFileSync(CLOUD_DIRECTIVES_CURSOR_FILE, 'utf-8'));
    return {
      pull_since: typeof p?.pull_since === 'string' ? p.pull_since : null,
      push_since: typeof p?.push_since === 'string' ? p.push_since : null,
    };
  } catch {
    return { pull_since: null, push_since: null };
  }
}

async function saveDirectivesCursor(cursor) {
  try {
    await writeFile(CLOUD_DIRECTIVES_CURSOR_FILE, JSON.stringify(cursor, null, 2));
  } catch (err) {
    console.error(pc.yellow(`  warn: directives cursor save failed (${err.message})`));
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

/**
 * Raggruppa `rows` per il valore della colonna `key` (Map key→row[]).
 * Righe con key null/undefined vengono ignorate. Usato dal push chunked per
 * legare scores/applications/highlights alla loro position (stesso batch =
 * il server risolve la FK via legacyToUuid in-request).
 */
function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = r?.[key];
    if (k == null) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

/**
 * Cursore SICURO su invio parziale/chunked. Dato l'insieme di righe CONFERMATE
 * (HTTP 200) e quelle SCARTATE (413 su riga singola), ritorna il massimo
 * `field` tale che TUTTE le righe con field <= esso siano state confermate:
 * ovvero il max sul prefisso confermato che precede la prima riga scartata.
 * Garanzia: il cursore non scavalca mai una riga non ancora sincronizzata →
 * nessuna riga persa. `field` è 'updated_at' | 'deleted_at' | 'ts' a seconda
 * della tabella. Confronto fra stringhe: i timestamp SQLite locali hanno tutti
 * lo stesso formato (come già fa maxUpdatedAt), quindi lessicografico ==
 * cronologico.
 */
function safeCursor(sent, skipped, field) {
  let minSkip = null;
  for (const r of skipped) {
    const v = r?.[field];
    if (v && (minSkip === null || v < minSkip)) minSkip = v;
  }
  let max = null;
  for (const r of sent) {
    const v = r?.[field];
    if (!v) continue;
    if (minSkip !== null && !(v < minSkip)) continue; // non superare il primo skip
    if (max === null || v > max) max = v;
  }
  return max;
}

async function handlePush(options) {
  const config = await loadCloudConfig();
  if (!config || !config.enabled) {
    console.error(pc.red('Cloud sync non abilitato.'));
    console.error(pc.dim('Abilita con: ') + pc.bold('jht cloud enable --token jht_sync_xxx'));
    process.exitCode = 1;
    return { ok: false, authFailed: false, skipped: 0 };
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
    return { ok: false, authFailed: false, skipped: 0 };
  }

  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    console.error(pc.red('node:sqlite non disponibile (richiede Node 22.5+).'));
    process.exitCode = 1;
    return { ok: false, authFailed: false, skipped: 0 };
  }

  let positions = [];
  let scores = [];
  let applications = [];
  let companies = [];
  let highlights = [];
  let pendingMessages = [];
  let tombstones = [];
  let transitions = [];
  // Cursor delta-sync: ad ogni tick leggiamo solo righe con updated_at >
  // ultimo pushato per quella tabella. Prima volta (cursor vuoto): full
  // read. Dopo push HTTP 200: aggiorniamo cursor con MAX(updated_at)
  // delle righe pushate.
  const cursor = options.full ? {} : loadCloudCursor();
  if (dbExists) {
    try {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      positions = readSqliteTableDelta(db, 'positions', [
        // company_id (FK locale → companies): risolto a UUID cloud lato server
        // via companies.legacy_id. Alimenta la Company card del dettaglio (mig 046).
        'id', 'title', 'company', 'company_id', 'url', 'location', 'remote_type', 'status',
        'notes', 'source', 'jd_text', 'jd_summary', 'requirements', 'found_by', 'found_at',
        'deadline', 'last_checked', 'last_actor',
        'salary_declared_min', 'salary_declared_max', 'salary_declared_currency',
        'salary_estimated_min', 'salary_estimated_max', 'salary_estimated_currency',
        'salary_estimated_source',
        // Writer-on-demand (V6, 2026-05-29): l'utente seleziona da
        // dashboard/Telegram, il flag viaggia a cloud per UI cross-device.
        'write_requested', 'write_requested_at',
        // Geocoding-on-demand (V8, 2026-05-31): stesso pattern,
        // l'utente seleziona via UI quali posizioni geocodare con
        // precisione ufficio; il flag viaggia a cloud per UI cross-device.
        'geocode_requested', 'geocode_requested_at',
        // Recheck on-demand (mig 042): liveness su richiesta utente (il recheck
        // non è più autonomo); il flag viaggia a cloud per UI cross-device.
        'recheck_requested', 'recheck_requested_at',
        // Salary-precise on-demand (V9/mig040, dse3): flag user-driven
        // (cross-device: push qui + pull desired-state) + risultato testuale.
        'salary_precise_requested', 'salary_precise_requested_at', 'salary_precise',
        // Metadati location/categoria (Parte B sync, 2026-06-14): prodotti
        // dall'analista, alimentano i grafici categoria/mappa della dashboard
        // (che ESISTE gia' — va solo alimentata). Erano OMESSI dal push →
        // restavano stranded sulla VPS, con le colonne cloud gia' presenti.
        'role_family',
        'loc_city', 'loc_region', 'loc_country', 'loc_country_code', 'loc_continent',
        'work_mode', 'work_country', 'work_country_code',
        'location_notes', 'is_multi_location',
        'office_lat', 'office_lon', 'office_address', 'office_geocoded', 'office_verified',
        // Expiry/lifecycle (mig 038): recheck-liveness scrive is_open/expires_at/
        // last_open_check → dashboard "Scadute/Archivio". Colonne cloud presenti (mig038 applicata 2026-06-14).
        'expires_at', 'is_open', 'last_open_check',
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
      // Companies + position_highlights (mig 046): erano OMESSE dal push →
      // Company card e blocchi Pro/Contro sempre vuoti sul cloud. `id` (int
      // locale) → legacy_id cloud; il server risolve le FK (positions.company_id,
      // highlights.position_id) via le mappe legacy→UUID. hq_country locale →
      // hq cloud lo mappa il server. Delta su updated_at come le altre tabelle.
      const companyCols = [
        'id', 'name', 'website', 'hq_country', 'sector', 'size',
        'glassdoor_rating', 'red_flags', 'culture_notes', 'analyzed_by',
        'analyzed_at', 'verdict',
      ];
      // Loghi aziendali (skill logo-extraction → companies.logo, data-URI
      // <=35KB) + provenienza e flag. Inclusi solo se lo schema locale li ha,
      // cosi' un jobs.db non aggiornato non fa fallire il tick. Lato cloud
      // servono la mig 056 (colonne) e la route /api/cloud-sync/push aggiornata
      // (gia' mappa logo_*); di li' arrivano alla Company card via select("*").
      for (const c of ['logo', 'logo_source', 'logo_fetched']) {
        if (sqliteHasColumn(db, 'companies', c)) companyCols.push(c);
      }
      companies = readSqliteTableDelta(db, 'companies', companyCols, cursor.companies);
      highlights = readSqliteTableDelta(db, 'position_highlights', [
        'id', 'position_id', 'type', 'text',
      ], cursor.position_highlights);
      // pending_user_messages e' la coda agente -> utente. Pushiamo TUTTE le
      // righe ad ogni tick: l'upsert lato server e' idempotente su
      // (user_id, legacy_id), e gli ack-time / reply-time vanno comunque
      // sincronizzati a ritroso (web -> local) — vedi /api/cloud-sync/pull
      // (futuro). Per ora il push e' write-only locale -> cloud.
      // NB: questa tabella non ha colonna updated_at, e' append + flag
      // updates. Lasciamo full-push, il volume e' piccolo.
      // [JHT-CHAT-UNIFY] `author`/`chat_ts` viaggiano col push solo se lo
      // schema locale le ha: un jobs.db più vecchio del codice non deve far
      // fallire il tick (stesso trattamento dei logo_*).
      const msgCols = [
        'id', 'agent', 'body', 'kind', 'related_position_id',
        'delivered_via', 'delivered_at', 'acknowledged_at',
        'user_reply', 'user_reply_at', 'agent_seen_reply_at',
        'created_at',
      ];
      for (const c of ['author', 'chat_ts']) {
        if (sqliteHasColumn(db, 'pending_user_messages', c)) msgCols.push(c);
      }
      pendingMessages = readSqliteTable(db, 'pending_user_messages', msgCols);
      // Tombstones delta (SQLite V7): righe (table_name, legacy_id,
      // deleted_at) accumulate dai trigger BEFORE DELETE. Filtro per
      // deleted_at > cursor → solo le nuove cancellazioni nel tick.
      // Lato server, il receive le interpreta come UPDATE soft
      // SET deleted_at = ?. Vedi mig 025 + _migrate_v6_to_v7_tombstones.
      try {
        if (cursor.tombstones) {
          tombstones = db.prepare(
            `SELECT table_name, legacy_id, deleted_at
             FROM _tombstones WHERE deleted_at > ?`
          ).all(cursor.tombstones);
        } else {
          tombstones = db.prepare(
            `SELECT table_name, legacy_id, deleted_at FROM _tombstones`
          ).all();
        }
      } catch (err) {
        // DB pre-V7: tabella inesistente → no-op silenzioso, niente
        // tombstones nel payload (compat con vecchi DB).
        if (!/no such table/i.test(err.message)) throw err;
      }
      // Event-log per-istanza (position_state_transitions → cloud
      // position_transitions, mig 044): append-only, NO updated_at → cursor su
      // `ts` (monotono) con `>` stretto, come i tombstones. A riposo (nessuna
      // nuova transizione) non contribuisce al payload → niente push inutili.
      // Mappiamo position_id locale → position_legacy_id cloud (stesso int).
      // Idempotente lato server (UNIQUE) → un re-push non duplica. Chiude
      // l'event-log fossile ("Attività recente" ferma all'ultimo backfill).
      try {
        const tCols =
          'position_id AS position_legacy_id, from_state, to_state, ts, by_agent, notes';
        if (cursor.transitions) {
          transitions = db.prepare(
            `SELECT ${tCols} FROM position_state_transitions
             WHERE ts > ? ORDER BY ts ASC`
          ).all(cursor.transitions);
        } else {
          transitions = db.prepare(
            `SELECT ${tCols} FROM position_state_transitions ORDER BY ts ASC`
          ).all();
        }
      } catch (err) {
        // DB senza la tabella (schema vecchio): no-op silenzioso.
        if (!/no such table/i.test(err.message)) throw err;
      }
      db.close();
    } catch (err) {
      console.error(pc.red(`Errore lettura SQLite: ${err.message}`));
      process.exitCode = 1;
      return { ok: false, authFailed: false, skipped: 0 };
    }
  }

  const profileChunks = profilePayload
    ? `, profile (${profilePayload.yaml.length}B yaml + ${Object.keys(profilePayload.summaries).length} summaries)`
    : '';
  const companyChunks = companies.length > 0
    ? `, ${companies.length} companies`
    : '';
  const highlightChunks = highlights.length > 0
    ? `, ${highlights.length} highlights`
    : '';
  const pendingChunks = pendingMessages.length > 0
    ? `, ${pendingMessages.length} pending messages`
    : '';
  const tombstoneChunks = tombstones.length > 0
    ? `, ${tombstones.length} tombstones`
    : '';
  const transitionChunks = transitions.length > 0
    ? `, ${transitions.length} transitions`
    : '';
  const isFirstPush = !cursor.positions && !cursor.scores && !cursor.applications;
  const deltaMode = isFirstPush ? 'first-push (full)' : 'delta';
  console.log(
    pc.dim(
      `Payload [${deltaMode}]: ${positions.length} positions, ${scores.length} scores, ${applications.length} applications${companyChunks}${highlightChunks}${pendingChunks}${tombstoneChunks}${transitionChunks}${profileChunks}`
    )
  );
  if (options.dryRun) {
    console.log(pc.yellow('--dry-run: nulla viene pushato.'));
    // Nessun invio reale → non è un "sync completato": il chiamante non deve
    // ackare. (Il rendezvous "Sync now" non usa mai dryRun.)
    return { ok: false, authFailed: false, skipped: 0, dryRun: true };
  }
  if (
    positions.length === 0 && scores.length === 0 &&
    applications.length === 0 && companies.length === 0 &&
    highlights.length === 0 && pendingMessages.length === 0 &&
    tombstones.length === 0 && transitions.length === 0 && !profilePayload
  ) {
    console.log(pc.yellow('Nessun dato da sincronizzare.'));
    // Già in pari col cloud: niente da spedire = sync di fatto completa →
    // il chiamante PUÒ ackare (nothingToSync). ok=true, skipped=0.
    return { ok: true, authFailed: false, skipped: 0, nothingToSync: true };
  }

  // ── Push CHUNKED (anti-413) ────────────────────────────────────────────
  // Storia del bug: il push era un unico POST monolitico con TUTTE le tabelle.
  // Un HTTP 413 (payload troppo grande) cadeva nel ramo generico !res.ok →
  // cursore NON avanzato → al tick dopo la stessa delta + nuove righe → payload
  // ancora più grande → altri 413 (loop irreversibile, dashboard ferma). Ora
  // spezziamo il payload in richieste piccole con halving adattivo sul 413 e
  // avanziamo il cursore per-tabella SOLO sul prefisso di righe confermate
  // (safeCursor) → nessuna riga persa né saltata, e il backlog già gonfio
  // (>500 positions) si drena in più richieste.
  const pushUrl = `${config.base_url}/api/cloud-sync/push`;
  const authHeaders = {
    Authorization: `Bearer ${config.token}`,
    'Content-Type': 'application/json',
  };
  // Chunk iniziali per tabella (il halving 413 scende sotto se serve). Scelti
  // per stare comodamente sotto il body-limit tipico (~4MB Vercel): le
  // positions sono le righe più pesanti (jd_text/jd_summary), quindi il chunk
  // più piccolo. Override via env per il drain di emergenza.
  const POS_CHUNK = Math.max(1, parseInt(process.env.JHT_PUSH_POS_CHUNK || '75', 10) || 75);
  const ROW_CHUNK = Math.max(1, parseInt(process.env.JHT_PUSH_ROW_CHUNK || '250', 10) || 250);

  async function postBatch(payload) {
    try {
      const r = await fetch(pushUrl, { method: 'POST', headers: authHeaders, body: JSON.stringify(payload) });
      const b = await r.json().catch(() => ({}));
      return { status: r.status, ok: r.ok, body: b };
    } catch (err) {
      return { status: 0, ok: false, body: { error: err.message }, network: true };
    }
  }

  const outcome = {
    aborted: false, authFailed: false, skipped: 0, requests: 0,
    up: { positions: 0, scores: 0, applications: 0, companies: 0,
          position_highlights: 0, pending_user_messages: 0, tombstones: 0,
          position_transitions: 0 },
  };
  const addUp = (b) => {
    outcome.up.positions += b.positions?.upserted ?? 0;
    outcome.up.scores += b.scores?.upserted ?? 0;
    outcome.up.applications += b.applications?.upserted ?? 0;
    outcome.up.companies += b.companies?.upserted ?? 0;
    outcome.up.position_highlights += b.position_highlights?.upserted ?? 0;
    outcome.up.pending_user_messages += b.pending_user_messages?.upserted ?? 0;
    outcome.up.tombstones += b.tombstones?.applied ?? 0;
    outcome.up.position_transitions += b.position_transitions?.upserted ?? 0;
  };

  // Invia `items` (già in ordine cronologico crescente) a chunk di `chunkSize`,
  // dimezzando ogni chunk che torna 413 fino alla riga singola; una riga
  // singola che ancora 413 viene scartata (skip) e loggata, per drenare il
  // resto. Ritorna { confirmed, skipped } (righe, per il cursore). Su
  // errore non-413 / rete / auth / 409 setta outcome.aborted e ferma tutto.
  async function sendChunked(items, chunkSize, build) {
    const confirmed = [];
    const skipped = [];
    if (!items.length || outcome.aborted) return { confirmed, skipped };
    for (let base = 0; base < items.length && !outcome.aborted; base += chunkSize) {
      // Coda FIFO di range [s,e); le metà da 413 rientrano in testa → ordine.
      const queue = [[base, Math.min(base + chunkSize, items.length)]];
      while (queue.length && !outcome.aborted) {
        const [s, e] = queue.shift();
        if (s >= e) continue;
        const res = await postBatch(build(items.slice(s, e)));
        outcome.requests += 1;
        if (res.ok) {
          addUp(res.body);
          for (let i = s; i < e; i++) confirmed.push(items[i]);
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          outcome.aborted = true; outcome.authFailed = true;
          console.error(pc.red(`Push auth fallita (HTTP ${res.status}): ${res.body.error || 'token?'}`));
          return { confirmed, skipped };
        }
        if (res.status === 413) {
          if (e - s <= 1) {
            skipped.push(items[s]); outcome.skipped += 1;
            console.error(pc.red(`Push 413 su riga singola (item #${s}): SCARTATA per drenare il resto — riga anomala, ritentata al prossimo tick.`));
            continue;
          }
          const mid = s + Math.floor((e - s) / 2);
          queue.unshift([mid, e]);
          queue.unshift([s, mid]); // metà sinistra prima → confirmed resta ordinato
          continue;
        }
        // 409 not_active_device o 5xx/altro: non recuperabile in questo giro.
        outcome.aborted = true;
        if (res.status === 409 && res.body.error === 'not_active_device') {
          console.error(pc.red(`Push rifiutato (HTTP 409 not_active_device): un altro device ha il claim (active_device_id=${res.body.active_device_id ?? 'unknown'}).`));
        } else {
          console.error(pc.red(`Push fallito (HTTP ${res.status}): ${res.body.error || 'errore sconosciuto'}`));
        }
        return { confirmed, skipped };
      }
    }
    return { confirmed, skipped };
  }

  // Ordina cronologicamente (updated_at asc) così il cursore avanza sul
  // prefisso confermato senza scavalcare righe non inviate.
  const byAsc = (field) => (a, b) => {
    const x = a?.[field] || '', y = b?.[field] || '';
    return x < y ? -1 : x > y ? 1 : 0;
  };

  // Bundle position→figli: scores/applications/highlights DEVONO viaggiare
  // nello stesso POST della loro position (il server risolve position_id via
  // legacyToUuid costruita SOLO dalle positions in-request — nessun lookup di
  // fallback per scores/applications, vedi route push §2/§3).
  const scoresByPos = groupBy(scores, 'position_id');
  const appsByPos = groupBy(applications, 'position_id');
  const hlByPos = groupBy(highlights, 'position_id');
  const posIds = new Set(positions.map((p) => p.id));
  const bundles = positions.slice().sort(byAsc('updated_at')).map((p) => ({
    p,
    scores: scoresByPos.get(p.id) || [],
    apps: appsByPos.get(p.id) || [],
    hls: hlByPos.get(p.id) || [],
  }));
  // Figli "orfani": la loro position non è nel delta di questo tick (position
  // invariata ma figlio cambiato). Il server li scarterebbe comunque (come nel
  // push monolitico odierno: position_id non risolvibile → drop), ma li
  // inviamo lo stesso perché il cursore avanzi coerentemente col comportamento
  // attuale. Vengono spediti con positions:[] → 200, 0 upsert, cursore avanza.
  const orphanScores = scores.filter((s) => !posIds.has(s.position_id));
  const orphanApps = applications.filter((a) => !posIds.has(a.position_id));
  const orphanHls = highlights.filter((h) => !posIds.has(h.position_id));

  // 1) Companies PRIMA delle positions: le positions risolvono company_id via
  //    lookup su companies.legacy_id, ma averle già committate evita il
  //    round-trip e mantiene la Company card popolata.
  const compRes = await sendChunked(companies.slice().sort(byAsc('updated_at')), ROW_CHUNK,
    (c) => ({ companies: c }));

  // 2) Positions + figli in bundle.
  const posRes = await sendChunked(bundles, POS_CHUNK, (slice) => ({
    positions: slice.map((b) => b.p),
    scores: slice.flatMap((b) => b.scores),
    applications: slice.flatMap((b) => b.apps),
    position_highlights: slice.flatMap((b) => b.hls),
  }));
  const sentScores = posRes.confirmed.flatMap((b) => b.scores);
  const skipScores = posRes.skipped.flatMap((b) => b.scores);
  const sentApps = posRes.confirmed.flatMap((b) => b.apps);
  const skipApps = posRes.skipped.flatMap((b) => b.apps);
  const sentHls = posRes.confirmed.flatMap((b) => b.hls);
  const skipHls = posRes.skipped.flatMap((b) => b.hls);

  // 3) Figli orfani (positions:[] → dropped server-side, cursore avanza).
  const oSco = await sendChunked(orphanScores.slice().sort(byAsc('updated_at')), ROW_CHUNK, (r) => ({ positions: [], scores: r }));
  const oApp = await sendChunked(orphanApps.slice().sort(byAsc('updated_at')), ROW_CHUNK, (r) => ({ positions: [], applications: r }));
  const oHl = await sendChunked(orphanHls.slice().sort(byAsc('updated_at')), ROW_CHUNK, (r) => ({ positions: [], position_highlights: r }));

  // 4) Transitions (position_legacy_id diretto, indipendenti), ordinate per ts.
  const transRes = await sendChunked(transitions.slice().sort(byAsc('ts')), ROW_CHUNK, (t) => ({ position_transitions: t }));

  // 5) Tombstones (lookup di fallback lato server), ordinate per deleted_at.
  const tombRes = await sendChunked(tombstones.slice().sort(byAsc('deleted_at')), ROW_CHUNK, (t) => ({ tombstones: t }));

  // 6) pending_user_messages (full-push, senza cursore) + profile (una volta).
  //    Piccoli, ma chunkati per robustezza. Il profile viaggia col primo chunk.
  let profileSent = false;
  if (pendingMessages.length > 0) {
    await sendChunked(pendingMessages, ROW_CHUNK, (m) => {
      const payload = { pending_user_messages: m };
      if (!profileSent && profilePayload) { payload.profile = profilePayload; profileSent = true; }
      return payload;
    });
  }
  if (!profileSent && profilePayload && !outcome.aborted) {
    const r = await postBatch({ profile: profilePayload });
    outcome.requests += 1;
    if (r.ok) addUp(r.body);
    else if (r.status === 401 || r.status === 403) { outcome.aborted = true; outcome.authFailed = true; }
    else { outcome.aborted = true; console.error(pc.red(`Push profile fallito (HTTP ${r.status}): ${r.body.error || ''}`)); }
  }

  // ── Report + cursore ────────────────────────────────────────────────────
  if (outcome.aborted) {
    // Non avanziamo ALCUN cursore: le richieste già andate a buon fine sono
    // idempotenti (upsert per legacy_id), verranno ri-chunkate al prossimo
    // tick. Nessuna riga persa. Segnaliamo il fallimento al chiamante.
    console.error(pc.yellow(`Push interrotto dopo ${outcome.requests} richieste — cursore invariato, ritento al prossimo tick.`));
    process.exitCode = 1;
    return { ok: false, authFailed: outcome.authFailed, skipped: outcome.skipped };
  }

  console.log(pc.green(`✓ Push completato in ${outcome.requests} richieste`));
  console.log(pc.dim(`  positions: ${outcome.up.positions} · scores: ${outcome.up.scores} · applications: ${outcome.up.applications} · companies: ${outcome.up.companies} · highlights: ${outcome.up.position_highlights} · pending: ${outcome.up.pending_user_messages} · tombstones: ${outcome.up.tombstones} · transitions: ${outcome.up.position_transitions}`));
  if (outcome.skipped > 0) {
    // Segnale forte: righe scartate = una riga singola supera il limite server.
    // L'health-check del Mantenitore (Parte B) lo intercetta.
    console.error(pc.red(`⚠ ${outcome.skipped} righe SCARTATE (riga singola > limite server): richiedono attenzione.`));
  }

  // Cursore SICURO per-tabella: max sul prefisso confermato che precede la
  // prima riga scartata (safeCursor). Su skip il cursore NON scavalca la riga
  // → ritentata al tick dopo. Senza skip == max delle righe inviate (identico
  // al comportamento pre-chunking).
  const newCursor = { ...cursor };
  const set = (k, v) => { if (v) newCursor[k] = v; };
  set('positions', safeCursor(posRes.confirmed.map((b) => b.p), posRes.skipped.map((b) => b.p), 'updated_at'));
  set('scores', safeCursor([...sentScores, ...oSco.confirmed], [...skipScores, ...oSco.skipped], 'updated_at'));
  set('applications', safeCursor([...sentApps, ...oApp.confirmed], [...skipApps, ...oApp.skipped], 'updated_at'));
  set('position_highlights', safeCursor([...sentHls, ...oHl.confirmed], [...skipHls, ...oHl.skipped], 'updated_at'));
  set('companies', safeCursor(compRes.confirmed, compRes.skipped, 'updated_at'));
  set('transitions', safeCursor(transRes.confirmed, transRes.skipped, 'ts'));
  set('tombstones', safeCursor(tombRes.confirmed, tombRes.skipped, 'deleted_at'));
  await saveCloudCursor(newCursor);
  // ok=true anche con skipped>0: i chunk sono saliti e il cursore è avanzato in
  // sicurezza (safeCursor lascia indietro le righe scartate → ritentate). Ma il
  // sync NON è pieno → il chiamante (rendezvous) NON deve ackare finché
  // skipped>0. Esponiamo skipped per far decidere il chiamante.
  return { ok: true, authFailed: false, skipped: outcome.skipped };
}

/**
 * Decodifica un pairing-token base64 generato da
 * dal precedente launcher e ora dal pairing device-code in-game. Formato:
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

async function handleDisable(options = {}) {
  const config = await loadCloudConfig();
  if (!config) {
    console.log(pc.dim('Cloud sync gia disabilitato.'));
    return;
  }
  let revoked = false;
  let revokeWarning = '';
  if (!options.localOnly && config.base_url && config.token) {
    try {
      const res = await fetch(
        `${String(config.base_url).replace(/\/+$/, '')}/api/cloud-sync/revoke`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.token}` },
        },
      );
      const body = await res.json().catch(() => ({}));
      if (res.ok) revoked = true;
      else revokeWarning = `revoca remota fallita (HTTP ${res.status}: ${body.error || 'errore sconosciuto'})`;
    } catch (err) {
      revokeWarning = `revoca remota non raggiungibile (${err.message})`;
    }
  }
  try {
    await unlink(CLOUD_FILE);
    console.log(pc.green('✓ Cloud sync disabilitato'));
    console.log(pc.dim('  Token rimosso dalla macchina locale.'));
    if (revoked) {
      console.log(pc.dim('  Token revocato anche sul server.'));
    } else if (options.localOnly) {
      console.log(pc.dim('  Revoca remota saltata (--local-only).'));
    } else if (revokeWarning) {
      console.log(pc.yellow(`  ⚠ ${revokeWarning}`));
      console.log(pc.dim('  Il sync locale è comunque fermo. Revoca il token su ') +
        `${config.base_url || DEFAULT_BASE_URL}/settings/cloud-sync`);
    }
  } catch (err) {
    console.error(pc.red(`Errore: ${err.message}`));
    process.exitCode = 1;
  }
}

/**
 * Pull desired-state da cloud → SQLite locale. Chiude il gap silent-loss
 * del writer-on-demand: utente clicca "Scrivi CV" via web mentre container
 * è offline → write_requested=TRUE su Supabase → senza pull al riavvio
 * il Capitano non vede mai il flag (push è write-only locale → cloud).
 *
 * Scope MVP: solo `positions.write_requested` + `write_requested_at`.
 * Endpoint server: GET /api/cloud-sync/pull-desired-state?since=<ISO>.
 *
 * Best-effort: non blocca il boot del team su errore di rete o cloud
 * indisponibile. Logga warning e prosegue. Il Capitano vedrà il flag
 * al pull successivo (next boot o tick daemon).
 *
 * options:
 *   --dry-run        non applica le UPDATE, solo report
 *   --full           ignora cursor (lookback 7gg server-side)
 *   --limit <n>      override limit server (default 500)
 *   --silent         logga solo errori (uso al boot, evita rumore)
 */
async function handlePullDesiredState(options = {}) {
  const silent = options.silent === true;
  const log = (msg) => { if (!silent) console.log(msg); };

  const config = await loadCloudConfig();
  if (!config || !config.enabled) {
    if (!silent) {
      console.error(pc.red('Cloud sync non abilitato.'));
      console.error(pc.dim('Abilita con: ') + pc.bold('jht cloud enable --token jht_sync_xxx'));
    }
    process.exitCode = 1;
    return;
  }

  const dbPath = options.db || JHT_DB_PATH;
  const dbExists = await stat(dbPath).then(() => true).catch(() => false);
  if (!dbExists) {
    log(pc.dim(`  pull skip: SQLite locale non trovato (${dbPath}). Boot team prima.`));
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

  const cursor = options.full
    ? { since: null, messages_since: null }
    : loadPullCursor();
  const baseUrl = (config.base_url || DEFAULT_BASE_URL).replace(/\/+$/, '');

  // [JHT-DAEMON-SUPABASE-DIRECT] Fase 1: leggi i flag desired-state da Supabase
  // DIRETTO se abilitato; su errore o se disabilitato → fallback alla GET Vercel.
  // NB: la route Vercel filtra su `positions.updated_at` che NON esiste sul cloud
  // → di fatto è rotta; il path diretto usa i timestamp dei flag come cursore.
  let body = null;
  const reader = getDirectReader(config);
  if (reader) {
    try {
      const sinceVal = cursor.since
        || new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const rows = await reader.readDesiredStateChanges({
        since: sinceVal,
        limit: options.limit || 500,
      });
      // cursor = MAX tra i timestamp dei flag (positions non ha updated_at).
      // Confronto FRA DATE (getTime), non fra stringhe: il cloud restituisce ts
      // Postgres tipo `2026-07-11T10:00:00.123456+00:00` mentre il cursore di
      // default è `...Z` (toISOString) → il compare lessicografico è inaffidabile
      // ('Z' 0x5A vs '+' 0x2B) e il cursore restava congelato. Teniamo comunque
      // come `maxTs` la STRINGA originale del server (non riformattata) così il
      // successivo filtro `.gt.${since}` usa lo stesso formato del DB.
      let maxTs = cursor.since;
      let maxMs = maxTs ? Date.parse(maxTs) : NaN;
      for (const r of rows) {
        for (const ts of [r.write_requested_at, r.geocode_requested_at,
          r.recheck_requested_at, r.salary_precise_requested_at, r.user_excluded_at]) {
          if (!ts) continue;
          const ms = Date.parse(ts);
          if (Number.isNaN(ms)) continue;
          if (Number.isNaN(maxMs) || ms > maxMs) { maxMs = ms; maxTs = ts; }
        }
      }
      // [JHT-MSG-BACKFLOW] Reply/ack chat web: lettura diretta con cursore
      // dedicato. Un errore qui non deve far cadere il pull dei flag →
      // try separato, fallback = nessuna reply in questo tick.
      let msgRows = [];
      let msgCursor = cursor.messages_since || null;
      try {
        const msgSinceVal = cursor.messages_since
          || new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
        msgRows = await reader.readPendingReplyChanges({ since: msgSinceVal, limit: 500 });
        let msgMaxMs = Date.parse(msgSinceVal);
        let msgMaxTs = msgSinceVal;
        for (const m of msgRows) {
          for (const ts of [m.user_reply_at, m.acknowledged_at]) {
            if (!ts) continue;
            const ms = Date.parse(ts);
            if (!Number.isNaN(ms) && ms > msgMaxMs) { msgMaxMs = ms; msgMaxTs = ts; }
          }
        }
        msgCursor = msgMaxTs;
      } catch (err) {
        console.error(pc.yellow(`  reply-backflow (direct) warn: ${err.message}`));
      }
      body = { positions: rows, cursor: maxTs, pending_replies: msgRows, messages_cursor: msgCursor };
    } catch (err) {
      const auth = err instanceof SupabaseAuthError;
      console.error(pc.yellow(`  pull (direct) ${auth ? 'auth' : 'warn'}: ${err.message}${auth ? '' : ' — fallback Vercel'}`));
      body = null;
    }
  }
  if (body === null) {
    const params = new URLSearchParams();
    if (cursor.since) params.set('since', cursor.since);
    if (cursor.messages_since) params.set('messages_since', cursor.messages_since);
    if (options.limit) params.set('limit', String(options.limit));
    const pullUrl = `${baseUrl}/api/cloud-sync/pull-desired-state?${params.toString()}`;
    let res;
    try {
      res = await fetch(pullUrl, {
        headers: { Authorization: `Bearer ${config.token}` },
      });
    } catch (err) {
      console.error(pc.yellow(`  pull warn: errore di rete (${err.message})`));
      process.exitCode = 1;
      return;
    }
    body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(
        pc.yellow(
          `  pull warn: HTTP ${res.status} ${body.error || 'errore sconosciuto'}`
        )
      );
      process.exitCode = 1;
      return;
    }
  }

  const positions = Array.isArray(body.positions) ? body.positions : [];
  log(
    pc.dim(
      `Pull desired-state [since=${cursor.since || 'lookback-7d'}]: ${positions.length} righe`
    )
  );

  if (options.dryRun) {
    if (positions.length > 0) {
      for (const p of positions.slice(0, 10)) {
        log(
          pc.dim(
            `  #${p.legacy_id} write=${p.write_requested}@${p.write_requested_at || '-'} ` +
              `geo=${p.geocode_requested}@${p.geocode_requested_at || '-'}`
          )
        );
      }
      if (positions.length > 10) {
        log(pc.dim(`  ... +${positions.length - 10} altre righe`));
      }
    }
    log(pc.yellow('--dry-run: nessuna UPDATE applicata.'));
    return;
  }

  // ── [JHT-MSG-BACKFLOW] Reply/ack chat web → SQLite locale ──
  // L'agente legge le reply dalla SQLite locale (user_reply_at NOT NULL AND
  // agent_seen_reply_at NULL, iniettate nel prompt): senza questo apply la
  // chat web era un guscio — la reply restava sul cloud e nessuno rispondeva.
  // Merge NON distruttivo (COALESCE): il locale resta autoritativo se ha già
  // un valore; la WHERE salta i no-op per non riscrivere righe a ogni tick.
  const pendingReplies = Array.isArray(body.pending_replies) ? body.pending_replies : [];
  const messagesCursorNext = body.messages_cursor || cursor.messages_since || null;
  if (pendingReplies.length > 0) {
    let repliesApplied = 0;
    try {
      const mdb = new DatabaseSync(dbPath);
      mdb.exec('PRAGMA busy_timeout = 5000');
      const upd = mdb.prepare(`
        UPDATE pending_user_messages
           SET acknowledged_at = COALESCE(acknowledged_at, ?),
               user_reply      = COALESCE(user_reply, ?),
               user_reply_at   = COALESCE(user_reply_at, ?)
         WHERE id = ?
           AND (
             (acknowledged_at IS NULL AND ? IS NOT NULL) OR
             (user_reply IS NULL AND ? IS NOT NULL)
           )
      `);
      for (const m of pendingReplies) {
        const localId = Number(m.legacy_id);
        if (!Number.isInteger(localId) || localId <= 0) continue;
        const ack = m.acknowledged_at || null;
        const reply = m.user_reply || null;
        const replyAt = m.user_reply_at || null;
        const res = upd.run(ack, reply, replyAt, localId, ack, reply);
        repliesApplied += res.changes;
      }
      mdb.close();
    } catch (err) {
      console.error(pc.yellow(`  reply-backflow warn: ${err.message}`));
    }
    // Loggato anche in silent: è il segnale "l'utente ha scritto dal web".
    if (repliesApplied > 0) {
      console.log(pc.green(`✓ Reply/ack web applicati in locale: ${repliesApplied}`));
    }
  }

  if (positions.length === 0) {
    // Aggiorniamo comunque i cursor al server-side value (no-op se uguali,
    // ma riallinea dopo un eventuale --full).
    const nextSince = body.cursor || cursor.since;
    if (nextSince !== cursor.since || messagesCursorNext !== cursor.messages_since) {
      await savePullCursor({ since: nextSince, messages_since: messagesCursorNext });
    }
    return;
  }

  // Apriamo la connessione in RW. Usiamo UPDATE puro (non INSERT): se
  // la position non esiste localmente è una row scoperta su altro device,
  // arriverà al container quando ne pusherà i dati completi (titolo,
  // company, ecc); per ora skip silenzioso. Crearla qui con soli flag
  // produrrebbe una riga zoppa con NULL su title/company → CHECK fail.
  let updated = 0;
  let missing = 0;
  let excludeChanges = 0;
  try {
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA foreign_keys = ON');
    // Il daemon condivide il DB con gli agenti (WAL) e non è prioritario: diamo
    // 5s di attesa sul lock invece di fallire subito con "database is locked".
    db.exec('PRAGMA busy_timeout = 5000');
    // UPDATE multi-flag: scriviamo entrambi i flag desired-state
    // (write_requested + geocode_requested) in un solo statement per row.
    // Idempotente: se il cloud non li ha (NULL), li riportiamo invariati
    // localmente. Se il client SQLite è su schema < V8 (geocode_requested
    // mancante), il prepare fallisce — il caller deve aver chiamato
    // ensure_schema prima (lo fa il boot wiring).
    const stmt = db.prepare(`
      UPDATE positions
         SET write_requested = ?,
             write_requested_at = ?,
             geocode_requested = ?,
             geocode_requested_at = ?,
             recheck_requested = ?,
             recheck_requested_at = ?,
             salary_precise_requested = ?,
             salary_precise_requested_at = ?
       WHERE id = ?
    `);
    // SELECT lo stato locale corrente: serve sia per il "missing" sia per la
    // sync NARROW dell'esclusione utente (sotto).
    const checkStmt = db.prepare(
      'SELECT status, user_excluded_at, user_excluded_prev_status, ' +
        'write_requested, write_requested_at, geocode_requested, geocode_requested_at, ' +
        'recheck_requested, recheck_requested_at, salary_precise_requested, salary_precise_requested_at ' +
        'FROM positions WHERE id = ?'
    );
    // Esclusione utente cloud→locale: applichiamo SOLO l'azione-utente
    // (user_excluded_at valorizzato lato cloud), MAI lo status generico (che
    // resta autoritativo sulla VPS). last_actor='user' + transizione, come fa
    // il team su un cambio stato → il team smette di lavorarci e l'event-log
    // registra CHI. Idempotente: agiamo solo se lo stato user-exclude diverge.
    const applyExcludeStmt = db.prepare(
      `UPDATE positions
          SET status = 'excluded', user_excluded_reason = ?, user_excluded_note = ?,
              user_excluded_at = ?, user_excluded_prev_status = ?, last_actor = 'user'
        WHERE id = ?`
    );
    const applyUnexcludeStmt = db.prepare(
      `UPDATE positions
          SET status = ?, user_excluded_reason = NULL, user_excluded_note = NULL,
              user_excluded_at = NULL, user_excluded_prev_status = NULL, last_actor = 'user'
        WHERE id = ?`
    );
    const transStmt = db.prepare(
      `INSERT INTO position_state_transitions
         (position_id, from_state, to_state, by_agent, notes)
       VALUES (?, ?, ?, 'user', ?)`
    );
    for (const p of positions) {
      const legacyId = Number(p.legacy_id);
      if (!Number.isInteger(legacyId) || legacyId <= 0) continue;
      const local = checkStmt.get(legacyId);
      if (!local) { missing++; continue; }
      const writeFlag = p.write_requested === true || p.write_requested === 1 ? 1 : 0;
      const writeAt = p.write_requested_at || null;
      const geoFlag = p.geocode_requested === true || p.geocode_requested === 1 ? 1 : 0;
      const geoAt = p.geocode_requested_at || null;
      const rcFlag = p.recheck_requested === true || p.recheck_requested === 1 ? 1 : 0;
      const rcAt = p.recheck_requested_at || null;
      const spFlag = p.salary_precise_requested === true || p.salary_precise_requested === 1 ? 1 : 0;
      const spAt = p.salary_precise_requested_at || null;
      // Skip delle scritture no-op: l'UPDATE non tocca updated_at, quindi il
      // trigger `positions_touch_updated_at` (AFTER UPDATE ... WHEN NEW.updated_at
      // IS OLD.updated_at) rilancerebbe una UPDATE annidata su updated_at PER OGNI
      // riga → churn di updated_at + doppio costo di scrittura anche quando nulla
      // cambia. Confrontiamo i flag locali correnti con quelli in arrivo e
      // scriviamo solo se qualcosa è realmente diverso.
      const flagsChanged =
        (local.write_requested ?? 0) !== writeFlag ||
        (local.write_requested_at ?? null) !== writeAt ||
        (local.geocode_requested ?? 0) !== geoFlag ||
        (local.geocode_requested_at ?? null) !== geoAt ||
        (local.recheck_requested ?? 0) !== rcFlag ||
        (local.recheck_requested_at ?? null) !== rcAt ||
        (local.salary_precise_requested ?? 0) !== spFlag ||
        (local.salary_precise_requested_at ?? null) !== spAt;
      if (flagsChanged) {
        stmt.run(writeFlag, writeAt, geoFlag, geoAt, rcFlag, rcAt, spFlag, spAt, legacyId);
        updated++;
      }

      // ── Sync NARROW dell'esclusione utente ──
      const cloudExcluded = !!p.user_excluded_at; // l'utente l'ha esclusa sul cloud
      const localExcluded = !!local.user_excluded_at; // già esclusa-da-utente in locale
      if (cloudExcluded && !localExcluded) {
        // Applica l'esclusione: prev = lo stato locale attuale (se non già 'excluded').
        const prev = local.status === 'excluded'
          ? (local.user_excluded_prev_status || 'scored')
          : local.status;
        applyExcludeStmt.run(
          p.user_excluded_reason || null,
          p.user_excluded_note || null,
          p.user_excluded_at,
          prev,
          legacyId,
        );
        if (local.status !== 'excluded') {
          transStmt.run(legacyId, local.status, 'excluded', p.user_excluded_reason || null);
        }
        excludeChanges++;
      } else if (!cloudExcluded && localExcluded) {
        // L'utente ha annullato l'esclusione sul cloud → ripristina lo stato.
        const restore = local.user_excluded_prev_status || 'scored';
        applyUnexcludeStmt.run(restore, legacyId);
        transStmt.run(legacyId, 'excluded', restore, null);
        excludeChanges++;
      }
    }
    db.close();
  } catch (err) {
    console.error(pc.red(`Errore UPDATE SQLite: ${err.message}`));
    process.exitCode = 1;
    return;
  }

  // Successo sostanziale loggato anche in `silent`: nel daemon vogliamo
  // sapere quando l'utente clicca via web e il pull ha applicato qualcosa
  // (segnale altrimenti invisibile, dato che il push container→cloud
  // riflette il proprio SQLite e farebbe da eco). Quando updated == 0
  // (tipico, no nuovi click) restiamo zitti se silent.
  const successMsg = pc.green(`✓ Pull desired-state applicato: ${updated} positions aggiornate`)
    + (excludeChanges > 0 ? pc.green(` (${excludeChanges} esclusioni utente sincronizzate)`) : '')
    + (missing > 0 ? pc.dim(` (${missing} legacy_id non presenti localmente, skip)`) : '');
  if (updated > 0 || excludeChanges > 0 || !silent) {
    console.log(successMsg);
  }

  if (body.cursor || messagesCursorNext !== cursor.messages_since) {
    await savePullCursor({
      since: body.cursor || cursor.since,
      messages_since: messagesCursorNext,
    });
  }
  if (body.has_more) {
    log(pc.dim('  has_more=true: rilancia per recuperare le righe rimanenti'));
  }
}

/**
 * Sync bidirezionale dei ticket cloud↔VPS ([JHT-DATA-SYNC] fase 2). Chiude
 * il follow-up dichiarato in mig 043. Una sola sessione SQLite RW:
 *
 *   PULL  cloud → locale : importa i ticket 'open' creati dall'utente sul web
 *         (INSERT in position_tickets con cloud_id valorizzato; il Capitano li
 *         vede via C-15). Skip se già importati (cloud_id) o se la posizione
 *         non è ancora locale (arriverà col push dati).
 *   PUSH  locale → cloud : manda gli aggiornamenti del team (assigned/resolved
 *         + response_text) sui ticket con cloud_id, e INSERT dei ticket nati
 *         in locale (cloud_id NULL) — l'endpoint ritorna l'id che scriviamo in
 *         cloud_id per chiudere la correlazione.
 *
 * Endpoint: GET/POST /api/cloud-sync/tickets. Best-effort: non blocca il boot
 * né il daemon su errore di rete. Idempotente: cloud `id` canonico, UPDATE per
 * id + filtro user_id lato server, UNIQUE non necessario (UPDATE/INSERT espliciti).
 *
 * options: --db <path>, --full (ignora cursor), --silent (boot/daemon).
 */
async function handleTicketSync(options = {}) {
  const silent = options.silent === true;
  const log = (msg) => { if (!silent) console.log(msg); };

  const config = await loadCloudConfig();
  if (!config || !config.enabled) {
    if (!silent) {
      console.error(pc.red('Cloud sync non abilitato.'));
      console.error(pc.dim('Abilita con: ') + pc.bold('jht cloud login'));
    }
    process.exitCode = 1;
    return;
  }

  const dbPath = options.db || JHT_DB_PATH;
  const dbExists = await stat(dbPath).then(() => true).catch(() => false);
  if (!dbExists) {
    log(pc.dim(`  ticket-sync skip: SQLite locale non trovato (${dbPath}).`));
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

  const baseUrl = (config.base_url || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const cursor = options.full
    ? { pull_since: null, push_since: null }
    : loadTicketsCursor();

  let imported = 0;
  let pushedUpdates = 0;
  let pushedInserts = 0;
  const importedTickets = [];   // { cloudId, posId, request } dei ticket appena tirati → notifica Assistente
  let db;
  try {
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA foreign_keys = ON');

    // Su container appena creato lo schema SQLite locale (incl. position_tickets,
    // creata da shared/skills/_db.py al primo tocco Python) può non esistere ancora:
    // sync-tickets gira al boot PRIMA dello spawn agenti. Skip grazioso (exit 0) per
    // non sporcare il boot con "no such table"; il giro successivo del daemon, dopo
    // che il team ha inizializzato il DB, troverà la tabella e sincronizzerà.
    const hasTicketsTable = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='position_tickets'")
      .get();
    if (!hasTicketsTable) {
      log(pc.dim('  ticket-sync skip: tabella position_tickets non ancora creata (team al primo boot).'));
      db.close();
      return;
    }

    // ---- PULL: ticket 'open' dal cloud → locale ----
    // [JHT-DAEMON-SUPABASE-DIRECT] Fase 1: se abilitato leggi da Supabase DIRETTO
    // (niente invocazione Vercel); su errore o se disabilitato → fallback Vercel.
    const reader = getDirectReader(config);
    let pullResult = null;           // { tickets, cursor } da direct o Vercel
    if (reader) {
      try {
        const rows = await reader.readOpenTickets({ since: cursor.pull_since });
        let maxCreated = cursor.pull_since;
        for (const t of rows) {
          if (t.created_at && (!maxCreated || t.created_at > maxCreated)) maxCreated = t.created_at;
        }
        pullResult = { tickets: rows, cursor: maxCreated };
      } catch (err) {
        const auth = err instanceof SupabaseAuthError;
        console.error(pc.yellow(`  ticket pull (direct) ${auth ? 'auth' : 'warn'}: ${err.message}${auth ? '' : ' — fallback Vercel'}`));
        pullResult = null;           // direct fallito → prova Vercel
      }
    }
    if (pullResult === null) {
      const pullParams = new URLSearchParams();
      if (cursor.pull_since) pullParams.set('since', cursor.pull_since);
      try {
        const res = await fetch(
          `${baseUrl}/api/cloud-sync/tickets?${pullParams.toString()}`,
          { headers: { Authorization: `Bearer ${config.token}` } },
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          console.error(pc.yellow(`  ticket pull warn: HTTP ${res.status} ${body.error || ''}`));
        } else {
          pullResult = { tickets: Array.isArray(body.tickets) ? body.tickets : [], cursor: body.cursor };
        }
      } catch (err) {
        console.error(pc.yellow(`  ticket pull warn: ${err.message}`));
      }
    }
    if (pullResult && Array.isArray(pullResult.tickets)) {
      const findByCloud = db.prepare('SELECT id FROM position_tickets WHERE cloud_id = ?');
      const posExists = db.prepare('SELECT 1 FROM positions WHERE id = ?');
      const ins = db.prepare(
        `INSERT INTO position_tickets (position_id, request_text, kind, status, cloud_id, created_at)
         VALUES (?, ?, ?, 'open', ?, ?)`
      );
      // Ordina per created_at ASC così il cursore può avanzare in modo sicuro,
      // fermandosi al PRIMO ticket rimandato (posizione non ancora locale).
      const sortedTickets = [...pullResult.tickets].sort(
        (a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''))
      );
      // Il cursore pull_since è ESCLUSIVO (query server: created_at > since). Se
      // saltiamo un ticket perché la sua posizione non è ancora locale, NON
      // dobbiamo far avanzare il cursore oltre di esso: al giro dopo non verrebbe
      // mai più ri-tirato (bug perdita-dati). `cursorFrozen` blocca l'avanzamento
      // al primo buco; i ticket a valle già visti restano idempotenti (findByCloud
      // li scarta) e verranno ri-tirati finché la posizione mancante non arriva.
      let safeCursor = cursor.pull_since;
      let cursorFrozen = false;
      for (const ct of sortedTickets) {
        const cloudId = Number(ct.id);
        const posId = Number(ct.position_legacy_id);
        if (!Number.isInteger(cloudId) || !Number.isInteger(posId)) continue;
        if (findByCloud.get(cloudId)) {               // già importato
          if (!cursorFrozen && ct.created_at) safeCursor = ct.created_at;
          continue;
        }
        if (!posExists.get(posId)) {                  // posizione non ancora locale → riprova al giro dopo
          cursorFrozen = true;
          continue;
        }
        ins.run(posId, ct.request_text || '', ct.kind || 'custom', cloudId, ct.created_at || null);
        imported++;
        importedTickets.push({ cloudId, posId, request: ct.request_text || '' });
        if (!cursorFrozen && ct.created_at) safeCursor = ct.created_at;
      }
      if (safeCursor) cursor.pull_since = safeCursor;
    }

    // ---- PUSH: aggiornamenti team + INSERT locali → cloud ----
    const selCols =
      `id AS local_id, cloud_id, position_id AS position_legacy_id,
       request_text, kind, status, assigned_agent, response_text,
       created_at, assigned_at, resolved_at, updated_at`;
    const rows = cursor.push_since
      ? db.prepare(
          `SELECT ${selCols} FROM position_tickets
           WHERE cloud_id IS NULL OR updated_at > ?`
        ).all(cursor.push_since)
      : db.prepare(`SELECT ${selCols} FROM position_tickets`).all();

    if (rows.length > 0) {
      try {
        const res = await fetch(`${baseUrl}/api/cloud-sync/tickets`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ tickets: rows }),
        });
        const pb = await res.json().catch(() => ({}));
        if (!res.ok) {
          console.error(pc.yellow(`  ticket push warn: HTTP ${res.status} ${pb.error || ''}`));
        } else {
          pushedUpdates = pb.updated || 0;
          pushedInserts = pb.inserted || 0;
          // write-back dei cloud_id sugli INSERT → chiude la correlazione.
          if (pb.id_map && typeof pb.id_map === 'object') {
            const setCloud = db.prepare('UPDATE position_tickets SET cloud_id = ? WHERE id = ?');
            for (const [localId, cloudId] of Object.entries(pb.id_map)) {
              const ci = Number(cloudId);
              const li = Number(localId);
              if (Number.isInteger(ci) && Number.isInteger(li)) setCloud.run(ci, li);
            }
          }
          // avanza push cursor = MAX(updated_at) tra le righe inviate.
          let maxU = cursor.push_since || null;
          for (const r of rows) {
            if (r.updated_at && (maxU === null || r.updated_at > maxU)) maxU = r.updated_at;
          }
          if (maxU) cursor.push_since = maxU;
        }
      } catch (err) {
        console.error(pc.yellow(`  ticket push warn: ${err.message}`));
      }
    }

    db.close();
  } catch (err) {
    try { if (db) db.close(); } catch { /* già chiuso */ }
    console.error(pc.red(`Errore ticket-sync SQLite: ${err.message}`));
    process.exitCode = 1;
    return;
  }

  await saveTicketsCursor(cursor);

  // Notifica l'Assistente dei ticket appena tirati dal cloud: l'Assistente li
  // inoltra al Capitano come richiesta PRIORITARIA (skill ticket-relay). Se
  // l'Assistente non è ancora vivo (boot pre-spawn) la consegna fallisce in
  // silenzio (jht-tmux-send exit 2): la rete di sicurezza (heartbeat
  // q_tickets_open → C-15) recupera comunque il ticket `open` al giro dopo.
  if (importedTickets.length > 0) {
    try {
      const { spawn } = await import('node:child_process');
      const parts = importedTickets.slice(0, 5).map((t) => {
        const req = (t.request || '').replace(/\s+/g, ' ').trim().slice(0, 160);
        return `#${t.cloudId} (pos ${t.posId}): "${req}"`;
      });
      const more = importedTickets.length > 5 ? ` … +${importedTickets.length - 5}` : '';
      const message =
        `[@system -> @assistente] [NEW-TICKET] ${importedTickets.length} ` +
        `richiesta/e utente dalla pagina posizione: ${parts.join(' · ')}${more}. ` +
        `Inoltrala SUBITO al Capitano come [REQ] PRIORITÀ (skill ticket-relay): ` +
        `le richieste utente vanno in prima fila.`;
      await new Promise((resolve) => {
        const child = spawn('jht-tmux-send', ['ASSISTENTE', message], {
          stdio: ['ignore', 'ignore', 'ignore'],
        });
        child.on('error', () => resolve());   // binario assente (fuori container) → best-effort
        child.on('exit', () => resolve());
      });
    } catch {
      /* best-effort: la notifica non deve mai far fallire il ticket-sync */
    }
  }

  const total = imported + pushedUpdates + pushedInserts;
  if (total > 0 || !silent) {
    console.log(
      pc.green(
        `✓ Ticket sync: ${imported} importati↓, ${pushedUpdates} aggiornati↑, ${pushedInserts} nuovi↑`
      )
    );
  }
}

/**
 * Sync bidirezionale della bacheca (team_directives) cloud↔VPS. Mirror di
 * handleTicketSync per gli ordini PERMANENTI dell'utente:
 *   PULL  cloud → locale : direttive create/modificate dall'utente sul web (edit
 *         dal dashboard). cloud_id già locale → UPDATE la riga; nuovo → INSERT.
 *         Il Capitano le legge via `team_directives.py active`.
 *   PUSH  locale → cloud : direttive nate/modificate in locale (via chat) →
 *         UPDATE per cloud_id, INSERT per cloud_id NULL (id_map write-back).
 * Best-effort. Endpoint: GET/POST /api/cloud-sync/team-directives (Vercel; il
 * direct-Supabase reader è un'ottimizzazione futura come per i ticket).
 */
async function handleDirectiveSync(options = {}) {
  const silent = options.silent === true;
  const log = (msg) => { if (!silent) console.log(msg); };

  const config = await loadCloudConfig();
  if (!config || !config.enabled) {
    if (!silent) {
      console.error(pc.red('Cloud sync non abilitato.'));
      console.error(pc.dim('Abilita con: ') + pc.bold('jht cloud login'));
    }
    process.exitCode = 1;
    return;
  }

  const dbPath = options.db || JHT_DB_PATH;
  const dbExists = await stat(dbPath).then(() => true).catch(() => false);
  if (!dbExists) {
    log(pc.dim(`  directive-sync skip: SQLite locale non trovato (${dbPath}).`));
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

  const baseUrl = (config.base_url || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const cursor = options.full
    ? { pull_since: null, push_since: null }
    : loadDirectivesCursor();

  let imported = 0;
  let pushedUpdates = 0;
  let pushedInserts = 0;
  let db;
  try {
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA foreign_keys = ON');

    const hasTable = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='team_directives'")
      .get();
    if (!hasTable) {
      log(pc.dim('  directive-sync skip: tabella team_directives non ancora creata (team al primo boot).'));
      db.close();
      return;
    }

    // ---- PULL: direttive cambiate sul cloud → locale (via Vercel) ----
    let pullResult = null;
    {
      const pullParams = new URLSearchParams();
      if (cursor.pull_since) pullParams.set('since', cursor.pull_since);
      try {
        const res = await fetch(
          `${baseUrl}/api/cloud-sync/team-directives?${pullParams.toString()}`,
          { headers: { Authorization: `Bearer ${config.token}` } },
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          console.error(pc.yellow(`  directive pull warn: HTTP ${res.status} ${body.error || ''}`));
        } else {
          pullResult = { directives: Array.isArray(body.directives) ? body.directives : [], cursor: body.cursor };
        }
      } catch (err) {
        console.error(pc.yellow(`  directive pull warn: ${err.message}`));
      }
    }
    if (pullResult && Array.isArray(pullResult.directives)) {
      const findByCloud = db.prepare('SELECT id FROM team_directives WHERE cloud_id = ?');
      const ins = db.prepare(
        `INSERT INTO team_directives
           (body, kind, status, sort_order, created_by, cloud_id, created_at, updated_at, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const upd = db.prepare(
        `UPDATE team_directives SET body = ?, kind = ?, status = ?, sort_order = ?,
           updated_at = ?, archived_at = ? WHERE cloud_id = ?`
      );
      for (const cd of pullResult.directives) {
        const cloudId = Number(cd.id);
        if (!Number.isInteger(cloudId) || !cd.body) continue;
        const kind = cd.kind || 'order';
        const status = cd.status || 'active';
        const so = Number.isInteger(Number(cd.sort_order)) ? Number(cd.sort_order) : 0;
        if (findByCloud.get(cloudId)) {
          upd.run(cd.body, kind, status, so, cd.updated_at || null, cd.archived_at || null, cloudId);
        } else {
          ins.run(cd.body, kind, status, so, cd.created_by || 'user', cloudId,
                  cd.created_at || null, cd.updated_at || null, cd.archived_at || null);
        }
        imported++;
      }
      if (pullResult.cursor) cursor.pull_since = pullResult.cursor;
    }

    // ---- PUSH: direttive locali (nuove/modificate) → cloud ----
    const selCols =
      `id AS local_id, cloud_id, body, kind, status, sort_order, created_by,
       created_at, archived_at, updated_at`;
    const rows = cursor.push_since
      ? db.prepare(
          `SELECT ${selCols} FROM team_directives WHERE cloud_id IS NULL OR updated_at > ?`
        ).all(cursor.push_since)
      : db.prepare(`SELECT ${selCols} FROM team_directives`).all();

    if (rows.length > 0) {
      try {
        const res = await fetch(`${baseUrl}/api/cloud-sync/team-directives`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ directives: rows }),
        });
        const pb = await res.json().catch(() => ({}));
        if (!res.ok) {
          console.error(pc.yellow(`  directive push warn: HTTP ${res.status} ${pb.error || ''}`));
        } else {
          pushedUpdates = pb.updated || 0;
          pushedInserts = pb.inserted || 0;
          if (pb.id_map && typeof pb.id_map === 'object') {
            const setCloud = db.prepare('UPDATE team_directives SET cloud_id = ? WHERE id = ?');
            for (const [localId, cloudId] of Object.entries(pb.id_map)) {
              const ci = Number(cloudId);
              const li = Number(localId);
              if (Number.isInteger(ci) && Number.isInteger(li)) setCloud.run(ci, li);
            }
          }
          let maxU = cursor.push_since || null;
          for (const r of rows) {
            if (r.updated_at && (maxU === null || r.updated_at > maxU)) maxU = r.updated_at;
          }
          if (maxU) cursor.push_since = maxU;
        }
      } catch (err) {
        console.error(pc.yellow(`  directive push warn: ${err.message}`));
      }
    }

    db.close();
  } catch (err) {
    try { if (db) db.close(); } catch { /* già chiuso */ }
    console.error(pc.red(`Errore directive-sync SQLite: ${err.message}`));
    process.exitCode = 1;
    return;
  }

  await saveDirectivesCursor(cursor);

  const total = imported + pushedUpdates + pushedInserts;
  if (total > 0 || !silent) {
    console.log(
      pc.green(
        `✓ Bacheca sync: ${imported} da cloud↓, ${pushedUpdates} aggiornate↑, ${pushedInserts} nuove↑`
      )
    );
  }
}

/**
 * Rendezvous "Sync now" ([JHT-DATA-SYNC] fase 3): chiude il refresh on-demand
 * senza polling continuo dei browser. Il browser (apertura dashboard o pulsante
 * "Sync now") scrive `team_state.sync_requested_at`; qui il daemon lo rileva,
 * fa un push fresco e marca `sync_completed_at` → il browser fa UN refetch.
 *
 * Pending = sync_requested_at presente e > sync_completed_at (o completed NULL).
 * Best-effort: 1 GET /api/team-state per tick (lettura singola riga per user,
 * economica); push + PATCH ack solo quando c'è davvero una richiesta.
 */
/**
 * La riga `team_state` che serve ai due rendezvous del giro veloce: "Sync
 * now" (dati) e chat. Si legge UNA volta e si passa a entrambi — sono la
 * stessa riga, e leggerla due volte raddoppierebbe le query a vuoto.
 *
 * [JHT-DAEMON-SUPABASE-DIRECT] Fase 1: Supabase diretto se abilitato, con
 * fallback alla GET Vercel. Le colonne `chat_*` (mig 060) possono non
 * esistere su un progetto non ancora migrato: in quel caso PostgREST
 * risponde 400 sull'intera select, quindi si ritenta con le sole colonne
 * storiche e la corsia chat resta semplicemente ferma.
 */
async function readRendezvousState(config, { silent = true } = {}) {
  const baseUrl = (config.base_url || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const reader = getDirectReader(config);
  const stopState = [
    'should_run', 'is_running',
    'emergency_stop_requested_at', 'emergency_stop_completed_at',
  ];
  const withChat = [
    'sync_requested_at', 'sync_completed_at',
    'chat_requested_at', 'chat_delivered_at',
    ...stopState,
  ];
  const legacy = ['sync_requested_at', 'sync_completed_at', ...stopState];

  if (reader) {
    try {
      return await reader.readTeamState(withChat);
    } catch {
      try {
        return await reader.readTeamState(legacy);
      } catch (err) {
        if (!silent) console.error(pc.yellow(`  rendezvous (direct) warn: ${err.message} — fallback Vercel`));
      }
    }
  }
  try {
    const res = await fetch(`${baseUrl}/api/team-state`, {
      headers: { Authorization: `Bearer ${config.token}` },
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => ({}));
    return body.state || null;
  } catch (err) {
    if (!silent) console.error(pc.yellow(`  rendezvous warn: ${err.message}`));
    return null;
  }
}

async function handleSyncRendezvous(options = {}) {
  const silent = options.silent === true;
  const config = options.config || (await loadCloudConfig());
  if (!config || !config.enabled) return;
  const baseUrl = (config.base_url || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const reader = getDirectReader(config);

  const state = options.state !== undefined
    ? options.state
    : await readRendezvousState(config, { silent });
  if (!state) return;

  const reqAt = state.sync_requested_at || null;
  const doneAt = state.sync_completed_at || null;
  // Timestamp ISO (UTC, suffisso Z dal cloud) → confronto lessicografico =
  // cronologico. Pending se richiesto e non ancora completato dopo la richiesta.
  const pending = reqAt && (!doneAt || reqAt > doneAt);
  if (!pending) return;

  // Push fresco ORA (resta su Vercel in Fase 1). Isolato dal counter del daemon.
  const prev = process.exitCode;
  process.exitCode = 0;
  const pushResult = await handlePush({});
  process.exitCode = prev;

  // Ack `sync_completed_at` SOLO su successo PIENO. Prima l'ack veniva scritto
  // sempre → il web segnava "sincronizzato" anche quando il push falliva (o
  // scartava righe dopo 413), mostrando un falso verde su dati non saliti.
  //   • successo pieno (ok && skipped==0, incluso nothingToSync) → ACK.
  //   • aborted / errore / auth-fail                             → NO ack.
  //   • completato ma con righe scartate (skipped>0)             → NO ack:
  //     il sync NON è integro; lasciando l'ack non scritto il pulsante resta
  //     "in sospeso"/riprovabile e il prossimo tick ritenta le righe scartate
  //     (che con safeCursor NON sono state superate dal cursore). Le righe
  //     scartate sono già loggate in rosso da handlePush e intercettate dal
  //     canary sync_health (Mantenitore) → segnale distinto senza nuovo stato.
  const pushOk = !!pushResult && pushResult.ok === true && (pushResult.skipped || 0) === 0;
  if (!pushOk) {
    if (!silent) {
      const why = pushResult && (pushResult.skipped || 0) > 0
        ? `${pushResult.skipped} righe scartate`
        : 'push non riuscito';
      console.error(pc.yellow(`  sync-rendezvous: ack NON scritto (${why}) — il web resta "non sincronizzato", ritento al prossimo tick.`));
    }
    return;
  }

  // Ack `sync_completed_at`: diretto se disponibile, altrimenti PATCH Vercel.
  const nowIso = new Date().toISOString();
  if (reader) {
    try {
      await reader.patchTeamState({ sync_completed_at: nowIso });
      if (!silent) console.log(pc.green('✓ Sync now servito: push fresco + ack (direct)'));
      return;
    } catch (err) {
      if (!silent) console.error(pc.yellow(`  sync-rendezvous ack (direct) warn: ${err.message} — fallback Vercel`));
    }
  }
  try {
    await fetch(`${baseUrl}/api/team-state`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sync_completed_at: nowIso }),
    });
    if (!silent) console.log(pc.green('✓ Sync now servito: push fresco + ack'));
  } catch (err) {
    if (!silent) console.error(pc.yellow(`  sync-rendezvous ack warn: ${err.message}`));
  }
}

/**
 * [JHT-CHAT-UNIFY] La corsia della chat utente ↔ agente, unica per
 * videogioco e web. Gira nel giro VELOCE del daemon (~5s) perché una chat
 * con minuti di latenza non è una chat.
 *
 * Cinque passi, tutti con una guardia LOCALE davanti: a conversazione ferma
 * il giro non tocca né Supabase né Vercel.
 *
 *   1. import  — turni scritti dal web (solo se `chat_requested_at` lo dice);
 *   2. ingest  — turni comparsi in `chat.jsonl` (gioco + `jht-send`), solo se
 *                il file si è mosso (stat, gratis);
 *   3. mirror  — turni nati in SQLite (`jht-notify-user`, web) → `chat.jsonl`,
 *                così la chat del gioco vede la conversazione intera;
 *   4. deliver — turni dell'utente non consegnati → pane tmux dell'agente,
 *                con `jht-tmux-send` (la stessa strada del gioco);
 *   5. push    — turni nuovi → cloud, così il browser li riceve via Realtime.
 *
 * Il push passa da `/api/cloud-sync/push` (service-role + RPC merge di mig
 * 057/060) e non da Supabase diretto: la policy di INSERT dell'utente
 * ammette solo i PROPRI turni, non quelli dell'agente — ed è giusto così.
 * È una manciata di righe piccole per messaggio scambiato, non un battito.
 *
 * Il passo 1 (pull) ha la stessa scelta di canale, ma al contrario: prova il
 * lettore Supabase-diretto quando c'è (costa meno) e ripiega su
 * `/api/cloud-sync/chat` col token del box. Il ripiego NON è una cintura di
 * sicurezza: è la strada normale del fleet, dove `JHT_SUPABASE_DIRECT` è
 * spento — vedi `chatChannelFor` in chat-sync.js.
 */
async function handleChatSync(options = {}) {
  const silent = options.silent === true;
  const config = options.config || (await loadCloudConfig());
  if (!config || !config.enabled) return;
  const dbPath = process.env.JHT_DB || JHT_DB_PATH;
  if (!existsSync(dbPath)) return;

  const chat = await import('../lib/chat-sync.js');
  const log = (level, msg) => {
    if (silent && level !== 'error') return;
    console.error(level === 'error' ? pc.red(`  ${msg}`) : pc.yellow(`  ${msg}`));
  };

  // `node:sqlite` si importa QUI, come fanno tutte le altre funzioni di questo
  // file: non esiste un `DatabaseSync` di modulo. Senza questa riga il `new`
  // qui sotto lanciava "DatabaseSync is not defined" ad ogni giro, l'eccezione
  // finiva nel catch che segue, e il catch è dietro `silent` — che nel daemon
  // vale sempre true. Risultato: la corsia chat usciva in silenzio ad ogni
  // tentativo, per giorni, senza una riga di log. Scoperto il 30/07 solo
  // eseguendo `jht cloud chat-sync` a mano, dove `silent` è false.
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch (err) {
    log('error', `chat-sync: node:sqlite non disponibile: ${err.message}`);
    return;
  }

  let db;
  try {
    // `timeout`: la jobs.db è condivisa con gli agenti, che scrivono spesso.
    // A 5s di cadenza un SQLITE_BUSY istantaneo sarebbe frequente; qui si
    // aspetta il lock invece di saltare il giro.
    db = new DatabaseSync(dbPath, { timeout: 5000 });
  } catch (err) {
    // `log('error', …)` e non il vecchio `if (!silent)`: un DB non apribile
    // ferma la chat per intero, ed è esattamente ciò che deve farsi vedere
    // anche dal daemon.
    log('error', `chat-sync: DB non apribile: ${err.message}`);
    return;
  }
  // Le colonne arrivano da _db.py alla prima apertura di un agente: un
  // container non ancora ri-deployato non deve far esplodere il daemon.
  if (!sqliteHasColumn(db, 'pending_user_messages', 'author')) {
    db.close();
    return;
  }

  // Il canale col cloud: Supabase diretto se il flag opt-in è acceso,
  // altrimenti il token del box su /api/cloud-sync/chat. Il ramo diretto
  // resta preferito perché costa meno; quello Vercel è l'unico che esiste
  // sul fleet, dove `JHT_SUPABASE_DIRECT` è spento — vedi il perché disteso
  // in chat-sync.js, sopra `directChatChannel`.
  const reader = getDirectReader(config);
  const channel = chat.chatChannelFor(config, reader);
  let importedIds = [];
  // Motivo della lettura fallita, se fallita: serve alla diagnosi in fondo
  // (il log qui sotto è gated da `silent`, quindi nel daemon non si vede).
  let readError = null;

  try {
    // ── 1. Turni scritti dal web ───────────────────────────────────────
    // `state` arriva già letto dal giro veloce (la stessa riga team_state
    // del rendezvous "Sync now"): zero letture Supabase in più.
    const state = options.state || null;
    const pending = chat.chatPending(state?.chat_requested_at, state?.chat_delivered_at);
    if (pending && channel) {
      try {
        const cloudRows = await channel.readUndeliveredUserChat({ limit: 50 });
        importedIds = chat.importCloudUserTurns(db, cloudRows, { jhtHome: JHT_HOME });
      } catch (err) {
        readError = err.message;
        log('warn', `chat-sync: lettura turni utente fallita: ${err.message}`);
      }
    }

    // ── 2/3. Mirror bidirezionale col file che legge il gioco ──────────
    const cursorFile = join(JHT_HOME, '.chat-mirror-cursor.json');
    const cursor = await chat.loadChatCursor(cursorFile);
    const ingested = chat.ingestChatJsonl(db, { jhtHome: JHT_HOME, cursor });
    if (JSON.stringify(ingested.cursor) !== JSON.stringify(cursor)) {
      await chat.saveChatCursor(cursorFile, ingested.cursor);
    }
    const mirrored = chat.mirrorDbTurnsToJsonl(db, { jhtHome: JHT_HOME });

    // ── 4. Consegna al pane ────────────────────────────────────────────
    const sent = await chat.deliverPendingUserTurns(db, { log });

    // ── 5. Push dei turni nuovi verso il cloud ─────────────────────────
    const toPush = chat.takeChatRowsToPush(db, { limit: 100 });
    let pushed = 0;
    if (toPush.length > 0) {
      const userId = config.user_id || null;
      const rows = toPush.map((r) => chat.toCloudRow(r, userId));
      const okIds = await pushChatRows(config, rows, toPush.map((r) => r.id), log);
      chat.markChatRowsPushed(db, okIds);
      pushed = okIds.length;
    }

    // ── Chiusura del rendezvous ────────────────────────────────────────
    // Solo se abbiamo davvero consegnato tutto quello che era in coda: con
    // un pane occupato il flag resta aperto e il giro dopo ritenta.
    if (pending && channel && sent.failed === 0) {
      try {
        await channel.closeRendezvous(importedIds);
      } catch (err) {
        log('warn', `chat-sync: ack consegna fallito: ${err.message}`);
      }
    }

    // ── Diagnosi: la corsia ha lavorato o è solo stata zitta? ──────────
    // Va DOPO tutti i passi, perché solo qui si sa cosa è davvero passato.
    // Non è gated da `silent`: è l'unico punto in cui un guasto della chat
    // può farsi vedere da fuori, e nel daemon `silent` è sempre true.
    const queue = chat.undeliveredUserTurns(db);
    await reportChatLane(chat, config, reader, chat.diagnoseChatLane({
      pending,
      requestedAt: state?.chat_requested_at ?? null,
      // `channel`, non `reader`: da quando il pull ha il ripiego via Vercel
      // col token del box, un box senza letture dirette RIESCE a ritirare i
      // turni. Diagnosticare sul solo `reader` significherebbe gridare "non
      // ho modo di ritirarli" su 4 box su 5 mentre la chat funziona — e un
      // allarme sempre acceso insegna a ignorare gli allarmi.
      canRead: !!channel,
      readError,
      queued: queue.count,
      oldestQueuedAt: queue.oldest,
      deliverFailed: sent.failed,
    }));

    const moved = ingested.inserted + mirrored.mirrored + sent.delivered + pushed;
    if (!silent && (moved > 0 || mirrored.backfilled > 0)) {
      console.log(
        pc.green(
          `✓ Chat: ${ingested.inserted} da chat.jsonl↓, ${mirrored.mirrored} verso chat.jsonl↑, ` +
          `${sent.delivered} consegnati all'agente, ${pushed} pushati` +
          (mirrored.backfilled > 0 ? ` (${mirrored.backfilled} storici marcati senza riversarli)` : '')
        )
      );
    }
  } catch (err) {
    if (!silent) console.error(pc.yellow(`  chat-sync error: ${err.message}`));
  } finally {
    try { db.close(); } catch { /* già chiuso */ }
  }
}

/**
 * Ultima segnalazione emessa sulla corsia chat: `{ summary, at }`.
 *
 * Vive in memoria e non su disco di proposito. Il daemon è un processo
 * lungo, quindi entro la sua vita la ripetizione è governata; un riavvio
 * DEVE ri-annunciare, perché chi legge i log dopo un redeploy vuole
 * ritrovare il guasto in cima e non fidarsi di uno stato che non c'è più.
 */
let chatLaneAlert = null;

/**
 * Scrive campi su `team_state` per la via disponibile. Supabase diretto se
 * c'è, altrimenti PATCH Vercel col token del box (`source=token` → i campi
 * OBSERVED, `last_error` incluso, sono ammessi). Il fallback NON è un
 * dettaglio: il guasto che questa funzione racconta più spesso è proprio
 * "manca il canale diretto", e senza la seconda strada la segnalazione
 * morirebbe insieme a ciò che segnala.
 */
async function patchTeamStateBestEffort(config, reader, fields) {
  if (reader) {
    try {
      await reader.patchTeamState(fields);
      return true;
    } catch { /* canale diretto rotto: si prova da Vercel */ }
  }
  const baseUrl = (config.base_url || DEFAULT_BASE_URL).replace(/\/+$/, '');
  try {
    const res = await fetch(`${baseUrl}/api/team-state`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    return res.ok;
  } catch {
    return false; // offline: al prossimo giro si riprova, lo stato è ricalcolato ogni volta
  }
}

/**
 * Fa uscire allo scoperto lo stato della corsia chat: una riga di log
 * SEMPRE visibile (mai dietro `silent`: nel daemon vale sempre true, ed è
 * lì che il guasto va visto) e una traccia su `team_state.last_error` /
 * `last_error_at` — lo stesso campo che il reconciler usa già per farsi
 * vedere dal resto del sistema.
 *
 * Il rientro si dichiara UNA volta e ripulisce `last_error`: un campo
 * rosso su un guasto finito è disinformazione, e alla lunga si impara a
 * ignorarlo.
 */
async function reportChatLane(chat, config, reader, stall) {
  const now = Date.now();

  if (!stall) {
    if (!chatLaneAlert) return;
    console.log(pc.green(`✓ chat: corsia di nuovo operativa (era: ${chatLaneAlert.summary})`));
    chatLaneAlert = null;
    await patchTeamStateBestEffort(config, reader, { last_error: null });
    return;
  }

  if (!chat.shouldAnnounceStall(chatLaneAlert, stall.summary, { now })) return;
  console.error(pc.red(`  ${stall.message}`));
  chatLaneAlert = { summary: stall.summary, at: now };
  await patchTeamStateBestEffort(config, reader, {
    last_error: stall.summary,
    last_error_at: new Date(now).toISOString(),
  });
}

/**
 * Push mirato dei soli turni di chat. Payload minuscolo (una manciata di
 * messaggi), ma con lo stesso trattamento anti-413 del push grosso: chunk
 * che si dimezza, riga singola che ancora 413 scartata e loggata invece di
 * bloccare la coda. Il cursore qui è `cloud_synced_at` per-riga, quindi non
 * esiste un cursore che possa congelarsi (postmortem 2026-07-15).
 *
 * @returns id LOCALI delle righe confermate dal server
 */
async function pushChatRows(config, rows, ids, log) {
  const baseUrl = (config.base_url || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const pushUrl = `${baseUrl}/api/cloud-sync/push`;
  const headers = { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' };
  const CHUNK = Math.max(1, parseInt(process.env.JHT_CHAT_PUSH_CHUNK || '25', 10) || 25);
  const ok = [];

  const queue = [];
  for (let i = 0; i < rows.length; i += CHUNK) queue.push([i, Math.min(i + CHUNK, rows.length)]);

  while (queue.length) {
    const [s, e] = queue.shift();
    if (s >= e) continue;
    let res;
    try {
      const r = await fetch(pushUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ pending_user_messages: rows.slice(s, e) }),
      });
      res = { status: r.status, ok: r.ok };
    } catch (err) {
      log('warn', `chat push: rete (${err.message}) — ritento al prossimo giro`);
      return ok;
    }
    if (res.ok) {
      for (let i = s; i < e; i++) ok.push(ids[i]);
      continue;
    }
    if (res.status === 413 && e - s > 1) {
      const mid = s + Math.floor((e - s) / 2);
      queue.unshift([mid, e]);
      queue.unshift([s, mid]);
      continue;
    }
    if (res.status === 413) {
      log('error', `chat push: 413 su un singolo messaggio (#${s}) — scartato, il resto prosegue`);
      ok.push(ids[s]);
      continue;
    }
    log('warn', `chat push: HTTP ${res.status} — ritento al prossimo giro`);
    return ok;
  }
  return ok;
}

/**
 * [CLOUDSYNC-PUSH-ONLY-WHEN-WATCHED] Il push del primo periodo di vita.
 *
 * Complementare — e subordinato — al rendezvous qui sopra: quel percorso resta
 * l'unico modo in cui l'utente ottiene dati freschi a comando, e non viene
 * toccato (nessun `sync_requested_at` letto, nessun `sync_completed_at` scritto
 * da qui; il segnale di freschezza per i browser aperti lo timbra già la route
 * di push server-side quando il payload porta righe dashboard).
 *
 * Questo invece copre il caso "nessun browser, nessun dato": un box appena
 * creato che lavora mentre nessuno guarda. Spinge a bassa frequenza finché
 * `first_run.py` non dichiara `phase: steady`, e poi mai più — vedi
 * `cli/src/lib/bootstrap-push.js` per le tre garanzie di terminazione.
 *
 * Il push è `handlePush` invariato: stesso chunking anti-413, stesso
 * `safeCursor`. Nessun nuovo percorso di assemblaggio del payload = nessun modo
 * di riaprire l'incidente del 2026-07-15.
 */
async function maybeBootstrapPush(options = {}) {
  const silent = options.silent === true;
  const now = Date.now();
  const limits = bootstrapLimits();
  const state = readBootstrapState();
  const phase = readFirstRunPhase();

  // Due passate: la prima si ferma sui cancelli che costano zero (fase,
  // budget, finestra, cadenza); la firma del DB locale la calcoliamo solo se
  // siamo davvero arrivati fin lì, cioè al massimo una volta per intervallo.
  let decision = decideBootstrapPush({ now, phase, state, limits });
  let signature;
  if (decision.needsSignature) {
    let DatabaseSync = null;
    try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node < 22.5 */ }
    signature = DatabaseSync
      ? readLocalSignature(DatabaseSync, options.db || JHT_DB_PATH, PROFILE_YAML_PATH)
      : null;
    decision = decideBootstrapPush({ now, phase, state, limits, signature });
  }

  if (decision.done && state.done !== true) {
    await saveBootstrapState({
      ...state,
      done: true,
      done_reason: decision.doneReason,
      closed_at: new Date(now).toISOString(),
    });
    if (!silent) {
      console.log(pc.dim(
        `  bootstrap-push chiuso (${decision.doneReason}) — da qui in poi il cloud si aggiorna solo su richiesta del browser.`
      ));
    }
  }
  if (!decision.push) return decision;

  const attempt = (Number.isFinite(state.pushes) ? state.pushes : 0) + 1;
  if (!silent) {
    console.log(pc.dim(
      `  bootstrap-push ${attempt}/${limits.maxPushes} (${decision.reason}, phase=${phase}) — account nuovo, spingo senza attendere un browser.`
    ));
  }

  const prev = process.exitCode;
  process.exitCode = 0;
  const result = await handlePush(options.db ? { db: options.db } : {});
  process.exitCode = prev;

  await saveBootstrapState(nextBootstrapState({ state, now, signature, result }));

  if (!silent && result && result.authFailed === true) {
    console.error(pc.yellow('  bootstrap-push chiuso (auth) — token non valido, smetto di spingere senza browser.'));
  }
  return { ...decision, result };
}

/**
 * Inserisce un messaggio in pending_user_messages locale. Best-effort:
 * usato dal killswitch del daemon per notificare l'utente quando il token
 * è revocato. Il push delta-only normalmente propaga questa tabella in
 * cloud, ma se siamo qui è proprio perché il push fallisce → il bridge
 * Telegram locale è la via di consegna primaria (vedi .launcher/tg-bridge.py).
 *
 * Schema riferimento: shared/skills/_db.py + supabase mig 010.
 */
async function writePendingUserMessage({ agent, body, kind = 'alert', dbPath = JHT_DB_PATH }) {
  try {
    const exists = await stat(dbPath).then(() => true).catch(() => false);
    if (!exists) return false;
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    try {
      db.prepare(
        `INSERT INTO pending_user_messages (agent, body, kind, created_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
      ).run(agent, body, kind);
      return true;
    } finally {
      db.close();
    }
  } catch (err) {
    console.error(pc.yellow(`  warn: writePendingUserMessage failed (${err.message})`));
    return false;
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

  console.log(pc.dim(`Cloud sync daemon: letture utente→team ogni ${intervalSec}s (Supabase) + push on-demand su "Sync now" → ${config.base_url}`));

  let running = true;
  const shutdown = (sig) => {
    if (!running) return;
    running = false;
    console.log(pc.dim(`\nRicevuto ${sig}, esco dal loop...`));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // HALT-WEEKLY guard: se il flag esiste, l'utente ha ordinato stop team
  // (vedi docs/internal/postmortems/2026-05-21-halt-weekly-incident.md). Saltiamo il
  // push: dati locali non cambiano, e ogni tick costa ~1 MB upload + 1
  // function invocation + ~500ms-2s CPU Postgres lato Vercel/Supabase
  // (vedi docs/internal/postmortems/2026-05-22-vercel-quota-exhaustion.md). Logghiamo
  // ogni 10 tick per evitare spam ma confermare che il daemon e' vivo.
  let haltSkipCount = 0;
  // [PUSH ON-DEMAND 2026-06-25] Niente push automatico per-tick: la dashboard cloud
  // si aggiorna SOLO quando l'utente preme "Sync now" (sync_requested_at →
  // handleSyncRendezvous → handlePush). Niente killswitch su push periodico (non
  // esiste più): gli errori del push on-demand sono best-effort.
  //
  // Cadenza a DUE velocità: il CHECK del flag "Sync now" gira VELOCE (~5s, lettura
  // di 1 riga su Supabase ≈ gratis) così il pulsante risponde in pochi secondi; le
  // letture più pesanti (ticket/desired-state) e l'heartbeat restano a intervalSec
  // (60s). Override del check rapido: env JHT_SYNC_CHECK_SEC.
  const syncCheckSec = Math.max(1, parseInt(process.env.JHT_SYNC_CHECK_SEC || '5', 10) || 5);
  const heavyEvery = Math.max(1, Math.round(intervalSec / syncCheckSec));
  let fastTick = 0;

  // [JHT-REALTIME-SYNC] Ramo event-driven (flag JHT_REALTIME_SYNC=1, default OFF):
  // il daemon si iscrive a Supabase Realtime e reagisce agli eventi invece di pollare
  // a ~5s. Con flag OFF resta il loop poll qui sotto (comportamento odierno invariato).
  if (realtimeSyncEnabled()) {
    await runRealtimeLoop({ config, isRunning: () => running });
    console.log(pc.dim('Daemon terminato (event-driven).'));
    return;
  }

  while (running) {
    if (existsSync(WEEKLY_HALT_FLAG)) {
      if (haltSkipCount % heavyEvery === 0) {
        console.log(pc.dim(`  HALT-WEEKLY attivo (${WEEKLY_HALT_FLAG}) — sync sospesa.`));
      }
      haltSkipCount += 1;
    } else {
      if (haltSkipCount > 0) {
        console.log(pc.green(`  HALT-WEEKLY rimosso, riprendo.`));
        haltSkipCount = 0;
      }
      const doHeavy = fastTick % heavyEvery === 0;

      // ── Letture pesanti (richieste utente→team): ogni intervalSec (~60s) ──
      if (doHeavy) {
        // Pull desired-state (flag CV/recheck/escludi impostati dall'utente sul web).
        try {
          const prevPull = process.exitCode;
          process.exitCode = 0;
          await handlePullDesiredState({ silent: true });
          process.exitCode = prevPull;
        } catch (err) {
          console.error(pc.yellow(`  daemon pull-desired-state error: ${err.message}`));
        }

        // Ticket sync: importa i ticket 'open' dell'utente (lettura Supabase) e
        // pusha le risoluzioni del team. Best-effort.
        try {
          const prevTk = process.exitCode;
          process.exitCode = 0;
          await handleTicketSync({ silent: true });
          process.exitCode = prevTk;
        } catch (err) {
          console.error(pc.yellow(`  daemon ticket-sync error: ${err.message}`));
        }
      }

      // ── Check "Sync now" + chat: OGNI giro veloce (~5s) ── UNA lettura di
      // 1 riga (team_state) su Supabase, condivisa dai due rendezvous. Il
      // push dati parte solo se c'è una richiesta dell'utente → il pulsante
      // risponde in pochi secondi; la chat, che non può permettersi minuti
      // di latenza, gira qui e non nel giro pesante.
      let rendezvousState = null;
      try {
        rendezvousState = await readRendezvousState(config, { silent: true });
      } catch (err) {
        console.error(pc.yellow(`  daemon rendezvous read error: ${err.message}`));
      }
      try {
        const prevSr = process.exitCode;
        process.exitCode = 0;
        await handleSyncRendezvous({ silent: true, config, state: rendezvousState });
        process.exitCode = prevSr;
      } catch (err) {
        console.error(pc.yellow(`  daemon sync-rendezvous error: ${err.message}`));
      }

      // [JHT-CHAT-UNIFY] Corsia chat: mirror chat.jsonl ⇄ SQLite, consegna al
      // pane dell'agente, push dei turni nuovi. Ogni passo ha una guardia
      // locale: a chat ferma non tocca nulla di remoto.
      try {
        const prevCh = process.exitCode;
        process.exitCode = 0;
        await handleChatSync({ silent: true, config, state: rendezvousState });
        process.exitCode = prevCh;
      } catch (err) {
        console.error(pc.yellow(`  daemon chat-sync error: ${err.message}`));
      }

      // [M2-MOBILE-STOP] La sola convergenza di controllo ammessa dal cloud:
      // desired=false + rendezvous pendente → comando fisso `jht team stop`. Riusa
      // la riga già letta per sync/chat: nessuna invocation o query extra.
      try {
        const { reconcileEmergencyStop } = await import('../lib/team-state-reconciler.js');
        await reconcileEmergencyStop(config, rendezvousState);
      } catch (err) {
        console.error(pc.yellow(`  daemon emergency-stop error: ${err.message}`));
      }

      // ── Heartbeat "VPS online": ogni intervalSec ── (reconcileOnce solo-heartbeat;
      // start/restart restano desktop; lo stop cloud è la lane stretta sopra).
      if (doHeavy) {
        try {
          const prevRc = process.exitCode;
          process.exitCode = 0;
          const { reconcileOnce } = await import('../lib/team-state-reconciler.js');
          await reconcileOnce();
          process.exitCode = prevRc;
        } catch (err) {
          console.error(pc.yellow(`  daemon heartbeat error: ${err.message}`));
        }

        // ── Bootstrap push (solo primo periodo di vita dell'account) ──
        // DOPO l'heartbeat: un primo push può durare qualche secondo e la
        // dashboard considera la VPS offline dopo 5 min senza battito.
        // La funzione si auto-limita (un push ogni 15 min) e si chiude da sola
        // quando l'account non è più nuovo: a regime è la lettura di due
        // piccoli file JSON locali, che esce al secondo controllo.
        try {
          await maybeBootstrapPush({ silent: false });
        } catch (err) {
          console.error(pc.yellow(`  daemon bootstrap-push error: ${err.message}`));
        }
      }
    }
    fastTick += 1;
    if (!running) break;
    // Sleep interrompibile (~syncCheckSec): chunk da 1s così SIGTERM ferma entro 1s.
    for (let i = 0; i < syncCheckSec && running; i++) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  console.log(pc.dim('Daemon terminato.'));
}

/**
 * [JHT-REALTIME-SYNC] Loop event-driven del daemon (flag ON). Si iscrive a Supabase
 * Realtime per reagire agli eventi (tappa 2: sync-flag su team_state) e gira un
 * PARACADUTE poll lento (~5min, tappa 6) che ri-legge TUTTE le corsie → recupero se
 * il socket muore o perde un evento. Con la SOLA fondazione (Part A) tutto già
 * funziona via paracadute a 5min; Part B aggiunge il fast-path Realtime sui ticket,
 * Part C affina le cadenze (desired-state 5min, heartbeat 3min, presence).
 *
 * @param {object} o
 * @param {object} o.config      cloud.json già caricato
 * @param {() => boolean} o.isRunning  true finché il daemon non riceve SIGTERM/SIGINT
 */
async function runRealtimeLoop({ config, isRunning }) {
  const log = (level, msg) => console.error(pc.dim(`  cloud-realtime ${level}: ${msg}`));

  // Debounce per corsia: una raffica di eventi Realtime non deve lanciare letture
  // concorrenti sovrapposte (push o ticket-sync).
  let syncing = false;
  const runSync = async (tag) => {
    if (syncing) return;
    syncing = true;
    try { await handleSyncRendezvous({ silent: true }); }
    catch (e) { console.error(pc.yellow(`  ${tag} sync-rendezvous error: ${e.message}`)); }
    finally { syncing = false; }
  };
  let ticketing = false;
  const runTicketSync = async (tag) => {
    if (ticketing) return;
    ticketing = true;
    try { await handleTicketSync({ silent: true }); }
    catch (e) { console.error(pc.yellow(`  ${tag} ticket-sync error: ${e.message}`)); }
    finally { ticketing = false; }
  };
  // [JHT-CHAT-UNIFY] La chat ha DUE sorgenti: il cloud (turno scritto dal
  // web → evento su team_state) e il box stesso (l'agente che risponde con
  // `jht-send`, che non produce alcun evento remoto). Serve quindi sia
  // l'aggancio all'evento sia un battito locale corto — che però resta
  // gratis, perché ogni passo di handleChatSync ha una guardia locale.
  let chatting = false;
  const runChatSync = async (tag, state) => {
    if (chatting) return;
    chatting = true;
    try { await handleChatSync({ silent: true, config, state }); }
    catch (e) { console.error(pc.yellow(`  ${tag} chat-sync error: ${e.message}`)); }
    finally { chatting = false; }
  };
  const chatLocalSec = Math.max(1, parseInt(process.env.JHT_CHAT_LOCAL_SEC || '5', 10) || 5);
  const chatTimer = setInterval(() => { void runChatSync('local', null); }, chatLocalSec * 1000);
  let emergencyStopping = false;
  const runEmergencyStop = async (tag, state) => {
    if (emergencyStopping) return;
    emergencyStopping = true;
    try {
      const { reconcileEmergencyStop } = await import('../lib/team-state-reconciler.js');
      await reconcileEmergencyStop(config, state);
    } catch (e) {
      console.error(pc.yellow(`  ${tag} emergency-stop error: ${e.message}`));
    } finally {
      emergencyStopping = false;
    }
  };

  let rt = null;
  try {
    const { createRealtimeSync } = await import('../lib/cloud-realtime.js');
    rt = await createRealtimeSync({ config, log });

    // ── Tappa 2: sync-flag → Realtime ── UPDATE su team_state (sync_requested_at) → push.
    rt.subscribe('team-state', { table: 'team_state', event: 'UPDATE' }, (payload) => {
      void runSync('realtime');
      // Stessa riga, stesso evento: `chat_requested_at` viaggia qui dentro.
      void runChatSync('realtime', payload?.new ?? null);
      // E lo STOP mobile viaggia nello stesso evento, senza un altro poller.
      void runEmergencyStop('realtime', payload?.new ?? null);
    });

    // ── Tappa 3: ticket → Realtime ── cambio su position_tickets → ticket-sync.
    // Richiede mig 048 (position_tickets in publication supabase_realtime + REPLICA
    // IDENTITY FULL). La RLS consegna solo le righe dell'utente.
    rt.subscribe('tickets', { table: 'position_tickets', event: '*' }, () => { void runTicketSync('realtime'); });

    log('info', 'realtime pronto (team_state + position_tickets) — sync/ticket via websocket + paracadute attivo.');
  } catch (e) {
    console.error(pc.yellow(`  cloud-realtime setup fallito (${e.message}) — degrado al solo paracadute poll.`));
  }

  // ── Cadenze lente (tappe 4-5-6) ──
  // - heartbeat ~3min (tappa 5): SOTTO la soglia stale della dashboard (5min, vedi
  //   web/app/api/team-state/claim/route.ts HEARTBEAT_STALE_MS) → la VPS non sparisce mai.
  //   Presence vera (websocket=online) è DEFERRED: richiederebbe di cambiare come la
  //   dashboard legge l'online → per ora resta l'heartbeat scritto (reconcileOnce).
  // - desired-state ~5min (tappa 4): positions cambia troppo per il Realtime → poll lento.
  // - paracadute ~5min (tappa 6, OBBLIGATORIO): ri-legge sync + ticket → se il socket
  //   muore o perde un evento il daemon recupera comunque. Gira SEMPRE, anche se il
  //   setup Realtime è fallito (degrada a poll puro).
  const heartbeatSec = Math.max(30, parseInt(process.env.JHT_HEARTBEAT_SEC || '180', 10) || 180);
  const parachuteSec = Math.max(60, parseInt(process.env.JHT_PARACHUTE_SEC || '300', 10) || 300);
  const desiredStateSec = Math.max(60, parseInt(process.env.JHT_DESIRED_STATE_SEC || '300', 10) || 300);
  const everyParachute = Math.max(1, Math.round(parachuteSec / heartbeatSec));
  const everyDesired = Math.max(1, Math.round(desiredStateSec / heartbeatSec));

  const heartbeat = async () => {
    try {
      const { reconcileOnce } = await import('../lib/team-state-reconciler.js');
      await reconcileOnce();
    } catch (e) { console.error(pc.yellow(`  heartbeat error: ${e.message}`)); }
  };
  const sleepTick = async () => {
    for (let i = 0; i < heartbeatSec && isRunning(); i++) await new Promise((r) => setTimeout(r, 1000));
  };

  let tick = 0;
  while (isRunning()) {
    if (existsSync(WEEKLY_HALT_FLAG)) { await sleepTick(); tick += 1; continue; }

    // Heartbeat ~ogni 3min (mantiene la VPS "online" sulla dashboard).
    await heartbeat();
    // Paracadute ~ogni 5min: recupero sync + ticket (eventi persi / socket morto).
    if (tick % everyParachute === 0) {
      await runSync('parachute');
      await runTicketSync('parachute');
      // La chat ha già il suo battito locale corto: qui serve solo a
      // recuperare il PULL dal cloud se l'evento team_state si è perso.
      const state = await readRendezvousState(config);
      await runChatSync('parachute', state);
      await runEmergencyStop('parachute', state);
    }
    // Desired-state ~ogni 5min (poll lento, niente Realtime).
    if (tick % everyDesired === 0) {
      try { await handlePullDesiredState({ silent: true }); }
      catch (e) { console.error(pc.yellow(`  pull-desired-state error: ${e.message}`)); }
    }
    // Bootstrap push (primo periodo di vita dell'account): stessa cadenza del
    // ramo poll. Nessun evento Realtime lo riguarda — è proprio il caso in cui
    // NESSUNO chiede nulla — quindi vive sul tick, con la sua cadenza interna.
    try { await maybeBootstrapPush({ silent: false }); }
    catch (e) { console.error(pc.yellow(`  bootstrap-push error: ${e.message}`)); }

    tick += 1;
    await sleepTick();
  }

  clearInterval(chatTimer);
  if (rt) { try { await rt.close(); } catch { /* ignore */ } }
}

// Esportata per uso programmatico (es. wire al boot di `jht team start`
// per recuperare write_requested cliccato via web mentre container era
// offline). Best-effort: il caller invoca con { silent: true } e ignora
// process.exitCode così il boot prosegue anche se cloud è giù.
export { handlePullDesiredState, handleTicketSync, handleDirectiveSync };

/**
 * pull-profile — scarica il profilo dal cloud e ricostruisce
 * candidate_profile.yml (only-if-absent). Inverso del push del profilo: chiude
 * il caso "PC nuovo / container ricreato" dove il file locale manca ma il
 * profilo esiste su Supabase. Best-effort: errori non bloccano il boot.
 */
async function handlePullProfile(options = {}) {
  const log = (msg) => { if (!options.silent) console.log(msg); };
  const config = await loadCloudConfig();
  if (!config || config.enabled === false) {
    log(pc.dim('cloud non abilitato — skip pull-profile'));
    return;
  }
  const baseUrl = (config.base_url || '').replace(/\/+$/, '');
  const token = config.token;
  if (!baseUrl || !token) {
    if (!options.silent) console.error(pc.red('config cloud incompleta (base_url/token)'));
    return;
  }

  const profilePath = join(PROFILE_DIR, 'candidate_profile.yml');
  if (existsSync(profilePath) && !options.force) {
    log(pc.dim("profilo locale gia' presente — skip (usa --force per sovrascrivere)"));
    return;
  }

  let res;
  try {
    res = await fetch(`${baseUrl}/api/cloud-sync/pull-profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    if (!options.silent) console.error(pc.red('pull-profile: errore di rete'), err.message);
    return;
  }
  if (!res.ok) {
    if (!options.silent) console.error(pc.red(`pull-profile: HTTP ${res.status}`));
    return;
  }
  let data;
  try { data = await res.json(); } catch { data = null; }
  if (!data || !data.ok) {
    if (!options.silent) console.error(pc.red('pull-profile: ' + ((data && data.error) || 'risposta non valida')));
    return;
  }
  if (!data.configured || !data.yaml) {
    log(pc.dim('nessun profilo sul cloud — niente da scaricare'));
    return;
  }

  await mkdir(PROFILE_DIR, { recursive: true });
  await writeFile(profilePath, data.yaml);
  log(pc.green('✓') + ` profilo scaricato dal cloud -> ${profilePath}`);
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
  // dopo il provisioning VPS) e si registra sul cloud come
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

  // `bootstrap-status` — [CLOUDSYNC-PUSH-ONLY-WHEN-WATCHED] finestra sul push
  // del primo periodo di vita: quanti push restano, quando scade la finestra,
  // e cosa deciderebbe il daemon ADESSO. Sola lettura: non spinge nulla, così
  // si può interrogare anche su un box in produzione senza effetti.
  cloud
    .command('bootstrap-status')
    .description('Stato del push automatico del primo periodo (account nuovo): budget residuo e prossima decisione')
    .action(async () => {
      const limits = bootstrapLimits();
      const state = readBootstrapState();
      const phase = readFirstRunPhase();
      let decision = decideBootstrapPush({ now: Date.now(), phase, state, limits });
      if (decision.needsSignature) {
        let DatabaseSync = null;
        try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node < 22.5 */ }
        const signature = DatabaseSync
          ? readLocalSignature(DatabaseSync, JHT_DB_PATH, PROFILE_YAML_PATH)
          : null;
        decision = decideBootstrapPush({ now: Date.now(), phase, state, limits, signature });
      }
      const pushes = Number.isFinite(state.pushes) ? state.pushes : 0;
      console.log(pc.bold('Bootstrap push (primo periodo di vita dell\'account)'));
      console.log(`  first-run:   ${pc.bold(phase ?? 'sconosciuta')} ${pc.dim(`(${FIRST_RUN_STATE_FILE})`)}`);
      console.log(`  stato:       ${state.done === true ? pc.yellow(`chiuso (${state.done_reason ?? '?'})`) : pc.green('attivo')} ${pc.dim(`(${BOOTSTRAP_STATE_FILE})`)}`);
      console.log(`  push fatti:  ${pushes}/${limits.maxPushes}`);
      console.log(`  cadenza:     ${Math.round(limits.intervalMs / 1000)}s · finestra ${Math.round(limits.windowMs / 3600000)}h · ultimo ${state.last_push_at ?? '—'}`);
      console.log(`  ora farebbe: ${decision.push ? pc.green(`PUSH (${decision.reason})`) : pc.dim(`niente (${decision.reason})`)}`);
      if (!limits.enabled) console.log(pc.yellow('  JHT_CLOUD_BOOTSTRAP_PUSH=0 → disattivato.'));
    });

  cloud
    .command('pull-desired-state')
    .description('Recupera flag user-driven (write_requested) da cloud -> SQLite locale')
    .option('--db <path>', 'Path del database SQLite (default ~/.jht/jobs.db)')
    .option('--full', 'Ignora cursor (lookback 7gg server-side)')
    .option('--limit <n>', 'Max righe per chiamata (default 500, max 2000)')
    .option('--dry-run', 'Mostra cosa verrebbe applicato senza UPDATE')
    .option('--silent', 'Output minimo (per il boot)')
    .action(handlePullDesiredState);

  cloud
    .command('chat-sync')
    .description('Un giro della corsia chat: chat.jsonl <-> SQLite, consegna al pane, push al cloud')
    .action(async () => {
      const config = await loadCloudConfig();
      // A mano si vuole anche il PULL, non solo i passi locali: si legge la
      // riga team_state come farebbe il giro veloce del daemon.
      const state = config?.enabled ? await readRendezvousState(config, { silent: false }) : null;
      await handleChatSync({ silent: false, config, state });
    });

  cloud
    .command('sync-tickets')
    .description('Round-trip ticket cloud<->VPS: importa i ticket utente, pusha le risoluzioni del team')
    .option('--db <path>', 'Path del database SQLite (default ~/.jht/jobs.db)')
    .option('--full', 'Ignora i cursor (pull lookback 7gg, push tutto)')
    .option('--silent', 'Output minimo (per il boot)')
    .action(handleTicketSync);

  cloud
    .command('sync-directives')
    .description('Round-trip bacheca (team_directives) cloud<->VPS: importa gli edit dal dashboard, pusha le direttive locali')
    .option('--db <path>', 'Path del database SQLite (default ~/.jht/jobs.db)')
    .option('--full', 'Ignora i cursor (pull lookback 30gg, push tutto)')
    .option('--silent', 'Output minimo (per il boot)')
    .action(handleDirectiveSync);

  cloud
    .command('pull-profile')
    .description('Scarica il profilo dal cloud -> candidate_profile.yml (only-if-absent)')
    .option('--force', "Sovrascrive il profilo locale anche se gia' presente")
    .option('--silent', 'Output minimo (per il boot)')
    .action(handlePullProfile);

  cloud
    .command('disable')
    .description('Ferma il sync, revoca il token cloud e lo rimuove dal dispositivo')
    .option('--local-only', 'Rimuove il token solo da questo dispositivo senza revocarlo sul server')
    .action(handleDisable);

  // `restore` — disaster recovery: ricostruisce SQLite locale (positions /
  // scores / applications) dallo snapshot cloud. Distinto da pull-desired-
  // state (merge dei flag) e da push (delta locale -> cloud). Conferma
  // esplicita interattiva, --confirm-restore per skip in CI.
  cloud
    .command('restore')
    .description('Ricostruisce SQLite locale dallo snapshot cloud (positions/scores/applications)')
    .option('--db <path>', 'Path del database SQLite (default ~/.jht/jobs.db)')
    .option('--confirm-restore', 'Skip conferma interattiva (richiesto per CI / script)')
    .action(handleRestore);

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
      const { runTeamCommandsPoller } = await import('../lib/team-commands-poller.js');
      await runTeamCommandsPoller();
    });

  // `team-state-listen` — desired-state reconciler che polla /api/team-state
  // e converge `should_run`/`restart_token` → `jht team start|stop|restart`.
  // Parallelo a `realtime-listen` durante il cutover (vedi Step 5 in
  // docs/internal/architecture/cloud-sync-architecture.md). Idempotente con team_commands:
  // i due subscriber chiamano gli stessi `jht team <action>`.
  cloud
    .command('team-state-listen')
    .description('Reconciler team_state (desired-state, parallelo a realtime-listen)')
    .action(async () => {
      const { runTeamStateReconciler } = await import('../lib/team-state-reconciler.js');
      await runTeamStateReconciler();
    });

  // `messages-listen` — poller `user_to_agent_messages`. Browser POSTa
  // a /api/messages, questo handler legge i pending, fa claim atomico
  // (PATCH delivered) e forwarda al tmux pane dell'agente target via
  // `jht-tmux-send`. Co-spawnato da pid1 accanto a daemon/realtime/team-state.
  cloud
    .command('messages-listen')
    .description('Poller user_to_agent_messages (forward web → tmux pane)')
    .action(async () => {
      const { runUserMessagesPoller } = await import('../lib/user-messages-poller.js');
      await runUserMessagesPoller();
    });

  // `file-bridge-listen` — poller del bridge effimero dei file. Pubblica
  // l'indice dei file del container e serve le richieste on-demand del web
  // caricando i file in un bucket Supabase di transito via signed upload URL
  // (poi purgati). Co-spawnato da pid1 accanto agli altri reader. Vedi
  // docs/internal/file-bridge-on-demand-2026-06-07.md
  cloud
    .command('file-bridge-listen')
    .description('Poller file bridge (indice + upload on-demand CV/allegati al web)')
    .action(async () => {
      const { runFileBridgePoller } = await import('../lib/file-bridge-poller.js');
      await runFileBridgePoller();
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
