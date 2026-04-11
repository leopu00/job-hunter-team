import { readFile, writeFile, mkdir, chmod, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import pc from 'picocolors';
import { JHT_HOME, JHT_DB_PATH } from '../jht-paths.js';

const CLOUD_FILE = join(JHT_HOME, 'cloud.json');
const DEFAULT_BASE_URL = 'https://jobhunterteam.ai';

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

async function handlePush(options) {
  const config = await loadCloudConfig();
  if (!config || !config.enabled) {
    console.error(pc.red('Cloud sync non abilitato.'));
    console.error(pc.dim('Abilita con: ') + pc.bold('jht cloud enable --token jht_sync_xxx'));
    process.exitCode = 1;
    return;
  }

  const dbPath = options.db || JHT_DB_PATH;
  try {
    await stat(dbPath);
  } catch {
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
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    positions = readSqliteTable(db, 'positions', [
      'id', 'title', 'company', 'url', 'location', 'remote_type', 'status',
      'notes', 'source', 'jd_text', 'requirements', 'found_by', 'found_at',
      'deadline', 'last_checked',
      'salary_declared_min', 'salary_declared_max', 'salary_declared_currency',
      'salary_estimated_min', 'salary_estimated_max', 'salary_estimated_currency',
      'salary_estimated_source',
    ]);
    scores = readSqliteTable(db, 'scores', [
      'position_id', 'total_score', 'experience_fit', 'salary_fit',
      'stack_match', 'remote_fit', 'strategic_fit', 'breakdown', 'notes',
      'scored_by', 'scored_at',
    ]);
    applications = readSqliteTable(db, 'applications', [
      'position_id', 'cv_path', 'cv_pdf_path', 'cl_path', 'cl_pdf_path',
      'status', 'critic_score', 'critic_verdict', 'critic_notes',
      'written_at', 'applied_at', 'applied_via', 'response', 'response_at',
      'written_by', 'reviewed_by', 'critic_reviewed_at', 'applied',
      'cv_drive_id', 'cl_drive_id',
    ]);
    db.close();
  } catch (err) {
    console.error(pc.red(`Errore lettura SQLite: ${err.message}`));
    process.exitCode = 1;
    return;
  }

  console.log(
    pc.dim(
      `Payload: ${positions.length} positions, ${scores.length} scores, ${applications.length} applications`
    )
  );
  if (options.dryRun) {
    console.log(pc.yellow('--dry-run: nulla viene pushato.'));
    return;
  }
  if (positions.length === 0 && scores.length === 0 && applications.length === 0) {
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
      body: JSON.stringify({ positions, scores, applications }),
    });
  } catch (err) {
    console.error(pc.red(`Errore di rete: ${err.message}`));
    process.exitCode = 1;
    return;
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(
      pc.red(`Push fallito (HTTP ${res.status}): ${body.error || 'errore sconosciuto'}`)
    );
    process.exitCode = 1;
    return;
  }

  console.log(pc.green('✓ Push completato'));
  console.log(pc.dim(`  positions:    ${body.positions?.upserted ?? 0} upserted`));
  console.log(pc.dim(`  scores:       ${body.scores?.upserted ?? 0} upserted`));
  console.log(pc.dim(`  applications: ${body.applications?.upserted ?? 0} upserted`));
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

export function registerCloudCommand(program) {
  const cloud = program
    .command('cloud')
    .description('Gestione cloud sync (opt-in): enable, status, disable');

  cloud
    .command('enable')
    .description('Abilita cloud sync con un token generato dal web')
    .option('--token <token>', 'Token jht_sync_... (obbligatorio)')
    .option('--url <url>', `Base URL del cloud (default ${DEFAULT_BASE_URL})`)
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
}
