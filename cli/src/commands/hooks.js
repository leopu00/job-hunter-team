import { readFile, writeFile, readdir, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { JHT_HOME } from '../jht-paths.js';

const JHT_DIR    = JHT_HOME;
const HOOKS_DIR  = join(JHT_DIR, 'hooks');
const CONFIG_PATH = join(JHT_DIR, 'hooks-config.json');

const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM    = '\x1b[90m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function loadConfig() {
  try { return JSON.parse(await readFile(CONFIG_PATH, 'utf-8')); }
  catch { return { disabled: [] }; }
}

async function saveConfig(cfg) {
  await mkdir(JHT_DIR, { recursive: true });
  const tmp = CONFIG_PATH + '.tmp';
  await writeFile(tmp, JSON.stringify(cfg, null, 2), 'utf-8');
  const { rename } = await import('node:fs/promises');
  await rename(tmp, CONFIG_PATH);
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const meta = {};
  for (const line of match[1].split('\n')) {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) meta[key.trim()] = rest.join(':').trim();
  }
  return meta;
}

async function discoverHooks() {
  const hooks = [];
  if (!(await fileExists(HOOKS_DIR))) return hooks;
  const entries = await readdir(HOOKS_DIR, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    const ext = e.name.split('.').pop();
    if (!['js', 'ts', 'sh', 'md'].includes(ext)) continue;
    const fp = join(HOOKS_DIR, e.name);
    try {
      const content = await readFile(fp, 'utf-8');
      const meta = parseFrontmatter(content);
      hooks.push({
        file: e.name,
        id: meta.id ?? e.name.replace(/\.[^.]+$/, ''),
        name: meta.name ?? e.name,
        event: meta.event ?? meta.trigger ?? 'unknown',
        priority: parseInt(meta.priority ?? '0', 10),
        description: meta.description ?? '',
        source: meta.source ?? 'user',
      });
    } catch { /* skip */ }
  }
  return hooks.sort((a, b) => a.priority - b.priority);
}

async function handleHooks(action, options) {
  if (!action || action === 'list' || action === 'ls') return await listHooks();
  if (action === 'enable') return await toggleHook(options.id, true);
  if (action === 'disable') return await toggleHook(options.id, false);
  if (action === 'show') return await showHook(options.id);

  console.error(`  Azione non valida: ${action}`);
  console.error('  Azioni: list, enable --id <id>, disable --id <id>, show --id <id>');
  process.exitCode = 1;
}

async function listHooks() {
  const hooks = await discoverHooks();
  const config = await loadConfig();
  const disabled = new Set(config.disabled ?? []);

  console.log(`\n  ${BOLD}JHT — Hooks${RESET} (${hooks.length})\n`);

  if (hooks.length === 0) {
    console.log(`  ${DIM}Nessun hook trovato.${RESET}`);
    console.log(`  ${DIM}Directory: ${HOOKS_DIR}${RESET}\n`);
    return;
  }

  // Raggruppa per evento
  const byEvent = new Map();
  for (const h of hooks) {
    if (!byEvent.has(h.event)) byEvent.set(h.event, []);
    byEvent.get(h.event).push(h);
  }

  for (const [event, list] of byEvent) {
    console.log(`  ${YELLOW}${event}${RESET}`);
    for (const h of list) {
      const enabled = !disabled.has(h.id);
      const icon = enabled ? `${GREEN}●${RESET}` : `${DIM}○${RESET}`;
      const status = enabled ? '' : ` ${DIM}(disabilitato)${RESET}`;
      console.log(`    ${icon}  ${h.name}${status}  ${DIM}[${h.source}, p${h.priority}]${RESET}`);
      if (h.description) console.log(`       ${DIM}${h.description}${RESET}`);
    }
    console.log('');
  }
}

async function toggleHook(id, enable) {
  if (!id) { console.error('  --id obbligatorio'); process.exitCode = 1; return; }

  const hooks = await discoverHooks();
  if (!hooks.find(h => h.id === id)) {
    console.error(`  Hook non trovato: ${id}`);
    console.error(`  Hook disponibili: ${hooks.map(h => h.id).join(', ') || 'nessuno'}`);
    process.exitCode = 1;
    return;
  }

  const config = await loadConfig();
  const disabled = new Set(config.disabled ?? []);
  if (enable) disabled.delete(id);
  else disabled.add(id);
  config.disabled = [...disabled];
  await saveConfig(config);
  console.log(`\n  ${GREEN}✓${RESET}  Hook "${id}" ${enable ? 'attivato' : 'disattivato'}.\n`);
}

async function showHook(id) {
  if (!id) { console.error('  --id obbligatorio'); process.exitCode = 1; return; }
  const hooks = await discoverHooks();
  const h = hooks.find(h => h.id === id);
  if (!h) { console.error(`  Hook non trovato: ${id}`); process.exitCode = 1; return; }

  const content = await readFile(join(HOOKS_DIR, h.file), 'utf-8');
  console.log(`\n  ${BOLD}${h.name}${RESET}  ${DIM}(${h.file})${RESET}`);
  console.log(`  ${DIM}Evento: ${h.event} · Priorità: ${h.priority} · Sorgente: ${h.source}${RESET}`);
  if (h.description) console.log(`  ${DIM}${h.description}${RESET}`);
  console.log(`\n  ${'─'.repeat(50)}\n`);
  const lines = content.split('\n').slice(0, 30);
  for (const l of lines) console.log(`  ${l}`);
  if (content.split('\n').length > 30) console.log(`\n  ${DIM}... (${content.split('\n').length - 30} righe rimanenti)${RESET}`);
  console.log('');
}

export function registerHooksCommand(program) {
  program
    .command('hooks [action]')
    .description('Gestione hooks (azioni: list, enable, disable, show)')
    .option('--id <id>', 'ID hook')
    .action(handleHooks);
}
