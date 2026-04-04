import { readFile, readdir, writeFile, access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const JHT_DIR     = join(homedir(), '.jht');
const PLUGINS_DIR = join(JHT_DIR, 'plugins');
const CONFIG_PATH = join(JHT_DIR, 'plugins-config.json');

const OK = '\x1b[32m●\x1b[0m';
const OFF = '\x1b[90m○\x1b[0m';
const DIM = '\x1b[90m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function loadConfig() {
  try { return JSON.parse(await readFile(CONFIG_PATH, 'utf-8')); }
  catch { return { deny: [] }; }
}

async function saveConfig(cfg) {
  await mkdir(JHT_DIR, { recursive: true });
  const tmp = CONFIG_PATH + '.tmp';
  await writeFile(tmp, JSON.stringify(cfg, null, 2), 'utf-8');
  const { rename } = await import('node:fs/promises');
  await rename(tmp, CONFIG_PATH);
}

async function discoverPlugins() {
  const plugins = [];
  if (!(await fileExists(PLUGINS_DIR))) return plugins;
  const entries = await readdir(PLUGINS_DIR, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const manifestPath = join(PLUGINS_DIR, e.name, 'jht.plugin.json');
    if (!(await fileExists(manifestPath))) continue;
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
      plugins.push({ id: manifest.id ?? e.name, name: manifest.name ?? e.name, version: manifest.version ?? '?', kind: manifest.kind ?? 'unknown', description: manifest.description ?? '', dir: e.name });
    } catch { /* skip malformed */ }
  }
  return plugins;
}

async function handlePlugins(action, options) {
  if (!action || action === 'list' || action === 'ls') return await listPlugins();
  if (action === 'enable') return await togglePlugin(options.id, true);
  if (action === 'disable') return await togglePlugin(options.id, false);

  console.error(`  Azione non valida: ${action}`);
  console.error('  Azioni: list, enable --id <id>, disable --id <id>');
  process.exitCode = 1;
}

async function listPlugins() {
  const plugins = await discoverPlugins();
  const config = await loadConfig();
  const deny = new Set(config.deny ?? []);

  if (plugins.length === 0) {
    console.log('\n  Nessun plugin installato.\n');
    console.log(`  ${DIM}Directory plugin: ${PLUGINS_DIR}${RESET}\n`);
    return;
  }

  console.log(`\n  JHT — Plugin (${plugins.length})\n`);
  for (const p of plugins) {
    const enabled = !deny.has(p.id);
    const icon = enabled ? OK : OFF;
    const status = enabled ? `${GREEN}attivo${RESET}` : `${DIM}disabilitato${RESET}`;
    console.log(`  ${icon}  ${p.name} ${DIM}v${p.version}${RESET}  [${YELLOW}${p.kind}${RESET}]  ${status}`);
    if (p.description) console.log(`     ${DIM}${p.description}${RESET}`);
  }
  console.log('');
}

async function togglePlugin(id, enable) {
  if (!id) {
    console.error('  Opzione --id obbligatoria');
    process.exitCode = 1;
    return;
  }

  const plugins = await discoverPlugins();
  if (!plugins.find(p => p.id === id)) {
    console.error(`  Plugin non trovato: ${id}`);
    console.error(`  Plugin disponibili: ${plugins.map(p => p.id).join(', ') || 'nessuno'}`);
    process.exitCode = 1;
    return;
  }

  const config = await loadConfig();
  const deny = new Set(config.deny ?? []);

  if (enable) { deny.delete(id); }
  else { deny.add(id); }

  config.deny = [...deny];
  await saveConfig(config);
  console.log(`\n  Plugin "${id}" ${enable ? 'attivato' : 'disattivato'}.\n`);
}

export function registerPluginsCommand(program) {
  program
    .command('plugins [action]')
    .description('Gestione plugin (azioni: list, enable, disable)')
    .option('--id <id>', 'ID del plugin da attivare/disattivare')
    .action(handlePlugins);
}
