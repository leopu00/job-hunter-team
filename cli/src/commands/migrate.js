import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { JHT_HOME } from '../jht-paths.js';
import { writePrivateJson } from '../lib/secure-config-io.js';

const JHT_DIR     = JHT_HOME;
const CONFIG_PATH = join(JHT_DIR, 'jht.config.json');

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function writeJsonSafe(p, data) {
  writePrivateJson(p, data);
}

// Migrazioni ordinate per versione
const MIGRATIONS = [
  {
    version: 2,
    name: 'Add version and structured providers fields',
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
    name: 'Add agents.list and channels fields',
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
    name: 'Add notifications and analytics fields',
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
    console.error('  Config not found. Run: jht setup');
    process.exitCode = 1;
    return;
  }

  let config;
  try { config = JSON.parse(await readFile(CONFIG_PATH, 'utf-8')); }
  catch { console.error('  Config JSON invalid'); process.exitCode = 1; return; }

  const current = config.version || 1;
  const pending = MIGRATIONS.filter(m => m.version > current);

  if (pending.length === 0) {
    console.log(`\n  Config already updated (version ${current}). No migration needed.\n`);
    return;
  }

  console.log(`\n  Current version: ${current}`);
  console.log(`  Migration available: ${pending.length}\n`);

  for (const m of pending) {
    console.log(`  → v${m.version}: ${m.name}`);
  }

  if (options.dryRun) {
    console.log('\n  (dry-run — no modification applied)\n');
    return;
  }

  for (const m of pending) {
    config = m.up(config);
    console.log(`  ✓ v${m.version} applied`);
  }

  await writeJsonSafe(CONFIG_PATH, config);
  console.log(`\n  Config updated to version ${config.version}\n`);
}

export function registerMigrateCommand(program) {
  program
    .command('migrate')
    .description('Perform config migrations to the current version')
    .option('--dry-run', 'show migrations without applying them')
    .action(handleMigrate);
}
