import { readFile, writeFile, mkdir, chmod, unlink, stat } from 'node:fs/promises';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pc from 'picocolors';
import * as clack from '@clack/prompts';
import { JHT_HOME, JHT_DB_PATH } from '../jht-paths.js';
import { SupabaseAuthError } from '../lib/supabase-direct.js';
import { getDirectReader } from '../lib/cloud-direct.js';
import { realtimeSyncEnabled } from '../lib/cloud-realtime.js';
import { writePrivateJson } from '../lib/secure-config-io.js';
import {
  acknowledgeSync,
  publishSyncOutcome,
  pushRendezvousOutcome,
  syncRendezvousPending,
  syncRendezvousTerminal,
  timeoutFailure,
} from '../lib/sync-rendezvous.js';
import { clientIdentity, clientHeaderValue, cloudSyncHeaders } from '../lib/client-identity.js';
import { summarizeOutOfRange } from '../lib/score-ranges.js';
import { createHaltGate, guardedLane } from '../lib/halt-gate.js';
import { createExclusiveRunner } from '../lib/exclusive-runner.js';
import {
  CLOUD_PUSH_QUARANTINE_FILE,
  activeQuarantineEntries,
  partitionQuarantinedRows,
  quarantineRow,
  readCloudPushQuarantine,
  requestQuarantineRetry,
  resolveConfirmedRetries,
  resolveQuarantine,
  retryTables,
  sanitizedQuarantineReason,
} from '../lib/cloud-push-quarantine.js';
import {
  bootstrapLimits, decideBootstrapPush, nextBootstrapState,
  readBootstrapState, readFirstRunPhase, readLocalSignature, saveBootstrapState,
  BOOTSTRAP_STATE_FILE, FIRST_RUN_STATE_FILE,
} from '../lib/bootstrap-push.js';
import {
  decideBootstrapRestore, readLocalPositionsCount,
} from '../lib/bootstrap-restore.js';
import {
  periodicPushLimits,
  periodicPushObservation,
  periodicPushStatusLine,
  readPeriodicPushState,
  runPeriodicPushCycle,
  savePeriodicPushState,
} from '../lib/periodic-push.js';

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
// Un cambio di device autoritativo apre una nuova ownership epoch. I cursor
// locali del device che prende il controllo non possono essere considerati
// validi rispetto alle scritture fatte nel frattempo dall'altro device: al
// takeover li cancelliamo e lasciamo che i sync ripartano dalla propria
// baseline sicura (full push o lookback server-side, a seconda della corsia).
const CLOUD_OWNERSHIP_CURSOR_FILES = [
  CLOUD_CURSOR_FILE,
  CLOUD_PULL_CURSOR_FILE,
  CLOUD_TICKETS_CURSOR_FILE,
  CLOUD_DIRECTIVES_CURSOR_FILE,
];
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
  writePrivateJson(CLOUD_FILE, config);
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
    console.error(pc.red('Missing or malformed token.'));
    console.error('Usage: ' + pc.bold('jht cloud enable --token jht_sync_xxxxxxxx'));
    console.error(pc.dim('Generate a token at https://jobhunterteam.ai/settings/cloud-sync'));
    process.exitCode = 1;
    return;
  }

  const baseUrl = (options.url || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const pingUrl = `${baseUrl}/api/cloud-sync/ping`;

  console.log(pc.dim(`Verifying token at ${pingUrl}…`));

  let res;
  try {
    res = await fetch(pingUrl, {
      headers: cloudSyncHeaders(token),
    });
  } catch (err) {
    console.error(pc.red(`Network error: ${err.message}`));
    process.exitCode = 1;
    return;
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(
      pc.red(`Failed verification (HTTP ${res.status}): ${body.error || 'unknown error'}`)
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

  console.log(pc.green('✓ Cloud sync enabled'));
  console.log(pc.dim(`  Base URL:   ${baseUrl}`));
  console.log(pc.dim(`  Token name: ${body.token?.name ?? 'unnamed'}`));
  console.log(pc.dim(`  User ID:    ${body.user_id}`));
  console.log(pc.dim(`  File:       ${CLOUD_FILE} (0600)`));

  // Auto-push: l'utente ha appena collegato il VPS, vuole vedere i dati sul
  // dashboard subito — non ha senso forzarlo a un secondo comando.
  // [JHT-CLOUD-RESTORE] T-029 — DB locale VUOTO → restore automatico; DB con
  // dati → push. Mai entrambi. Il gancio e' UNO, in `maybeBootstrapRestore`.
  if (await maybeBootstrapRestore(options)) return;

  if (options.noPush) {
    console.log(pc.dim('  Initial push skipped (--no-push). Run: jht cloud push'));
    return;
  }
  // Se il DB non esiste ancora (team mai avviato): skip silenzioso. Il
  // pairing e' completo, non e' un errore. L'utente puo' fare push dopo
  // il primo `jht team start`.
  try {
    await stat(JHT_DB_PATH);
  } catch {
    console.log(pc.dim(`  No local database yet (${JHT_DB_PATH}). Initial push skipped.`));
    console.log(pc.dim(`  Start the team with 'jht team start' and then 'jht cloud push'.`));
    return;
  }
  console.log('');
  console.log(pc.dim('Syncing local data to the cloud...'));
  // process.exitCode di handlePush e' best-effort: se push fallisce, l'enable
  // resta valido (token salvato) ma stampiamo l'errore. L'utente puo' riprovare.
  const prevExitCode = process.exitCode;
  await handlePush({});
  if (process.exitCode === 1) {
    console.log(pc.yellow('  Cloud sync was enabled, but the initial push failed. Retry with: jht cloud push'));
    process.exitCode = prevExitCode;
  }
}

/**
 * [JHT-CLOUD-RESTORE] T-029 — il gancio bootstrap-restore, in UN punto (T-030:
 * era duplicato identico in handleEnable e handleLogin, e due copie divergono
 * al primo cambio).
 *
 * Sonda il DB locale (esiste? quante positions?) e lascia la DECISIONE a
 * `bootstrap-restore.js`: DB vuoto → parte `handleRestore` con la sua
 * transazione e la guardia anti-DELETE di T-027; qualunque altra forma di DB
 * → niente. Fail-safe come il ramo push: un restore fallito non invalida il
 * pairing — warn, recover hint, exitCode preservato.
 *
 * Ritorna true se il restore e' partito: il chiamante torna SENZA pushare
 * (un DB appena tirato giu' non ha nulla di nuovo da dire, e il restore ha
 * gia' resettato il cursore di sync a "now").
 */
async function maybeBootstrapRestore(options = {}) {
  let dbPresent = true;
  try {
    await stat(JHT_DB_PATH);
  } catch {
    dbPresent = false;
  }
  let localPositions = null;
  if (dbPresent) {
    try {
      const { DatabaseSync } = await import('node:sqlite');
      localPositions = readLocalPositionsCount(DatabaseSync, JHT_DB_PATH);
    } catch { /* Node < 22.5: resta null → niente restore automatico */ }
  }
  const decision = decideBootstrapRestore({ dbPresent, localPositions });
  if (!decision.restore) return false;
  if (!options.uiJson) {
    console.log('');
    console.log(pc.dim('Empty local database: pulling the cloud snapshot (automatic bootstrap restore)...'));
  }
  emitCloudLoginUi(options, 'bootstrap_restore', { reason: decision.reason });
  const prevExitCode = process.exitCode;
  await handleRestore({ confirmRestore: true });
  if (process.exitCode === 1) {
    console.log(pc.yellow('  Pairing OK but the automatic restore failed. Recover: jht cloud restore --confirm-restore'));
    process.exitCode = prevExitCode;
  }
  return true;
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
 *   - Conflitto di URL: mai un DELETE per risolverlo (residuo dichiarato di
 *     [DEDUP-URL-CORRECTNESS], T-027). Con l'indice UNIQUE parziale su `url`,
 *     OR REPLACE risolverebbe il conflitto CANCELLANDO la riga locale che
 *     possiede gia' quell'URL — e il trigger `positions_tombstone`
 *     propagherebbe la delete al cloud: perdita silenziosa proprio nel
 *     percorso di disaster-recovery. Una riga cloud il cui URL e' gia' di
 *     un'altra riga (id diverso) viene SALTATA e dichiarata a video, con
 *     conteggio dei conflitti nel report finale.
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
    console.error(pc.red('Cloud not configured. Run `jht cloud login` or `jht cloud enable`.'));
    process.exitCode = 1;
    return;
  }
  const baseUrl = (config.base_url || '').replace(/\/+$/, '');
  const token = config.token;
  if (!baseUrl || !token) {
    console.error(pc.red('Malformed cloud.json: base_url or token is missing.'));
    process.exitCode = 1;
    return;
  }

  const dbPath = options.db || JHT_DB_PATH;
  if (!existsSync(dbPath)) {
    console.error(pc.red(`Local SQLite database not found: ${dbPath}`));
    console.error(pc.dim('Run `jht team start` once to create the schema, then retry `jht cloud restore`.'));
    process.exitCode = 1;
    return;
  }

  // GET dump
  const dumpUrl = `${baseUrl}/api/cloud-sync/full-dump`;
  console.log(pc.dim(`Downloading snapshot from ${dumpUrl}...`));
  let body;
  try {
    const res = await fetch(dumpUrl, {
      method: 'GET',
      headers: cloudSyncHeaders(token),
    });
    body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(pc.red(`Dump failed (HTTP ${res.status}): ${body.error || 'unknown error'}`));
      process.exitCode = 1;
      return;
    }
  } catch (err) {
    console.error(pc.red(`Network error: ${err.message}`));
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
    console.error(pc.red(`node:sqlite is unavailable (${err.message}). Node 22 or newer is required.`));
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
    console.error(pc.red(`Failed to read SQLite: ${err.message}`));
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log(pc.bold('Restore disaster recovery'));
  console.log(pc.dim(`  Local:  ${localCounts.positions} positions, ${localCounts.scores} scores, ${localCounts.applications} applications`));
  console.log(pc.dim(`  Cloud:  ${cloudPositions.length} positions, ${cloudScores.length} scores, ${cloudApps.length} applications`));
  console.log('');
  console.log(pc.dim('  Mode: INSERT OR REPLACE using the cloud legacy_id as the SQLite id.'));
  console.log(pc.dim('  URL conflicts are never resolved by deleting: the cloud row is skipped and reported.'));
  console.log(pc.dim('  Local rows not pushed to the cloud (legacy_id NULL) remain unchanged.'));
  console.log(pc.dim('  companies and position_highlights are not rebuilt (outside the MVP scope).'));

  let confirmed = false;
  if (options.confirmRestore) {
    confirmed = true;
  } else {
    const ans = await clack.confirm({
      message: `Proceed with upsert ${cloudPositions.length + cloudScores.length + cloudApps.length} rows in ${dbPath}?`,
      initialValue: false,
    });
    if (clack.isCancel(ans) || !ans) {
      console.log(pc.dim('Cancelled.'));
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
  let outOfRange = { rows: 0, byColumn: {}, worst: null };
  const urlConflicts = [];

  try {
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA foreign_keys = OFF');  // Disabilito FK durante restore.

    // Positions: INSERT OR REPLACE su id = legacy_id. company_id resettato
    // a NULL (mapping cloud→sqlite non disponibile in MVP — l'Analista lo
    // ricostruisce al prossimo loop quando incontra la company).
    // Guardia anti-DELETE (residuo [DEDUP-URL-CORRECTNESS], T-027): con
    // l'indice UNIQUE parziale su `url`, OR REPLACE risolve un conflitto di
    // URL CANCELLANDO la riga che possiede gia' quell'URL — e il trigger
    // `positions_tombstone` propagherebbe la delete al cloud. Il restore non
    // cancella MAI per un URL: conflitto = riga cloud saltata e dichiarata,
    // con conteggio nel report. La query vede anche le righe appena
    // ripristinate in questo giro, quindi vale pure fra righe cloud fra loro.
    const urlConflictStmt = db.prepare(
      'SELECT id FROM positions WHERE url = ? AND id <> ?'
    );
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
        const url = p.url ?? null;
        if (url) {
          const clash = urlConflictStmt.get(url, legacyId);
          if (clash) {
            urlConflicts.push({ legacyId, url, localId: clash.id });
            continue;
          }
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
      const restoredScores = [];
      for (const s of cloudScores) {
        const legacy = uuidToLegacy.get(s.position_id);
        if (!legacy) { skipped.scores++; continue; }
        restoredScores.push(s);
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
      outOfRange = summarizeOutOfRange(restoredScores);

      // O-64 ha reso critic_round parte dello stato locale del Critico. Un
      // restore puo' partire da un jobs.db creato dall'immagine precedente:
      // allineiamo solo lo schema, senza modificare righe esistenti.
      if (!sqliteHasColumn(db, 'applications', 'critic_round')) {
        db.exec('ALTER TABLE applications ADD COLUMN critic_round INTEGER');
      }
      const appStmt = db.prepare(`
        INSERT OR REPLACE INTO applications (
          position_id, cv_path, cv_pdf_path, cl_path, cl_pdf_path,
          status, critic_score, critic_verdict, critic_notes, critic_round,
          written_at, applied_at, applied_via, response, response_at,
          written_by, reviewed_by, critic_reviewed_at, applied,
          cv_drive_id, cl_drive_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const a of cloudApps) {
        const legacy = uuidToLegacy.get(a.position_id);
        if (!legacy) { skipped.applications++; continue; }
        appStmt.run(
          legacy,
          a.cv_path ?? null, a.cv_pdf_path ?? null, a.cl_path ?? null, a.cl_pdf_path ?? null,
          a.status ?? null, a.critic_score ?? null, a.critic_verdict ?? null,
          a.critic_notes ?? null, a.critic_round ?? null,
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
    console.error(pc.red(`Failed restore: ${err.message}`));
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
  console.log(pc.green('✓ Restore completed'));
  console.log(pc.dim(`  Positions:    ${inserted.positions} upserted (${skipped.positions} skipped: missing legacy_id)`));
  console.log(pc.dim(`  Scores:       ${inserted.scores} upserted (${skipped.scores} skipped: orphaned position_id)`));
  console.log(pc.dim(`  Applications: ${inserted.applications} upserted (${skipped.applications} skipped: orphaned position_id)`));
  // Il cloud non ha CHECK sulle dimensioni (solo su total_score, mig 001): una
  // riga fuori scala rientra qui a ogni restore. Non la tocchiamo — i punteggi
  // sono di utenti reali — ma la contiamo, altrimenti il fenomeno resta
  // invisibile a chi non ha accesso al DB.
  if (outOfRange.rows > 0) {
    const detail = Object.entries(outOfRange.byColumn)
      .map(([column, n]) => `${column} ×${n}`)
      .join(', ');
    console.log(pc.yellow(`  Out-of-range:  ${outOfRange.rows} restored score row(s) exceed their own per-dimension cap (${detail})`));
    if (outOfRange.worst) {
      const { column, value, max } = outOfRange.worst;
      console.log(pc.yellow(`    worst: ${column} ${value} on a cap of ${max} — values kept as-is, nothing was rewritten`));
    }
  }
  if (urlConflicts.length > 0) {
    console.log(pc.yellow(`  URL conflicts: ${urlConflicts.length} cloud row(s) SKIPPED — the URL is already held by another local row; nothing was deleted:`));
    for (const c of urlConflicts.slice(0, 10)) {
      console.log(pc.yellow(`    legacy_id ${c.legacyId} skipped: url already held by local id ${c.localId}`));
    }
    if (urlConflicts.length > 10) {
      console.log(pc.yellow(`    ... and ${urlConflicts.length - 10} more`));
    }
  }
  console.log(pc.dim(`  Sync cursor reset to ${nowIso}`));
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
      headers: cloudSyncHeaders(token),
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

/**
 * Invalida best-effort i cursor legati alla precedente ownership epoch.
 * ENOENT e' un successo: quel flusso ripartira' gia' senza cursor. Gli altri
 * errori vengono restituiti al chiamante, perche' il claim remoto e' ormai
 * avvenuto e non va mascherato come fallito o ritentato automaticamente.
 */
async function invalidateCloudOwnershipCursors() {
  let removed = 0;
  const failed = [];
  for (const path of CLOUD_OWNERSHIP_CURSOR_FILES) {
    try {
      await unlink(path);
      removed += 1;
    } catch (err) {
      if (err?.code !== 'ENOENT') failed.push({ path, error: err.message });
    }
  }
  return { removed, failed };
}

/**
 * Claim esplicito del team per questo token. Senza --force conserva il lock
 * fresco di un altro device; con --force il server effettua atomicamente il
 * takeover e rende non autoritativo il token precedente.
 */
export async function handleClaim(options = {}) {
  const config = await loadCloudConfig();
  if (!config?.enabled || !config.base_url || !config.token) {
    console.error(pc.red('Cloud sync not enabled: claim requires pairing first.'));
    process.exitCode = 1;
    return;
  }

  const baseUrl = String(config.base_url).replace(/\/+$/, '');
  const deviceLabel =
    process.env.JHT_DEVICE_LABEL ||
    config.token_name ||
    (process.env.IS_CONTAINER === '1' ? 'container' : 'cli');

  let res;
  let body;
  try {
    res = await fetch(`${baseUrl}/api/team-state/claim`, {
      method: 'POST',
      headers: cloudSyncHeaders(config.token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        force: options.force === true,
        device_label: deviceLabel,
      }),
    });
    body = await res.json().catch(() => ({}));
  } catch (err) {
    console.error(pc.red(`Claim failed due to a network error: ${err.message}`));
    process.exitCode = 1;
    return;
  }

  if (!res.ok) {
    if (res.status === 409 && body.error === 'device_already_claimed') {
      console.error(
        pc.yellow(
          `Claim held by device ${body.current_device_id ?? 'unknown'}` +
          (Number.isFinite(body.heartbeat_age_seconds)
            ? ` (heartbeat ${body.heartbeat_age_seconds}s ago).`
            : '.')
        )
      );
      console.error(
        pc.dim(
          `  claimed_at: ${body.claimed_at ?? 'unknown'}\n` +
          `  To take control now: jht cloud claim --force`
        )
      );
      process.exitCode = 2;
      return;
    }
    console.error(
      pc.red(`Claim failed (HTTP ${res.status}): ${body.error || 'unknown error'}`)
    );
    process.exitCode = 1;
    return;
  }

  const claimedDeviceId = body.claimed_device_id ?? body.state?.active_device_id ?? 'unknown';
  const evictedDeviceId = body.evicted_device_id ?? null;
  console.log(pc.green('✓ Team claim acquired'));
  console.log(pc.dim(`  active device: ${claimedDeviceId}`));

  if (!evictedDeviceId) {
    console.log(pc.dim('  No device was evicted; the claim was free or already belonged to this device.'));
    return;
  }

  console.log(pc.yellow(`  Previous device evicted: ${evictedDeviceId}`));
  const invalidated = await invalidateCloudOwnershipCursors();
  console.log(
    pc.dim(
      `  Local cursors invalidated: ${invalidated.removed}; the next sync will start without previous cursors.`
    )
  );
  for (const failure of invalidated.failed) {
    console.error(pc.yellow(`  warn: cursor not removed (${failure.path}): ${failure.error}`));
  }
  if (invalidated.failed.length > 0) process.exitCode = 1;
}

// Protocollo stretto per la UI nativa. Il prefisso rende gli eventi
// riconoscibili anche quando docker/ssh aggiungono banner o CR da pseudo-TTY;
// il payload non contiene mai device_code, user_code, token o user_id.
export const CLOUD_LOGIN_UI_PREFIX = 'JHT_CLOUD_UI ';

function emitCloudLoginUi(options, event, details = {}) {
  if (!options.uiJson) return;
  console.log(`${CLOUD_LOGIN_UI_PREFIX}${JSON.stringify({ event, ...details })}`);
}

function failCloudLogin(options, event, humanMessage) {
  emitCloudLoginUi(options, event);
  if (!options.uiJson) console.error(pc.red(humanMessage));
  process.exitCode = 1;
}

export async function handleLogin(options = {}) {
  const baseUrl = (options.url || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const initUrl = `${baseUrl}/api/cloud-sync/device-init`;

  // 1. Init: chiede al server una coppia (device_code, user_code).
  if (!options.uiJson) console.log(pc.dim(`Starting pairing at ${baseUrl}…`));
  let init;
  try {
    const res = await fetch(initUrl, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      failCloudLogin(
        options,
        'init_failed',
        `Pairing initialization failed (HTTP ${res.status}): ${body.error || 'unknown error'}`
      );
      return;
    }
    init = body;
  } catch (err) {
    failCloudLogin(options, 'network_error', `Network error: ${err.message}`);
    return;
  }

  if (!init.device_code || !init.user_code || !init.verification_url) {
    failCloudLogin(
      options,
      'invalid_response',
      'Malformed server response: device_code, user_code, or verification_url is missing.'
    );
    return;
  }
  // La UI non mostra un codice separato: senza URL completo non puo' offrire
  // il percorso browser-first senza regredire al copia/incolla da terminale.
  if (options.uiJson && !init.verification_url_complete) {
    failCloudLogin(
      options,
      'invalid_response',
      'Malformed server response: verification_url_complete is missing.'
    );
    return;
  }

  emitCloudLoginUi(options, 'ready', {
    url: init.verification_url_complete,
    expires_in: init.expires_in ?? 600,
  });

  // 2. Mostra istruzioni all'utente.
  const tokenNameHint = options.name ? ` (suggested token name: "${options.name}")` : '';
  if (!options.uiJson) {
    console.log('');
    console.log(pc.bold(`Open this URL in your browser:`));
    console.log(`  ${pc.cyan(init.verification_url)}`);
    if (init.verification_url_complete) {
      console.log(pc.dim(`  (direct link with prefilled code: ${init.verification_url_complete})`));
    }
    console.log('');
    console.log(pc.bold(`Code to type:`));
    console.log(`  ${pc.green(pc.bold(init.user_code))}${tokenNameHint}`);
    console.log('');
    console.log(pc.dim(`Waiting for confirmation… (TTL ~${Math.round((init.expires_in ?? 600) / 60)} min; polling every ${init.interval ?? 2}s)`));
    console.log(pc.dim(`Press Ctrl+C to cancel.`));
  }

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
      emitCloudLoginUi(options, 'network_retry');
      if (!options.uiJson) {
        console.error(pc.yellow(`  ⚠ transient polling error: ${err.message}; retrying...`));
      }
      continue;
    }
    const body = await res.json().catch(() => ({}));

    if (res.status === 202 && body.status === 'pending') continue;
    if (res.status === 410) {
      failCloudLogin(
        options,
        body.status === 'consumed' ? 'already_used' : 'expired',
        `\nSession ${body.status || 'expired'}. Restart 'jht cloud login'.`
      );
      return;
    }
    if (res.status === 404) {
      failCloudLogin(
        options,
        'not_found',
        `\nSession not found on the server. Restart 'jht cloud login'.`
      );
      return;
    }
    if (!res.ok) {
      failCloudLogin(
        options,
        'poll_failed',
        `\nPoll error (HTTP ${res.status}): ${body.error || 'unknown error'}`
      );
      return;
    }
    if (body.status === 'approved' && body.token) {
      approved = body;
      break;
    }
    // Status sconosciuto: log e continua, conservativo.
    if (!options.uiJson) {
      console.error(pc.yellow(`  ⚠ unexpected polling status: ${body.status || 'undefined'}; continuing...`));
    }
  }

  if (!approved) {
    failCloudLogin(
      options,
      'timeout',
      `\nPairing timeout (${Math.round((init.expires_in ?? 600) / 60)} min). Restart 'jht cloud login'.`
    );
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
  emitCloudLoginUi(options, 'paired', {
    token_name: approved.token_name ?? null,
  });

  if (!options.uiJson) {
    console.log('');
    console.log(pc.green(`✓ Pairing completed`));
    console.log(pc.dim(`  Base URL:   ${baseUrl}`));
    console.log(pc.dim(`  Token name: ${approved.token_name ?? 'unnamed'}`));
    console.log(pc.dim(`  User ID:    ${approved.user_id}`));
    console.log(pc.dim(`  File:       ${CLOUD_FILE} (0600)`));
  }

  // Single-team preflight: se un altro device ha già il claim (heartbeat
  // < 5min), warn l'utente. Non blocca il login: l'utente potrebbe volere
  // forzare l'eviction. Vedi vps.md:392 "un solo team JHT per utente".
  const conflict = await checkActiveDeviceConflict(baseUrl, approved.token);
  // Il preflight resta utile al CLI umano, ma nella corsia UI il processo è
  // un protocollo: niente active_device_id o altri dettagli tecnici nel pipe.
  if (conflict.conflict && !options.uiJson) {
    console.log('');
    console.log(
      pc.yellow(
        `⚠ Another device holds the team claim (heartbeat ${conflict.age_seconds}s ago).`
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
        `  If you start the team here, the old device will be evicted (with notification). ` +
        `To test in parallel without conflicts, turn off the other container first.`
      )
    );
  }

  // [JHT-CLOUD-RESTORE] T-029 — DB locale VUOTO → restore automatico; DB con
  // dati → push. Mai entrambi. Il gancio e' UNO, in `maybeBootstrapRestore`.
  if (await maybeBootstrapRestore(options)) return;

  if (options.noPush) {
    if (!options.uiJson) {
      console.log('');
      console.log(pc.dim(`Initial push skipped (--no-push). Run: jht cloud push`));
    }
    return;
  }
  try {
    await stat(JHT_DB_PATH);
  } catch {
    if (!options.uiJson) {
      console.log('');
      console.log(pc.dim(`No local database yet (${JHT_DB_PATH}). Initial push skipped.`));
      console.log(pc.dim(`Start the team with 'jht team start' and then 'jht cloud push'.`));
      console.log(pc.dim(`To pull existing cloud data instead: 'jht cloud restore --confirm-restore' (once the schema exists).`));
    }
    return;
  }
  if (!options.uiJson) {
    console.log('');
    console.log(pc.dim('Syncing local data to the cloud...'));
  }
  const prevExitCode = process.exitCode;
  await handlePush({});
  if (process.exitCode === 1) {
    console.log(pc.yellow(`  Pairing OK but initial push failed. Recover: jht cloud push`));
    process.exitCode = prevExitCode;
  }
}

async function handleStatus() {
  const config = await loadCloudConfig();
  if (!config || !config.enabled) {
    console.log(pc.dim('Cloud sync: ') + pc.yellow('disabled'));
    console.log(pc.dim('Enable with: ') + pc.bold('jht cloud enable --token jht_sync_xxx'));
    return;
  }
  console.log(pc.dim('Cloud sync: ') + pc.green('enabled'));
  console.log(pc.dim('Base URL:   ') + config.base_url);
  console.log(pc.dim('Token name: ') + (config.token_name ?? 'unnamed'));
  console.log(pc.dim('User ID:    ') + config.user_id);
  console.log(pc.dim('Enabled at: ') + config.enabled_at);

  // Telemetria che questo box dichiara a ogni chiamata cloud-sync. È qui
  // perché chi la produce deve poterla rileggere: raccogliere un dato che il
  // suo soggetto non può vedere è esattamente ciò che non vorremmo su di noi.
  const identity = clientIdentity();
  console.log('');
  console.log(pc.dim('Declared to the cloud on every call (technical telemetry only):'));
  console.log(pc.dim('  Version:      ') + identity.version);
  console.log(pc.dim('  Platform:     ') + identity.platform);
  console.log(pc.dim('  Capabilities: ') + identity.capabilities.join(', '));

  const periodic = readPeriodicPushState();
  console.log('');
  console.log(pc.dim('Automatic full push: ') + periodicPushStatusLine(periodic));
  if (periodic.consecutive_failures > 0) {
    console.log(
      pc.yellow(
        `  ${periodic.consecutive_failures} consecutive failure(s); the daemon retries automatically.`,
      ),
    );
  }
}

function handleQuarantineList(options = {}) {
  const entries = activeQuarantineEntries(readCloudPushQuarantine());
  if (options.json) {
    console.log(JSON.stringify({ quarantined: entries }, null, 2));
    return;
  }
  if (entries.length === 0) {
    console.log(pc.green('No active cloud push quarantines.'));
    return;
  }
  console.log(pc.yellow(`${entries.length} cloud push record(s) quarantined:`));
  for (const entry of entries) {
    console.log(
      `  ${entry.identity} · ${entry.table} · ${entry.reason} · attempts ${entry.attempts} · ${entry.last_failed_at}`
    );
  }
}

async function handleQuarantineRetry(identity, options = {}) {
  const result = requestQuarantineRetry(identity);
  if (result.changed === 0) {
    console.error(pc.red(`No active quarantine matches ${identity}.`));
    process.exitCode = 1;
    return;
  }
  console.log(pc.yellow(`${result.changed} quarantine record(s) queued for verified retry.`));
  if (!options.push) return;
  await handlePush({});
}

function handleQuarantineResolve(identity, options = {}) {
  if (!options.confirm) {
    console.error(pc.red('Resolution requires --confirm after the local cause has been removed.'));
    process.exitCode = 1;
    return;
  }
  const result = resolveQuarantine(identity);
  if (result.changed === 0) {
    console.error(pc.red(`No active quarantine matches ${identity}.`));
    process.exitCode = 1;
    return;
  }
  console.log(pc.green(`Resolved quarantine ${identity}; audit metadata retained.`));
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
    writePrivateJson(CLOUD_CURSOR_FILE, cursor);
    return true;
  } catch (err) {
    console.error(pc.yellow(`  warn: cursor save failed (${err.message})`));
    return false;
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
/** Cursor over rows whose outcome is durable (ACK or persisted quarantine). */
function settledCursor(rows, field) {
  let max = null;
  for (const r of rows) {
    const v = r?.[field];
    if (!v) continue;
    if (max === null || v > max) max = v;
  }
  return max;
}

async function performPush(options) {
  const config = await loadCloudConfig();
  if (!config || !config.enabled) {
    console.error(pc.red('Cloud sync is not enabled.'));
    console.error(pc.dim('Enable with: ') + pc.bold('jht cloud enable --token jht_sync_xxx'));
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
    console.error(pc.red(`Database not found: ${dbPath}`));
    console.error(pc.dim('Start the team at least once or pass --db <path>'));
    process.exitCode = 1;
    return { ok: false, authFailed: false, skipped: 0 };
  }

  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    console.error(pc.red('node:sqlite not available (requires Node 22.5+).'));
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
  const quarantinePath = options.quarantinePath || CLOUD_PUSH_QUARANTINE_FILE;
  let quarantineState = readCloudPushQuarantine(quarantinePath);
  const retryingTables = retryTables(quarantineState);
  // Cursor delta-sync: ad ogni tick leggiamo solo righe con updated_at >
  // ultimo pushato per quella tabella. Prima volta (cursor vuoto): full
  // read. Dopo push HTTP 200: aggiorniamo cursor con MAX(updated_at)
  // delle righe pushate.
  const cursor = options.full ? {} : loadCloudCursor();
  const readCursor = { ...cursor };
  for (const table of retryingTables) {
    const cursorKey = table === 'position_transitions' ? 'transitions' : table;
    delete readCursor[cursorKey];
  }
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
      ], readCursor.positions);
      scores = readSqliteTableDelta(db, 'scores', [
        'position_id', 'total_score', 'experience_fit', 'salary_fit',
        'stack_match', 'remote_fit', 'strategic_fit', 'breakdown', 'notes',
        'scored_by', 'scored_at',
      ], readCursor.scores);
      const applicationCols = [
        'position_id', 'cv_path', 'cv_pdf_path', 'cl_path', 'cl_pdf_path',
        'status', 'critic_score', 'critic_verdict', 'critic_notes',
        'written_at', 'applied_at', 'applied_via', 'response', 'response_at',
        'written_by', 'reviewed_by', 'critic_reviewed_at', 'applied',
        'cv_drive_id', 'cl_drive_id',
      ];
      // Compatibilita' con un DB che non e' ancora passato da ensure_schema:
      // il push continua con i campi disponibili e non rompe il daemon.
      if (sqliteHasColumn(db, 'applications', 'critic_round')) {
        applicationCols.push('critic_round');
      }
      applications = readSqliteTableDelta(db, 'applications', applicationCols, readCursor.applications);
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
      companies = readSqliteTableDelta(db, 'companies', companyCols, readCursor.companies);
      highlights = readSqliteTableDelta(db, 'position_highlights', [
        'id', 'position_id', 'type', 'text',
      ], readCursor.position_highlights);
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
      const hasCloudLegacyId = sqliteHasColumn(db, 'pending_user_messages', 'cloud_legacy_id');
      if (hasCloudLegacyId) msgCols.push('cloud_legacy_id');
      pendingMessages = readSqliteTable(db, 'pending_user_messages', msgCols);
      // Un turno nato sul web arriva qui con un id LOCALE, ma sul cloud
      // esiste già con la sua identità (legacy_id negativo). Rimandarlo
      // com'è lo ripubblicava come riga nuova: era questo percorso — non la
      // corsia veloce, che salta le righe già sincronizzate — a creare i
      // gemelli (O-16). Su un DB più vecchio del codice la colonna non c'è:
      // si comporta come prima, nessuna riga cambia identità.
      if (hasCloudLegacyId) {
        pendingMessages = pendingMessages.map((m) => {
          if (!Number.isFinite(m.cloud_legacy_id)) return m;
          const { cloud_legacy_id: cloudId, ...rest } = m;
          return { ...rest, id: cloudId };
        });
      }
      // Tombstones delta (SQLite V7): righe (table_name, legacy_id,
      // deleted_at) accumulate dai trigger BEFORE DELETE. Filtro per
      // deleted_at > cursor → solo le nuove cancellazioni nel tick.
      // Lato server, il receive le interpreta come UPDATE soft
      // SET deleted_at = ?. Vedi mig 025 + _migrate_v6_to_v7_tombstones.
      try {
        if (readCursor.tombstones) {
          tombstones = db.prepare(
            `SELECT table_name, legacy_id, deleted_at
             FROM _tombstones WHERE deleted_at > ?`
          ).all(readCursor.tombstones);
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
        if (readCursor.transitions) {
          transitions = db.prepare(
            `SELECT ${tCols} FROM position_state_transitions
             WHERE ts > ? ORDER BY ts ASC`
          ).all(readCursor.transitions);
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
      console.error(pc.red(`SQLite Reading Error: ${err.message}`));
      process.exitCode = 1;
      return { ok: false, authFailed: false, skipped: 0 };
    }
  }

  // Preserve the complete ordered source for cursor checkpoints. Active
  // quarantine rows are held out of the convoy; retry rows re-enter it after
  // a restart even when the table cursor had already advanced past them.
  const cursorRows = {
    companies,
    positions,
    scores,
    applications,
    position_highlights: highlights,
    position_transitions: transitions,
    tombstones,
  };
  const held = {};
  const partition = (table, rows) => {
    const result = partitionQuarantinedRows(table, rows, quarantineState);
    held[table] = result.held;
    return result.send;
  };
  companies = partition('companies', companies);
  positions = partition('positions', positions);
  scores = partition('scores', scores);
  applications = partition('applications', applications);
  highlights = partition('position_highlights', highlights);
  transitions = partition('position_transitions', transitions);
  tombstones = partition('tombstones', tombstones);
  pendingMessages = partition('pending_user_messages', pendingMessages);
  const profilePartition = profilePayload
    ? partitionQuarantinedRows('profile', [profilePayload], quarantineState)
    : { send: [], held: [] };
  held.profile = profilePartition.held;
  const sendProfile = profilePartition.send[0] || null;

  const profileChunks = sendProfile
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
    console.log(pc.yellow('--dry-run: nothing is pushed.'));
    // Nessun invio reale → non è un "sync completato": il chiamante non deve
    // ackare. (Il rendezvous "Sync now" non usa mai dryRun.)
    return { ok: false, authFailed: false, skipped: 0, dryRun: true };
  }
  if (
    positions.length === 0 && scores.length === 0 &&
    applications.length === 0 && companies.length === 0 &&
    highlights.length === 0 && pendingMessages.length === 0 &&
    tombstones.length === 0 && transitions.length === 0 && !sendProfile
  ) {
    console.log(pc.yellow('No data to sync.'));
    const unresolved = activeQuarantineEntries(quarantineState).length;
    return {
      ok: true,
      authFailed: false,
      skipped: unresolved,
      quarantined: unresolved,
      nothingToSync: true,
    };
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
  const authHeaders = cloudSyncHeaders(config.token, { 'Content-Type': 'application/json' });
  // Chunk iniziali per tabella (il halving 413 scende sotto se serve). Scelti
  // per stare comodamente sotto il body-limit tipico (~4MB Vercel): le
  // positions sono le righe più pesanti (jd_text/jd_summary), quindi il chunk
  // più piccolo. Override via env per il drain di emergenza.
  const POS_CHUNK = Math.max(1, parseInt(process.env.JHT_PUSH_POS_CHUNK || '75', 10) || 75);
  const ROW_CHUNK = Math.max(1, parseInt(process.env.JHT_PUSH_ROW_CHUNK || '250', 10) || 250);

  async function postBatch(payload) {
    try {
      const r = await fetch(pushUrl, {
        method: 'POST',
        headers: authHeaders,
        signal: options.signal,
        body: JSON.stringify(payload),
      });
      const b = await r.json().catch(() => ({}));
      return { status: r.status, ok: r.ok, body: b };
    } catch (err) {
      const name = String(err?.name || '').toLowerCase();
      const timedOut = name.includes('timeout') || err?.name === 'AbortError';
      return { status: 0, ok: false, body: {}, network: true, timedOut };
    }
  }

  const outcome = {
    aborted: false, authFailed: false, timedOut: false, requests: 0,
    quarantinedNew: 0,
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

  const safeServerCode = (body) =>
    typeof body?.error === 'string' && /^[a-z0-9][a-z0-9_:-]{0,119}$/.test(body.error);
  const canIsolate = (res) => {
    if (res.network || res.timedOut) return false;
    if ([401, 403, 429].includes(res.status)) return false;
    if (res.status === 409 && res.body?.error === 'not_active_device') return false;
    if (res.status === 413 || [400, 409, 422].includes(res.status)) return true;
    return res.status >= 500 && res.status < 600 && safeServerCode(res.body);
  };

  // Bisection makes a final singleton attributable. Only a durable quarantine
  // record lets the convoy continue; transport/rate/auth failures remain
  // table-wide and never blame a row.
  async function sendChunked(table, items, chunkSize, build) {
    const confirmed = [];
    const quarantined = [];
    if (!items.length || outcome.aborted) return { confirmed, quarantined };
    for (let base = 0; base < items.length && !outcome.aborted; base += chunkSize) {
      const queue = [[base, Math.min(base + chunkSize, items.length)]];
      while (queue.length && !outcome.aborted) {
        const [s, e] = queue.shift();
        if (s >= e) continue;
        let res = await postBatch(build(items.slice(s, e)));
        outcome.requests += 1;
        const accepted = res.body?.accepted?.[table];
        if (res.ok && Number.isInteger(accepted) && accepted !== e - s) {
          res = { status: 422, ok: false, body: { error: 'acknowledgement_mismatch' } };
        }
        if (res.ok) {
          const rows = items.slice(s, e);
          try {
            resolveConfirmedRetries(table, rows, { path: quarantinePath });
          } catch {
            outcome.aborted = true;
            console.error(pc.red('Push quarantine acknowledgement could not be persisted; cursor unchanged.'));
            return { confirmed, quarantined };
          }
          addUp(res.body);
          confirmed.push(...rows);
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          outcome.aborted = true; outcome.authFailed = true;
          console.error(pc.red(`Push auth failed (HTTP ${res.status}).`));
          return { confirmed, quarantined };
        }
        if (canIsolate(res) && e - s > 1) {
          const mid = s + Math.floor((e - s) / 2);
          queue.unshift([mid, e]);
          queue.unshift([s, mid]);
          continue;
        }
        if (canIsolate(res)) {
          const reason = sanitizedQuarantineReason(res.status, res.body);
          try {
            const identity = quarantineRow({
              table, row: items[s], reason, path: quarantinePath,
            });
            quarantined.push(items[s]);
            outcome.quarantinedNew += 1;
            console.error(pc.yellow(
              `Cloud push quarantined ${table}/${identity} (${reason}); the remaining convoy continues.`
            ));
            continue;
          } catch {
            outcome.aborted = true;
            console.error(pc.red('Cloud push quarantine could not be persisted; cursor unchanged.'));
            return { confirmed, quarantined };
          }
        }

        outcome.aborted = true;
        if (res.timedOut) outcome.timedOut = true;
        if (res.status === 409 && res.body.error === 'not_active_device') {
          console.error(pc.red('Push refused (HTTP 409 not_active_device): another device has the claim.'));
          console.error(pc.dim('  To regain control: jht cloud claim --force'));
        } else {
          const reason = sanitizedQuarantineReason(res.status, res.body);
          console.error(pc.red(`Push failed (${reason}); no row was quarantined.`));
        }
        return { confirmed, quarantined };
      }
    }
    return { confirmed, quarantined };
  }

  // Ordina cronologicamente (updated_at asc) così il cursore avanza sul
  // prefisso confermato senza scavalcare righe non inviate.
  const byAsc = (field) => (a, b) => {
    const x = a?.[field] || '', y = b?.[field] || '';
    return x < y ? -1 : x > y ? 1 : 0;
  };

  const checkpointCursor = { ...cursor };
  async function checkpointTable(table, cursorKey, sourceRows, result, field) {
    const settled = new Set([
      ...result.confirmed, ...result.quarantined, ...(held[table] || []),
    ]);
    const ordered = sourceRows.slice().sort(byAsc(field));
    const prefix = [];
    for (const row of ordered) {
      if (!settled.has(row)) break;
      prefix.push(row);
    }
    // Delta reads use `field > cursor`: never cross a timestamp shared with
    // an unsettled row, otherwise that row would be stranded forever.
    const blockedBoundary = ordered[prefix.length]?.[field] || null;
    const safePrefix = blockedBoundary
      ? prefix.filter((row) => row?.[field] < blockedBoundary)
      : prefix;
    const next = settledCursor(safePrefix, field);
    if (!next || (checkpointCursor[cursorKey] && next <= checkpointCursor[cursorKey])) return;
    checkpointCursor[cursorKey] = next;
    if (!(await saveCloudCursor(checkpointCursor))) {
      outcome.aborted = true;
      console.error(pc.red(
        `Push cursor checkpoint failed after ${table}; confirmed rows remain safe to retry.`
      ));
    }
  }

  // One table per request is what makes the final singleton attributable.
  const compRes = await sendChunked('companies', companies.slice().sort(byAsc('updated_at')), ROW_CHUNK, (r) => ({ companies: r }));
  await checkpointTable('companies', 'companies', cursorRows.companies, compRes, 'updated_at');
  const posRes = await sendChunked('positions', positions.slice().sort(byAsc('updated_at')), POS_CHUNK, (r) => ({ positions: r }));
  await checkpointTable('positions', 'positions', cursorRows.positions, posRes, 'updated_at');
  const scoreRes = await sendChunked('scores', scores.slice().sort(byAsc('updated_at')), ROW_CHUNK, (r) => ({ scores: r }));
  await checkpointTable('scores', 'scores', cursorRows.scores, scoreRes, 'updated_at');
  const appRes = await sendChunked('applications', applications.slice().sort(byAsc('updated_at')), ROW_CHUNK, (r) => ({ applications: r }));
  await checkpointTable('applications', 'applications', cursorRows.applications, appRes, 'updated_at');
  const hlRes = await sendChunked('position_highlights', highlights.slice().sort(byAsc('updated_at')), ROW_CHUNK, (r) => ({ position_highlights: r }));
  await checkpointTable('position_highlights', 'position_highlights', cursorRows.position_highlights, hlRes, 'updated_at');
  const transRes = await sendChunked('position_transitions', transitions.slice().sort(byAsc('ts')), ROW_CHUNK, (r) => ({ position_transitions: r }));
  await checkpointTable('position_transitions', 'transitions', cursorRows.position_transitions, transRes, 'ts');
  const tombRes = await sendChunked('tombstones', tombstones.slice().sort(byAsc('deleted_at')), ROW_CHUNK, (r) => ({ tombstones: r }));
  await checkpointTable('tombstones', 'tombstones', cursorRows.tombstones, tombRes, 'deleted_at');
  await sendChunked('pending_user_messages', pendingMessages, ROW_CHUNK, (r) => ({ pending_user_messages: r }));
  if (sendProfile) await sendChunked('profile', [sendProfile], 1, (r) => ({ profile: r[0] }));

  // ── Report + cursore ────────────────────────────────────────────────────
  if (outcome.aborted) {
    console.error(pc.yellow(
      `Push interrupted after ${outcome.requests} requests — confirmed checkpoints kept; retrying unsettled rows on the next tick.`
    ));
    process.exitCode = 1;
    return {
      ok: false,
      authFailed: outcome.authFailed,
      skipped: activeQuarantineEntries(readCloudPushQuarantine(quarantinePath)).length,
      timedOut: outcome.timedOut === true,
    };
  }

  console.log(pc.green(`✓ Push completed in ${outcome.requests} requests`));
  console.log(pc.dim(`  positions: ${outcome.up.positions} · scores: ${outcome.up.scores} · applications: ${outcome.up.applications} · companies: ${outcome.up.companies} · highlights: ${outcome.up.position_highlights} · pending: ${outcome.up.pending_user_messages} · tombstones: ${outcome.up.tombstones} · transitions: ${outcome.up.position_transitions}`));
  quarantineState = readCloudPushQuarantine(quarantinePath);
  const unresolved = activeQuarantineEntries(quarantineState).length;
  if (unresolved > 0) {
    console.error(pc.yellow(
      `⚠ ${unresolved} cloud push record(s) are quarantined; valid records were delivered. Run: jht cloud quarantine list`
    ));
  }
  return {
    ok: true,
    authFailed: false,
    skipped: unresolved,
    quarantined: unresolved,
    quarantinedNew: outcome.quarantinedNew,
  };
}

// Un solo writer locale→cloud per processo. Il daemon è l'owner dello
// scheduling, ma bootstrap e rendezvous Realtime possono svegliarlo insieme:
// entrambi passano da questa coda e non possono sovrapporre lettura cursor,
// upload e avanzamento cursor. Non è un secondo scheduler e non assembla un
// secondo payload: `performPush` resta l'unico producer.
export const handlePush = createExclusiveRunner(performPush);

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
    console.log(pc.dim('Cloud sync is already configured; pairing skipped. Use --force to pair again.'));
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
      console.error(pc.red(`No pairing token found at ${tokenPath}.`));
      console.error(pc.dim('The installer must have been run with --pairing-token.'));
      console.error(pc.dim('For manual pairing, run: jht cloud login'));
    } else {
      console.error(pc.red(`Reading error pairing-token: ${err.message}`));
    }
    process.exitCode = 1;
    return;
  }

  const payload = decodePairingToken(raw);
  if (!payload) {
    console.error(pc.red('pairing-token is corrupted or malformed.'));
    console.error(pc.dim(`File: ${tokenPath}`));
    process.exitCode = 1;
    return;
  }

  const deviceName = options.name || `vps-pairing-${new Date().toISOString().slice(0, 10)}`;
  const registerUrl = `${baseUrl}/api/cloud-sync/device-register`;
  console.log(pc.dim(`Register this device on ${registerUrl}…`));

  let res;
  try {
    res = await fetch(registerUrl, {
      method: 'POST',
      // Il device-register è l'unica creazione di token che parte dal box:
      // firmandola, la riga nasce già con la versione invece di restare
      // ignota fino al primo push. Nel device-flow (`jht cloud login`) il
      // token lo crea il browser, quindi lì la versione arriva alla prima
      // chiamata autenticata — pochi minuti dopo, col bootstrap push.
      headers: { 'Content-Type': 'application/json', 'X-JHT-Client': clientHeaderValue() },
      body: JSON.stringify({
        user_id: payload.user_id,
        refresh_token: payload.refresh_token,
        device_name: deviceName,
      }),
    });
  } catch (err) {
    console.error(pc.red(`Network error: ${err.message}`));
    process.exitCode = 1;
    return;
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(pc.red(`failed Pairing (HTTP ${res.status}): ${body.error || 'unknown error'}`));
    // 401 = refresh_token scaduto/revocato lato Supabase. Suggerisci la
    // via di uscita: re-pair dal desktop o passare a `jht cloud login`.
    if (res.status === 401) {
      console.error(pc.dim('The refresh_token may have expired. Generate a new pairing from the desktop launcher,'));
      console.error(pc.dim('or use the pairing browser-based: ') + pc.bold('jht cloud login'));
    }
    process.exitCode = 1;
    return;
  }

  if (!body.token || !body.user_id) {
    console.error(pc.red('Malformed server response: token or user_id is missing.'));
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

  console.log(pc.green('✓ Device registered with the cloud'));
  console.log(pc.dim(`  Base URL:   ${baseUrl}`));
  console.log(pc.dim(`  Token name: ${body.token_name ?? deviceName}`));
  console.log(pc.dim(`  User ID:    ${body.user_id}`));
  console.log(pc.dim(`  File:       ${CLOUD_FILE} (0600)`));
  console.log(pc.dim('  Pairing token deleted after use.'));

  // Single-team preflight: warn se un altro device ha già il claim active.
  const conflict = await checkActiveDeviceConflict(baseUrl, body.token);
  if (conflict.conflict) {
    console.log('');
    console.log(
      pc.yellow(
        `⚠ Another device holds the team claim (heartbeat ${conflict.age_seconds}s ago).`
      )
    );
    console.log(
      pc.dim(
        `  active_device_id: ${conflict.active_device_id?.slice(0, 12)}… ` +
        `— the applicant will wait for the expiry (5min) or an explicit eviction.`
      )
    );
  }
}

async function handleDisable(options = {}) {
  const config = await loadCloudConfig();
  if (!config) {
    console.log(pc.dim('Cloud sync is already disabled.'));
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
          headers: cloudSyncHeaders(config.token),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (res.ok) revoked = true;
      else revokeWarning = `remote revocation failed (HTTP ${res.status}: ${body.error || 'unknown error'})`;
    } catch (err) {
      revokeWarning = `remote revocation unavailable (${err.message})`;
    }
  }
  try {
    await unlink(CLOUD_FILE);
    console.log(pc.green('✓ Cloud sync disabled'));
    console.log(pc.dim('  Token removed from the local machine.'));
    if (revoked) {
      console.log(pc.dim('  Token also revoked on the server.'));
    } else if (options.localOnly) {
      console.log(pc.dim('  Remote revocation skipped (--local-only).'));
    } else if (revokeWarning) {
      console.log(pc.yellow(`  ⚠ ${revokeWarning}`));
      console.log(pc.dim('  Local sync is disabled. Revoke the token at ') +
        `${config.base_url || DEFAULT_BASE_URL}/settings/cloud-sync`);
    }
  } catch (err) {
    console.error(pc.red(`Error: ${err.message}`));
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
      console.error(pc.red('Cloud sync is not enabled.'));
      console.error(pc.dim('Enable with: ') + pc.bold('jht cloud enable --token jht_sync_xxx'));
    }
    process.exitCode = 1;
    return;
  }

  const dbPath = options.db || JHT_DB_PATH;
  const dbExists = await stat(dbPath).then(() => true).catch(() => false);
  if (!dbExists) {
    log(pc.dim(`  pull skip: Local SQLite not found (${dbPath}). Boot team first.`));
    return;
  }

  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    console.error(pc.red('node:sqlite not available (requires Node 22.5+).'));
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
        headers: cloudSyncHeaders(config.token),
      });
    } catch (err) {
      console.error(pc.yellow(`  pull warn: network error (${err.message})`));
      process.exitCode = 1;
      return;
    }
    body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(
        pc.yellow(
          `  pull warn: HTTP ${res.status} ${body.error || 'unknown error'}`
        )
      );
      process.exitCode = 1;
      return;
    }
  }

  const positions = Array.isArray(body.positions) ? body.positions : [];
  log(
    pc.dim(
      `Pull desired-state [since=${cursor.since || 'lookback-7d'}]: ${positions.length} Rows`
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
        log(pc.dim(`  ... +${positions.length - 10} Other rows`));
      }
    }
    log(pc.yellow('--dry-run: no UPDATE applied.'));
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
      console.log(pc.green(`✓ Web replies/acknowledgements applied locally: ${repliesApplied}`));
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
    console.error(pc.red(`UPDATE SQLite Error: ${err.message}`));
    process.exitCode = 1;
    return;
  }

  // Successo sostanziale loggato anche in `silent`: nel daemon vogliamo
  // sapere quando l'utente clicca via web e il pull ha applicato qualcosa
  // (segnale altrimenti invisibile, dato che il push container→cloud
  // riflette il proprio SQLite e farebbe da eco). Quando updated == 0
  // (tipico, no nuovi click) restiamo zitti se silent.
  const successMsg = pc.green(`✓ Desired-state pull applied: ${updated} positions updated`)
    + (excludeChanges > 0 ? pc.green(` (${excludeChanges} user exclusions synchronized)`) : '')
    + (missing > 0 ? pc.dim(` (${missing} legacy_id values not found locally; skipped)`) : '');
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
    log(pc.dim('  has_more=true: raise to recover the remaining rows'));
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
      console.error(pc.red('Cloud sync is not enabled.'));
      console.error(pc.dim('Enable with: ') + pc.bold('jht cloud login'));
    }
    process.exitCode = 1;
    return;
  }

  const dbPath = options.db || JHT_DB_PATH;
  const dbExists = await stat(dbPath).then(() => true).catch(() => false);
  if (!dbExists) {
    log(pc.dim(`  ticket-sync skip: Local SQLite not found (${dbPath}).`));
    return;
  }

  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    console.error(pc.red('node:sqlite not available (requires Node 22.5+).'));
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
      log(pc.dim('  ticket-sync skip: table position_tickets not yet created (team at first boot).'));
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
          { headers: cloudSyncHeaders(config.token) },
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
      const findActiveRescore = db.prepare(
        `SELECT id, cloud_id FROM position_tickets
         WHERE position_id = ? AND kind = 'rescore'
           AND status IN ('open','assigned')
         ORDER BY created_at ASC, id ASC LIMIT 1`
      );
      const linkActiveRescore = db.prepare(
        'UPDATE position_tickets SET cloud_id = ? WHERE id = ? AND cloud_id IS NULL'
      );
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
        if (ct.kind === 'rescore') {
          // Stessa richiesta nata offline su entrambe le superfici: conserva
          // una sola riga attiva e collegala all'identità cloud canonica.
          const active = findActiveRescore.get(posId);
          if (active) {
            if (active.cloud_id == null) linkActiveRescore.run(cloudId, active.id);
            if (!cursorFrozen && ct.created_at) safeCursor = ct.created_at;
            continue;
          }
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
          headers: cloudSyncHeaders(config.token, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ tickets: rows }),
        });
        const pb = await res.json().catch(() => ({}));
        // Anche un batch non-2xx può contenere INSERT confermati prima della
        // prima riga fallita. Correlali subito: il cursore resta fermo, ma al
        // retry quelle righe partiranno come UPDATE per cloud_id invece di
        // essere inserite una seconda volta (custom non ha UNIQUE naturale).
        if (pb.id_map && typeof pb.id_map === 'object') {
          const setCloud = db.prepare('UPDATE position_tickets SET cloud_id = ? WHERE id = ?');
          for (const [localId, cloudId] of Object.entries(pb.id_map)) {
            const ci = Number(cloudId);
            const li = Number(localId);
            if (Number.isInteger(ci) && Number.isInteger(li)) setCloud.run(ci, li);
          }
        }
        if (!res.ok) {
          console.error(pc.yellow(`  ticket push warn: HTTP ${res.status} ${pb.error || ''}`));
        } else {
          pushedUpdates = pb.updated || 0;
          pushedInserts = pb.inserted || 0;
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
    console.error(pc.red(`Error ticket-sync SQLite: ${err.message}`));
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
        `user request(s) from position pages: ${parts.join(' · ')}${more}. ` +
        `Forward them to the Capitano immediately as [REQ] PRIORITY (ticket-relay skill): ` +
        `user requests take priority.`;
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
        `✓ Ticket sync: ${imported} imported ↓, ${pushedUpdates} updated ↑, ${pushedInserts} inserted ↑`
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
      console.error(pc.red('Cloud sync is not enabled.'));
      console.error(pc.dim('Enable with: ') + pc.bold('jht cloud login'));
    }
    process.exitCode = 1;
    return;
  }

  const dbPath = options.db || JHT_DB_PATH;
  const dbExists = await stat(dbPath).then(() => true).catch(() => false);
  if (!dbExists) {
    log(pc.dim(`  directive-sync skip: Local SQLite not found (${dbPath}).`));
    return;
  }

  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    console.error(pc.red('node:sqlite not available (requires Node 22.5+).'));
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
      log(pc.dim('  directive-sync skipped: team_directives table has not been created yet (first team boot).'));
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
          { headers: cloudSyncHeaders(config.token) },
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
          headers: cloudSyncHeaders(config.token, { 'Content-Type': 'application/json' }),
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
    console.error(pc.red(`Error directive-sync SQLite: ${err.message}`));
    process.exitCode = 1;
    return;
  }

  await saveDirectivesCursor(cursor);

  const total = imported + pushedUpdates + pushedInserts;
  if (total > 0 || !silent) {
    console.log(
      pc.green(
        `✓ Directives sync: ${imported} from cloud↓, ${pushedUpdates} Add to cart , ${pushedInserts} New products`
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
export async function readRendezvousState(config, options = {}) {
  const silent = options.silent !== false;
  const baseUrl = (config.base_url || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const reader = options.reader !== undefined ? options.reader : getDirectReader(config);
  const fetchFn = options.fetchFn || fetch;
  const timeoutMs = Math.max(
    1,
    Number(options.timeoutMs ?? process.env.JHT_RENDEZVOUS_READ_TIMEOUT_MS ?? 15_000) || 15_000,
  );
  // Lo stesso budget copre direct moderno, direct legacy e fallback HTTP:
  // tre timeout consecutivi bloccherebbero il giro veloce e quindi anche chat.
  const signal = options.signal || AbortSignal.timeout(timeoutMs);
  const stopState = [
    'should_run', 'is_running',
    'emergency_stop_requested_at', 'emergency_stop_completed_at',
  ];
  const withChat = [
    'sync_requested_at', 'sync_completed_at',
    'last_action', 'last_action_at',
    'chat_requested_at', 'chat_delivered_at',
    ...stopState,
  ];
  const legacy = [
    'sync_requested_at', 'sync_completed_at',
    'last_action', 'last_action_at',
    ...stopState,
  ];

  if (reader) {
    try {
      return await reader.readTeamState(withChat, { signal });
    } catch {
      try {
        return await reader.readTeamState(legacy, { signal });
      } catch (err) {
        if (!silent) console.error(pc.yellow(`  rendezvous (direct) warn: ${err.message} — fallback Vercel`));
      }
    }
  }
  try {
    const res = await fetchFn(`${baseUrl}/api/team-state`, {
      headers: cloudSyncHeaders(config.token),
      signal,
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => ({}));
    return body.state || null;
  } catch (err) {
    if (!silent) console.error(pc.yellow(`  rendezvous warn: ${err.message}`));
    return null;
  }
}

export async function handleSyncRendezvous(options = {}) {
  const silent = options.silent === true;
  const config = options.config || (await loadCloudConfig());
  if (!config || !config.enabled) return { status: 'disabled' };
  const baseUrl = (config.base_url || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const reader = options.reader !== undefined ? options.reader : getDirectReader(config);
  const fetchFn = options.fetchFn || fetch;
  const pushFn = options.pushFn || handlePush;

  // Deadline condivisa da lettura, push e ACK. Se il chiamante ha già letto
  // la riga nel fast loop, lo stesso signal governa comunque il resto.
  const timeoutMs = Math.max(
    1_000,
    Number(options.timeoutMs ?? process.env.JHT_SYNC_REQUEST_TIMEOUT_MS ?? 120_000) || 120_000,
  );
  const signal = options.signal || AbortSignal.timeout(timeoutMs);

  const state = options.state !== undefined
    ? options.state
    : await readRendezvousState(config, { silent, reader, fetchFn, signal });
  if (!state) return { status: 'state_unavailable' };

  const reqAt = state.sync_requested_at || null;
  const doneAt = state.sync_completed_at || null;
  // Non confrontare le stringhe: PostgREST può rendere lo stesso fuso come
  // `Z` o `+00:00`, che hanno ordinamento lessicografico diverso.
  const pending = syncRendezvousPending(reqAt, doneAt);
  if (!pending) return { status: 'idle' };
  const terminal = syncRendezvousTerminal(reqAt, state.last_action, state.last_action_at);
  if (terminal) return { status: terminal, terminal: true };

  // Push fresco ORA (resta su Vercel in Fase 1). Isolato dal counter del daemon.
  const prev = process.exitCode;
  process.exitCode = 0;
  let pushResult;
  try {
    pushResult = await pushFn({ signal });
  } catch (error) {
    pushResult = { ok: false, timedOut: timeoutFailure(error), skipped: 0 };
  } finally {
    process.exitCode = prev;
  }

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
  const pushOutcome = pushRendezvousOutcome(pushResult);
  if (pushOutcome.status !== 'ready_to_ack') {
    if (!silent) {
      const why = pushResult && (pushResult.skipped || 0) > 0
        ? `${pushResult.skipped} skipped rows`
        : 'push failed';
      console.error(pc.yellow(`  sync-rendezvous: ACK not written (${why}) — the outcome was published; a new request is required to retry.`));
    }
    const published = await publishSyncOutcomeBestEffort(
      config, reqAt, pushOutcome.status, { fetchFn },
    );
    if (published.status === 'superseded') return published;
    return { ...pushOutcome, observed: published.status === 'published' };
  }

  // ACK compare-and-set: A può chiudere soltanto A, mai una B arrivata mentre
  // il push era in corso. I timestamp sono generati dal DB/server.
  const ack = await acknowledgeSync({
    fetchFn,
    url: `${baseUrl}/api/team-state/sync-observed`,
    token: config.token,
    expectedRequestedAt: reqAt,
    signal,
  });
  if (ack.status !== 'completed' && ack.status !== 'superseded') {
    const failure = ack.status === 'timeout' ? 'timeout' : 'ack_failed';
    const published = await publishSyncOutcomeBestEffort(
      config, reqAt, failure, { fetchFn },
    );
    if (published.status === 'superseded') return published;
    ack.observed = published.status === 'published';
  }
  if (!silent) {
    if (ack.status === 'completed') {
      console.log(pc.green(`✓ Sync now served: fresh push + ack (${ack.via})`));
    } else {
      console.error(pc.yellow(`  sync-rendezvous: ${ack.status}; not confirmed`));
    }
  }
  return ack;
}

/** Pubblicazione failure con budget indipendente dal push già scaduto. */
async function publishSyncOutcomeBestEffort(
  config,
  expectedRequestedAt,
  outcomeStatus,
  options = {},
) {
  const timeoutMs = Math.max(
    1,
    Number(options.timeoutMs ?? process.env.JHT_SYNC_OBSERVED_TIMEOUT_MS ?? 15_000) || 15_000,
  );
  const baseUrl = (config.base_url || DEFAULT_BASE_URL).replace(/\/+$/, '');
  return publishSyncOutcome({
    fetchFn: options.fetchFn || fetch,
    url: `${baseUrl}/api/team-state/sync-observed`,
    token: config.token,
    expectedRequestedAt,
    outcomeStatus,
    signal: options.signal || AbortSignal.timeout(timeoutMs),
  });
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
export async function handleChatSync(options = {}) {
  const silent = options.silent === true;
  const config = options.config || (await loadCloudConfig());
  if (!config || !config.enabled) return { status: 'disabled' };
  const dbPath = options.dbPath || process.env.JHT_DB || JHT_DB_PATH;
  const jhtHome = options.jhtHome || JHT_HOME;
  if (!existsSync(dbPath)) return { status: 'db_missing' };

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
  } catch {
    log('error', 'chat-sync: node:sqlite not available (sqlite_unavailable)');
    return { status: 'sqlite_unavailable' };
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
    const code = typeof err?.code === 'string' ? err.code : 'open_failed';
    log('error', `chat-sync: unable to open DB (${code})`);
    return { status: 'db_unavailable' };
  }
  // Le colonne arrivano da _db.py alla prima apertura di un agente: un
  // container non ancora ri-deployato non deve far esplodere il daemon.
  if (!sqliteHasColumn(db, 'pending_user_messages', 'author')) {
    db.close();
    return { status: 'schema_outdated' };
  }

  // Il canale col cloud: Supabase diretto se il flag opt-in è acceso,
  // altrimenti il token del box su /api/cloud-sync/chat. Il ramo diretto
  // resta preferito perché costa meno; quello Vercel è l'unico che esiste
  // sul fleet, dove `JHT_SUPABASE_DIRECT` è spento — vedi il perché disteso
  // in chat-sync.js, sopra `directChatChannel`.
  const reader = options.reader !== undefined ? options.reader : getDirectReader(config);
  const channel = options.channel !== undefined
    ? options.channel
    : chat.chatChannelFor(config, reader);
  let importedIds = [];
  let cloudRows = [];
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
        cloudRows = await channel.readUndeliveredUserChat({ limit: chat.CLOUD_CHAT_PULL_LIMIT });
        importedIds = chat.importCloudUserTurns(db, cloudRows, { jhtHome });
      } catch (err) {
        readError = chat.cloudRequestFailure(err);
        log('warn', `chat-sync: failed to read user turns (${readError})`);
      }
    }

    // ── 2/3. Mirror bidirezionale col file che legge il gioco ──────────
    const cursorFile = join(jhtHome, '.chat-mirror-cursor.json');
    const cursor = await chat.loadChatCursor(cursorFile);
    const ingested = chat.ingestChatJsonl(db, { jhtHome, cursor });
    if (JSON.stringify(ingested.cursor) !== JSON.stringify(cursor)) {
      await chat.saveChatCursor(cursorFile, ingested.cursor);
    }
    const mirrored = chat.mirrorDbTurnsToJsonl(db, { jhtHome });

    // ── 4. Consegna al pane ────────────────────────────────────────────
    const sent = await chat.deliverPendingUserTurns(db, { log, sendFn: options.sendFn });

    // ── 5. Push dei turni nuovi verso il cloud ─────────────────────────
    const toPush = chat.takeChatRowsToPush(db, { limit: 100 });
    let pushed = 0;
    if (toPush.length > 0) {
      const userId = config.user_id || null;
      const rows = toPush.map((r) => chat.toCloudRow(r, userId));
      const pushRowsFn = options.pushRowsFn || pushChatRows;
      const okIds = await pushRowsFn(config, rows, toPush.map((r) => r.id), log);
      chat.markChatRowsPushed(db, okIds);
      pushed = okIds.length;
    }

    // ── ACK delle sole righe consegnate + eventuale chiusura ───────────
    // Il pull (50) è più largo del budget di delivery (5): importare non
    // equivale a consegnare. Si marcano solo i gemelli con delivered_at e si
    // chiude la corsia soltanto quando non resta coda e sappiamo di aver
    // esaurito anche la pagina cloud.
    const queue = chat.undeliveredUserTurns(db);
    const deliveredCloudIds = chat.deliveredCloudUserTurnIds(db, cloudRows);
    const wholeCloudPageDelivered = deliveredCloudIds.length === cloudRows.length;
    const closeRendezvous = pending && !readError && sent.failed === 0 &&
      queue.count === 0 && wholeCloudPageDelivered &&
      cloudRows.length < chat.CLOUD_CHAT_PULL_LIMIT;
    let acked = false;
    let ackFailed = false;
    if (pending && channel && !readError && (deliveredCloudIds.length > 0 || closeRendezvous)) {
      try {
        const acknowledgement = await channel.acknowledgeDelivery(deliveredCloudIds, {
          closeRendezvous,
          expectedRequestedAt: state?.chat_requested_at ?? null,
        });
        acked = closeRendezvous && acknowledgement?.closed !== false;
      } catch (err) {
        ackFailed = true;
        log('warn', `chat-sync: failed delivery ack (${chat.cloudRequestFailure(err)})`);
      }
    }

    // ── Diagnosi: la corsia ha lavorato o è solo stata zitta? ──────────
    // Va DOPO tutti i passi, perché solo qui si sa cosa è davvero passato.
    // Non è gated da `silent`: è l'unico punto in cui un guasto della chat
    // può farsi vedere da fuori, e nel daemon `silent` è sempre true.
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
      uncertain: queue.uncertain,
    }));

    const moved = ingested.inserted + mirrored.mirrored + sent.delivered + pushed;
    if (!silent && (moved > 0 || mirrored.backfilled > 0)) {
      console.log(
        pc.green(
          `✓ Chat: ${ingested.inserted} from chat.jsonl↓, ${mirrored.mirrored} to chat.jsonl↑, ` +
          `${sent.delivered} delivered to the agent, ${pushed} pushed` +
          (mirrored.backfilled > 0 ? ` (${mirrored.backfilled} historical marked without spilling them)` : '')
        )
      );
    }
    return {
      status: readError
        ? readError
        : queue.uncertain > 0
          ? 'delivery_uncertain'
          : sent.failed > 0
            ? 'delivery_pending'
            : ackFailed
              ? 'ack_failed'
              : pending && !acked
                ? 'delivery_pending'
                : 'completed',
      pending: !!pending,
      imported: importedIds.length,
      delivered: sent.delivered,
      failed: sent.failed,
      pushed,
      acked,
    };
  } catch (err) {
    log('error', `chat-sync: cycle failed (${String(err?.code || err?.name || 'processing_error')})`);
    return { status: 'processing_error' };
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
export async function patchTeamStateBestEffort(config, reader, fields, options = {}) {
  const timeoutMs = Math.max(
    1,
    Number(options.timeoutMs ?? process.env.JHT_SYNC_OBSERVED_TIMEOUT_MS ?? 15_000) || 15_000,
  );
  const signal = options.signal || AbortSignal.timeout(timeoutMs);
  const fetchFn = options.fetchFn || fetch;
  if (reader) {
    try {
      await reader.patchTeamState(fields, { signal });
      return true;
    } catch { /* canale diretto rotto: si prova da Vercel */ }
  }
  const baseUrl = (config.base_url || DEFAULT_BASE_URL).replace(/\/+$/, '');
  try {
    const res = await fetchFn(`${baseUrl}/api/team-state`, {
      method: 'PATCH',
      headers: cloudSyncHeaders(config.token, { 'Content-Type': 'application/json' }),
      signal,
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
    console.log(pc.green(`✓ chat: lane again operational (was: ${chatLaneAlert.summary})`));
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
  const headers = cloudSyncHeaders(config.token, { 'Content-Type': 'application/json' });
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
      // Il CORPO, non solo lo stato: la route risponde 200 anche quando il
      // suo filtro ha scartato ogni riga e non ha scritto niente. Fidarsi
      // del 200 timbrava `cloud_synced_at` su righe mai arrivate, che non
      // venivano più riprovate — perdita silenziosa, non ritardo (O-16).
      let upserted = null;
      try {
        const payload = await r.json();
        const count = payload?.pending_user_messages?.upserted;
        if (typeof count === 'number') upserted = count;
      } catch {
        // Corpo illeggibile: sotto si tratta come esito ignoto.
      }
      res = { status: r.status, ok: r.ok, upserted };
    } catch (err) {
      log('warn', `chat push: rete (${err.message}) — the next round`);
      return ok;
    }
    if (res.ok) {
      const sent = e - s;
      // Conferma solo se la route dichiara di aver scritto TUTTE le righe
      // del chunk. Il conteggio non dice QUALI: confermarne una parte a caso
      // rischierebbe di timbrare proprio quella persa. Riprovare è gratis —
      // l'upsert è idempotente su (user_id, legacy_id).
      if (res.upserted === null) {
        log('warn', 'chat push: risposta senza conteggio — righe da riprovare');
        return ok;
      }
      if (res.upserted >= sent) {
        for (let i = s; i < e; i++) ok.push(ids[i]);
        continue;
      }
      log('warn',
        `chat push: ${res.upserted}/${sent} scritte — le altre restano da riprovare`);
      return ok;
    }
    if (res.status === 413 && e - s > 1) {
      const mid = s + Math.floor((e - s) / 2);
      queue.unshift([mid, e]);
      queue.unshift([s, mid]);
      continue;
    }
    if (res.status === 413) {
      log('error', `chat push: 413 on a single message (#${s}) — discarded, the rest continues`);
      ok.push(ids[s]);
      continue;
    }
    log('warn', `chat push: HTTP ${res.status} — the next round`);
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
        `  bootstrap-push closed (${decision.doneReason}) — from here on, the cloud only updates on request of the browser.`
      ));
    }
  }
  if (!decision.push) return decision;

  const attempt = (Number.isFinite(state.pushes) ? state.pushes : 0) + 1;
  if (!silent) {
    console.log(pc.dim(
      `  bootstrap-push ${attempt}/${limits.maxPushes} (${decision.reason}, phase=${phase}) — new accounts, I push without waiting for a browser.`
    ));
  }

  const prev = process.exitCode;
  process.exitCode = 0;
  const result = await handlePush(options.db ? { db: options.db } : {});
  process.exitCode = prev;

  await saveBootstrapState(nextBootstrapState({ state, now, signature, result }));

  if (!silent && result && result.authFailed === true) {
    console.error(pc.yellow('  bootstrap-push disabled (auth): invalid token; open the browser before retrying.'));
  }
  return { ...decision, result };
}

/**
 * Push automatico a regime (O-66). La policy legge soltanto una firma locale;
 * quando trova modifiche entra nello STESSO `handlePush` di bootstrap e
 * "Sync now", già serializzato da `createExclusiveRunner`.
 */
export async function maybePeriodicPush(options = {}) {
  const silent = options.silent === true;
  const now = options.now ?? Date.now();
  const limits = options.limits || periodicPushLimits();
  let state = options.state || readPeriodicPushState(options.statePath);
  const readSignature = options.readSignature || (async () => {
    let DatabaseSync = null;
    try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node < 22.5 */ }
    return DatabaseSync
      ? readLocalSignature(DatabaseSync, options.db || JHT_DB_PATH, options.profilePath || PROFILE_YAML_PATH)
      : null;
  });
  const save = options.save || ((next) => savePeriodicPushState(next, options.statePath));
  const pushFn = options.pushFn || handlePush;
  const readQuarantineCount = options.readQuarantineCount || (async () =>
    activeQuarantineEntries(readCloudPushQuarantine()).length);
  const quarantineCount = Number(await readQuarantineCount()) || 0;
  const previousQuarantineCount = Number(state.quarantined_count) || 0;
  let outcome;
  if (quarantineCount !== previousQuarantineCount) {
    state = {
      ...state,
      status: quarantineCount > 0 ? 'partial' : 'idle',
      quarantined_count: quarantineCount,
      last_check_at: new Date(now).toISOString(),
      last_reason: quarantineCount > 0 ? 'quarantine_detected' : 'quarantine_recovered',
      consecutive_failures: quarantineCount > 0
        ? Math.max(1, Number(state.consecutive_failures) || 0)
        : 0,
    };
    const persisted = await save(state);
    outcome = { push: false, reason: state.last_reason, state, persisted };
  } else {
    outcome = await runPeriodicPushCycle({
      now, limits, state, readSignature, save, signal: options.signal,
      push: async ({ signal }) => {
        const prev = process.exitCode;
        process.exitCode = 0;
        try {
          return await pushFn({ ...(options.db ? { db: options.db } : {}), signal });
        } finally {
          process.exitCode = prev;
        }
      },
    });
  }

  // Il browser non può vedere la firma SQLite. Pubblica soltanto l'esito
  // minimale del controllo, così distingue "nessuna novità" da "daemon
  // indietro" senza contatori, titoli o altri dati locali.
  const observation = periodicPushObservation(outcome);
  if (observation && options.publishObservation !== false) {
    const publish = typeof options.publishObservation === 'function'
      ? options.publishObservation
      : async (value) => {
        const config = options.config || (await loadCloudConfig());
        if (!config?.enabled) return false;
        // Passa dalla route token (non dal direct reader): lì vive il gate
        // active_device. Un vecchio box ancora acceso non può sovrascrivere
        // l'osservazione pubblicata dal device che possiede il claim.
        try {
          const res = await (options.fetchFn || fetch)(
            `${(config.base_url || DEFAULT_BASE_URL).replace(/\/+$/, '')}/api/team-state`,
            {
              method: 'PATCH',
              headers: cloudSyncHeaders(config.token, { 'Content-Type': 'application/json' }),
              signal: AbortSignal.timeout(10_000),
              body: JSON.stringify(value),
            }
          );
          return res.ok;
        } catch {
          return false;
        }
      };
    outcome.observationPublished = await publish(observation);
  }

  if (!silent && outcome.result && outcome.result.ok !== true) {
    console.error(pc.yellow(
      `  periodic-push ${outcome.state?.status || 'failed'}; retry automatico (${outcome.state?.consecutive_failures || 1} fallimenti consecutivi).`
    ));
  }
  return outcome;
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
    console.error(pc.red('Cloud sync is not enabled; the daemon cannot start.'));
    console.error(pc.dim('Enable with: ') + pc.bold('jht cloud login') + pc.dim(' (pairing browser)'));
    process.exitCode = 1;
    return;
  }

  console.log(pc.dim(`Cloud sync daemon: user readings→team every ${intervalSec}s (Supabase) + automatic full push bounded + "Sync now" → ${config.base_url}`));

  let running = true;
  const shutdown = (sig) => {
    if (!running) return;
    running = false;
    console.log(pc.dim(`\nReceived ${sig}; leaving the loop...`));
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
  // Il push automatico NON gira a ogni tick: la policy O-66 calcola la firma
  // locale al massimo ogni 15 minuti (retry a 1 minuto dopo un errore) e usa
  // lo stesso `handlePush` del rendezvous. Il fast loop resta una sola lettura
  // economica di team_state.
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
    console.log(pc.dim('Daemon stopped (event-driven).'));
    return;
  }

  while (running) {
    if (existsSync(WEEKLY_HALT_FLAG)) {
      if (haltSkipCount % heavyEvery === 0) {
        console.log(pc.dim(`  HALT-WEEKLY active (${WEEKLY_HALT_FLAG}) Sync suspended.`));
      }
      haltSkipCount += 1;
    } else {
      if (haltSkipCount > 0) {
        console.log(pc.green(`  HALT-WEEKLY removed, resume.`));
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
        console.error(pc.yellow('  daemon sync-rendezvous error (unexpected_failure)'));
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
        console.error(pc.yellow('  daemon chat-sync error (unexpected_failure)'));
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

        // ── Push automatico a regime (O-66) ──
        // La firma evita traffico quando nulla è cambiato; timeout, retry e
        // ultimo esito sono persistiti e leggibili da `jht cloud status`.
        try {
          await maybePeriodicPush({ silent: false, config });
        } catch (err) {
          console.error(pc.yellow(`  daemon periodic-push error: ${err.message}`));
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
  console.log(pc.dim('Daemon stopped.'));
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

  // [HALT-FLAG-IGNORED-BY-THE-EVENT-DRIVEN-LOOP] Il freno settimanale frenava
  // solo il loop a poll: qui compariva una volta sola, nella cadenza lenta, e
  // nessuna delle corsie event-driven lo guardava — così a freno tirato un
  // UPDATE su team_state faceva partire lo stesso rendezvous e push, cioè la
  // spesa che il flag esiste per fermare.
  //
  // Un cancello all'INGRESSO del ramo non basterebbe: il flag si alza a daemon
  // acceso (`touch` su un box che gira), e un controllo fatto solo all'avvio
  // non lo vedrebbe mai. Il punto giusto è il guscio che le corsie già
  // condividevano: chi ne aggiunge una quinta la fa nascere frenata.
  const haltGate = createHaltGate({
    isHalted: () => existsSync(WEEKLY_HALT_FLAG),
    onHalt: (lane) => console.log(pc.dim(
      `  HALT-WEEKLY active (${WEEKLY_HALT_FLAG}) Sync suspended.${lane ? ` [${lane}]` : ''}`
    )),
    onResume: () => console.log(pc.green('  HALT-WEEKLY removed, resume.')),
  });

  // Debounce per corsia: una raffica di eventi Realtime non deve lanciare letture
  // concorrenti sovrapposte (push o ticket-sync). Il freno sta nello stesso
  // guscio del debounce, non accanto a ogni chiamata.
  const runSync = guardedLane(haltGate, 'sync', async () => {
    await handleSyncRendezvous({ silent: true });
  }, () => console.error(pc.yellow('  sync-rendezvous error (unexpected_failure)')));

  const runTicketSync = guardedLane(haltGate, 'ticket', async () => {
    await handleTicketSync({ silent: true });
  }, (e) => console.error(pc.yellow(`  ticket-sync error: ${e.message}`)));
  // [JHT-CHAT-UNIFY] La chat ha DUE sorgenti: il cloud (turno scritto dal
  // web → evento su team_state) e il box stesso (l'agente che risponde con
  // `jht-send`, che non produce alcun evento remoto). Serve quindi sia
  // l'aggancio all'evento sia un battito locale corto — che però resta
  // gratis, perché ogni passo di handleChatSync ha una guardia locale.
  const runChatSync = guardedLane(haltGate, 'chat', async (_tag, state) => {
    await handleChatSync({ silent: true, config, state });
  }, () => console.error(pc.yellow('  chat-sync error (unexpected_failure)')));
  const chatLocalSec = Math.max(1, parseInt(process.env.JHT_CHAT_LOCAL_SEC || '5', 10) || 5);
  const chatTimer = setInterval(() => { void runChatSync('local', null); }, chatLocalSec * 1000);

  const runEmergencyStop = guardedLane(haltGate, 'emergency-stop', async (_tag, state) => {
    const { reconcileEmergencyStop } = await import('../lib/team-state-reconciler.js');
    await reconcileEmergencyStop(config, state);
  }, (e) => console.error(pc.yellow(`  emergency-stop error: ${e.message}`)));

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

    log('info', 'realtime ready (team_state + position_tickets) — sync/ticket via websocket + active parachute.');
  } catch (e) {
    console.error(pc.yellow(`  cloud-realtime failed setup (${e.message}) — degradation to parachute polls only.`));
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
    // Stesso cancello delle corsie: un solo predicato, un solo annuncio.
    if (haltGate('slow')) { await sleepTick(); tick += 1; continue; }

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
    try { await maybePeriodicPush({ silent: false, config }); }
    catch (e) { console.error(pc.yellow(`  periodic-push error: ${e.message}`)); }

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
export { handlePullDesiredState, handleTicketSync, handleDirectiveSync, handleRestore };

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
    log(pc.dim('cloud sync disabled — pull-profile skipped'));
    return;
  }
  const baseUrl = (config.base_url || '').replace(/\/+$/, '');
  const token = config.token;
  if (!baseUrl || !token) {
    if (!options.silent) console.error(pc.red('incomplete cloud config (base_url/token)'));
    return;
  }

  const profilePath = join(PROFILE_DIR, 'candidate_profile.yml');
  if (existsSync(profilePath) && !options.force) {
    log(pc.dim("local profile already present — skip (use --force to overwrite)"));
    return;
  }

  let res;
  try {
    res = await fetch(`${baseUrl}/api/cloud-sync/pull-profile`, {
      headers: cloudSyncHeaders(token),
    });
  } catch (err) {
    if (!options.silent) console.error(pc.red('pull-profile: network error'), err.message);
    return;
  }
  if (!res.ok) {
    if (!options.silent) console.error(pc.red(`pull-profile: HTTP ${res.status}`));
    return;
  }
  let data;
  try { data = await res.json(); } catch { data = null; }
  if (!data || !data.ok) {
    if (!options.silent) console.error(pc.red('pull-profile: ' + ((data && data.error) || 'invalid response')));
    return;
  }
  if (!data.configured || !data.yaml) {
    log(pc.dim('no cloud profile — nothing to download'));
    return;
  }

  await mkdir(PROFILE_DIR, { recursive: true });
  await writeFile(profilePath, data.yaml);
  log(pc.green('✓') + ` Profile downloaded from cloud -> ${profilePath}`);
}

export function registerCloudCommand(program) {
  const cloud = program
    .command('cloud')
    .description('Manage optional cloud sync: enable, status, disable');

  cloud
    .command('login')
    .description('Pairing browser-based: no manual token paste (recommended)')
    .option('--url <url>', `cloud base URL (default: ${DEFAULT_BASE_URL})`)
    .option('--name <name>', 'suggested web token name (for example, "vps-laptop")')
    .option('--ui-json', 'Emit safe machine-readable events for the native UI')
    .option('--no-push', 'Skip the initial push of local data (default: automatic push)')
    .action(handleLogin);

  // `pair` — non-interattivo: legge .pairing-token (salvato da install.sh
  // dopo il provisioning VPS) e si registra sul cloud come
  // device dell'utente. Pid1 lo invoca al primo boot del container su VPS.
  cloud
    .command('pair')
    .description('Pair non-interactively through .pairing-token (used by pid1 on the first VPS boot)')
    .option('--url <url>', `cloud base URL (default: ${DEFAULT_BASE_URL})`)
    .option('--name <name>', 'Name of the token on the web (default: vps-pairing-YYYY-MM-DD)')
    .option('--token-file <path>', `pairing-token path (default: ${PAIRING_TOKEN_FILE})`)
    .option('--force', 'pair again even when cloud.json already exists')
    .action(handlePair);

  cloud
    .command('enable')
    .description('Enable cloud sync with a token already generated by the web (manual paste)')
    .option('--token <token>', 'jht sync token (required)')
    .option('--url <url>', `cloud base URL (default: ${DEFAULT_BASE_URL})`)
    .option('--no-push', 'Skip the initial push of local data (default: automatic push)')
    .action(handleEnable);

  cloud
    .command('status')
    .description('Show cloud sync status')
    .action(handleStatus);

  cloud
    .command('claim')
    .description('Acquire the team claim for this device (use --force for a takeover)')
    .option('--force', 'evict the active device and invalidate previous local cursors')
    .action(handleClaim);

  cloud
    .command('push')
    .description('Synchronize local SQLite metadata to the cloud once')
    .option('--db <path>', 'SQLite database path (default: ~/.jht/jobs.db)')
    .option('--dry-run', 'Show what would be pushed without calling the cloud')
    .action(handlePush);

  const quarantine = cloud
    .command('quarantine')
    .description('Inspect and manage durable cloud push quarantines');
  quarantine
    .command('list')
    .description('List privacy-safe quarantine metadata')
    .option('--json', 'Print machine-readable metadata')
    .action(handleQuarantineList);
  quarantine
    .command('retry <identity>')
    .description('Retry one opaque identity, or all')
    .option('--no-push', 'Queue retry without starting a push now')
    .action(handleQuarantineRetry);
  quarantine
    .command('resolve <identity>')
    .description('Resolve one quarantine after removing the local cause')
    .requiredOption('--confirm', 'Confirm explicit resolution')
    .action(handleQuarantineResolve);

  // `bootstrap-status` — [CLOUDSYNC-PUSH-ONLY-WHEN-WATCHED] finestra sul push
  // del primo periodo di vita: quanti push restano, quando scade la finestra,
  // e cosa deciderebbe il daemon ADESSO. Sola lettura: non spinge nulla, così
  // si può interrogare anche su un box in produzione senza effetti.
  cloud
    .command('bootstrap-status')
    .description('Show first-period automatic-push state, remaining budget, and next decision')
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
      console.log(pc.bold('Bootstrap push (initial account period)'));
      console.log(`  first-run:   ${pc.bold(phase ?? 'unknown')} ${pc.dim(`(${FIRST_RUN_STATE_FILE})`)}`);
      console.log(`  status:      ${state.done === true ? pc.yellow(`closed (${state.done_reason ?? '?'})`) : pc.green('active')} ${pc.dim(`(${BOOTSTRAP_STATE_FILE})`)}`);
      console.log(`  pushes:      ${pushes}/${limits.maxPushes}`);
      console.log(`  cadence:     ${Math.round(limits.intervalMs / 1000)}s · window ${Math.round(limits.windowMs / 3600000)}h · last ${state.last_push_at ?? '—'}`);
      console.log(`  next action: ${decision.push ? pc.green(`PUSH (${decision.reason})`) : pc.dim(`none (${decision.reason})`)}`);
      if (!limits.enabled) console.log(pc.yellow('  JHT_CLOUD_BOOTSTRAP_PUSH=0 → disabled.'));
    });

  cloud
    .command('pull-desired-state')
    .description('Retrieve user-driven write_requested flags from the cloud into local SQLite')
    .option('--db <path>', 'SQLite database path (default: ~/.jht/jobs.db)')
    .option('--full', 'ignore cursors (server-side 7-day lookback)')
    .option('--limit <n>', 'maximum rows per call (default 500, max 2000)')
    .option('--dry-run', 'Show what would be applied without UPDATE')
    .option('--silent', 'Minimum output (for boot)')
    .action(handlePullDesiredState);

  cloud
    .command('chat-sync')
    .description('Run one chat cycle: chat.jsonl <-> SQLite, tmux-pane delivery, and cloud push')
    .action(async () => {
      const config = await loadCloudConfig();
      // A mano si vuole anche il PULL, non solo i passi locali: si legge la
      // riga team_state come farebbe il giro veloce del daemon.
      const state = config?.enabled ? await readRendezvousState(config, { silent: false }) : null;
      await handleChatSync({ silent: false, config, state });
    });

  cloud
    .command('sync-tickets')
    .description('Round-trip ticket cloud<->VPS: import user tickets, push team resolutions')
    .option('--db <path>', 'SQLite database path (default: ~/.jht/jobs.db)')
    .option('--full', 'ignore cursors (7-day pull lookback; push everything)')
    .option('--silent', 'Minimum output (for boot)')
    .action(handleTicketSync);

  cloud
    .command('sync-directives')
    .description('Round-trip board (team_directives) cloud<->VPS: import edits from dashboard, push local directives')
    .option('--db <path>', 'SQLite database path (default: ~/.jht/jobs.db)')
    .option('--full', 'ignore cursors (30-day pull lookback; push everything)')
    .option('--silent', 'minimal output (for boot)')
    .action(handleDirectiveSync);

  cloud
    .command('pull-profile')
    .description('Download cloud profile -> candidate_profile.yml (only-if-absent)')
    .option('--force', "Overwrites the local profile even if already present")
    .option('--silent', 'Minimum output (for boot)')
    .action(handlePullProfile);

  cloud
    .command('disable')
    .description('Stop sync, revoke the cloud token, and remove it from this device')
    .option('--local-only', 'remove the token from this device without revoking it on the server')
    .action(handleDisable);

  // `restore` — disaster recovery: ricostruisce SQLite locale (positions /
  // scores / applications) dallo snapshot cloud. Distinto da pull-desired-
  // state (merge dei flag) e da push (delta locale -> cloud). Conferma
  // esplicita interattiva, --confirm-restore per skip in CI.
  cloud
    .command('restore')
    .description('Rebuilds local SQLite from cloud snapshot (positions/scores/applications)')
    .option('--db <path>', 'SQLite database path (default: ~/.jht/jobs.db)')
    .option('--confirm-restore', 'skip interactive confirmation (required for CI or scripts)')
    .action(handleRestore);

  // `daemon` e' pensato come PID 1 del container su VPS: ciclo push
  // periodico finche' non riceve SIGTERM da docker stop. Cosi' i dati
  // scritti dagli agenti appaiono su jobhunterteam.ai senza che l'utente
  // lanci nulla a mano. Latency: <interval> secondi (default 60s, vedi
  // docs/sessions/2026-05-18-supabase-disk-io-investigation per il
  // motivo del cambio da 30s).
  cloud
    .command('daemon')
    .description('Continuous push loop (used as PID 1 of the container on VPS)')
    .option('--interval <sec>', 'Seconds between a push and the next (env JHT_CLOUD_PUSH_INTERVAL_SEC)')
    .action(handleDaemon);

  // `realtime-listen` — long-running WebSocket subscriber su Supabase
  // Realtime per ricevere comandi web in tempo reale (es. Start button
  // sulla dashboard cloud → INSERT team_commands → questo handler).
  // Co-spawnato da pid1 accanto a `cloud daemon`.
  cloud
    .command('realtime-listen')
    .description('Subscriber Realtime for team commands (start/stop) from the web')
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
    .description('Reconcile team_state desired state in parallel with realtime-listen')
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
    .description('Poll the file bridge index and upload CVs/attachments to the web on demand')
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
    .description('Check for another active team for this user (exit 0=free, 2=another active device)')
    .action(async () => {
      const config = await loadCloudConfig();
      if (!config?.enabled) {
        console.error(pc.red('Cloud sync is not enabled; preflight requires pairing first.'));
        process.exitCode = 1;
        return;
      }
      const baseUrl = (config.base_url || '').replace(/\/+$/, '');
      const conflict = await checkActiveDeviceConflict(baseUrl, config.token);
      if (!conflict.conflict) {
        console.log(pc.green('✓ No competing active team. Proceed freely.'));
        return;
      }
      console.log(
        pc.yellow(
          `⚠ Team already active on another device (heartbeat ${conflict.age_seconds}s ago).`
        )
      );
      console.log(
        pc.dim(
          `  active_device_id: ${conflict.active_device_id?.slice(0, 12)}…\n` +
          `  claimed_at:       ${conflict.claimed_at ?? 'unknown'}\n` +
          `  To evict it, start the container; the reconciler retries every 60s\n` +
          `  and will take the claim when the old device disappears (5min).`
        )
      );
      process.exitCode = 2;
    });
}
