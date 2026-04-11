import { readFile, writeFile, mkdir, chmod, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import pc from 'picocolors';
import { JHT_HOME } from '../jht-paths.js';

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
    .command('disable')
    .description('Rimuove il token dalla macchina locale (non revoca lato server)')
    .action(handleDisable);
}
