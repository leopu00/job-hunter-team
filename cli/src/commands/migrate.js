import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const JHT_DIR     = join(homedir(), '.jht');
const CONFIG_PATH = join(JHT_DIR, 'jht.config.json');

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function writeJsonSafe(p, data) {
  await mkdir(join(p, '..'), { recursive: true }).catch(() => {});
  const tmp = p + '.tmp';
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  const { rename } = await import('node:fs/promises');
  await rename(tmp, p);
}

// Migrazioni ordinate per versione
const MIGRATIONS = [
  {
    version: 2,
    name: 'Aggiunge campo version e providers strutturati',
    up(config) {
      if (!config.version) config.version = 2;
      if (!config.providers) config.providers = {};
      if (config.api_key && !config.providers.anthropic) {
        config.providers.anthropic = { api_key: config.api_key, model: config.model || 'claude-sonnet-4-20250514' };
        delete config.api_key; delete config.model;
      }
      return config;
    },
  },
  {
    version: 3,
    name: 'Aggiunge campo agents.list e channels',
    up(config) {
      config.version = 3;
      if (!config.agents) config.agents = {};
      if (!config.agents.list) config.agents.list = [];
      if (!config.channels) config.channels = {};
      return config;
    },
  },
  {
    version: 4,
    name: 'Aggiunge campo notifications e analytics',
    up(config) {
      config.version = 4;
      if (!config.notifications) config.notifications = { enabled: true, channels: [] };
      if (!config.analytics) config.analytics = { enabled: true, retention_days: 30 };
      return config;
    },
  },
];

async function handleMigrate(options) {
  if (!(await fileExists(CONFIG_PATH))) {
    console.error('  Config non trovata. Esegui: jht setup');
    process.exitCode = 1;
    return;
  }

  let config;
  try { config = JSON.parse(await readFile(CONFIG_PATH, 'utf-8')); }
  catch { console.error('  Config JSON non valido'); process.exitCode = 1; return; }

  const current = config.version || 1;
  const pending = MIGRATIONS.filter(m => m.version > current);

  if (pending.length === 0) {
    console.log(`\n  Config già aggiornata (versione ${current}). Nessuna migrazione necessaria.\n`);
    return;
  }

  console.log(`\n  Versione attuale: ${current}`);
  console.log(`  Migrazioni disponibili: ${pending.length}\n`);

  for (const m of pending) {
    console.log(`  → v${m.version}: ${m.name}`);
  }

  if (options.dryRun) {
    console.log('\n  (dry-run — nessuna modifica applicata)\n');
    return;
  }

  for (const m of pending) {
    config = m.up(config);
    console.log(`  ✓ v${m.version} applicata`);
  }

  await writeJsonSafe(CONFIG_PATH, config);
  console.log(`\n  Config aggiornata a versione ${config.version}\n`);
}

export function registerMigrateCommand(program) {
  program
    .command('migrate')
    .description('Esegui migrazioni config verso la versione corrente')
    .option('--dry-run', 'mostra migrazioni senza applicarle')
    .action(handleMigrate);
}
