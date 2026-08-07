import { readFile, readdir, writeFile, access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { JHT_HOME } from '../jht-paths.js';
import { c, GREEN, YELLOW, DIM, RESET } from './_colors.js';

const JHT_DIR     = JHT_HOME;
const PLUGINS_DIR = join(JHT_DIR, 'plugins');
const CONFIG_PATH = join(JHT_DIR, 'plugins-config.json');

const OK = c.green('●');
const OFF = c.gray('○');

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

  console.error(`  Invalid action: ${action}`);
  console.error('  Azioni: list, enable --id <id>, disable --id <id>');
  process.exitCode = 1;
}

async function listPlugins() {
  const plugins = await discoverPlugins();
  const config = await loadConfig();
  const deny = new Set(config.deny ?? []);

  if (plugins.length === 0) {
    console.log('\n  No plugins installed.\n');
    console.log(`  ${DIM}Directory plugin: ${PLUGINS_DIR}${RESET}\n`);
    return;
  }

  console.log(`\n  JHT — Plugin (${plugins.length})\n`);
  for (const p of plugins) {
    const enabled = !deny.has(p.id);
    const icon = enabled ? OK : OFF;
    const status = enabled ? `${GREEN}enabled${RESET}` : `${DIM}disabled${RESET}`;
    console.log(`  ${icon}  ${p.name} ${DIM}v${p.version}${RESET}  [${YELLOW}${p.kind}${RESET}]  ${status}`);
    if (p.description) console.log(`     ${DIM}${p.description}${RESET}`);
  }
  console.log('');
}

async function togglePlugin(id, enable) {
  if (!id) {
    console.error('  Option --id mandatory');
    process.exitCode = 1;
    return;
  }

  const plugins = await discoverPlugins();
  if (!plugins.find(p => p.id === id)) {
    console.error(`  Plugin not found: ${id}`);
    console.error(`  Plugins available: ${plugins.map(p => p.id).join(', ') || 'Nobody.'}`);
    process.exitCode = 1;
    return;
  }

  const config = await loadConfig();
  const deny = new Set(config.deny ?? []);

  if (enable) { deny.delete(id); }
  else { deny.add(id); }

  config.deny = [...deny];
  await saveConfig(config);
  console.log(`\n  Plugin "${id}" ${enable ? 'enabled' : 'disabled'}.\n`);
}

export function registerPluginsCommand(program) {
  program
    .command('plugins [action]')
    .description('[not implemented] Plugin management — no loaders: plugins are never loaded (actions: list, enable, disable)')
    .option('--id <id>', 'Plugin ID to activate/disable')
    .action(handlePlugins);
}
