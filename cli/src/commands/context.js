import { readFile, readdir, access, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const JHT_DIR     = join(homedir(), '.jht');
const CONTEXT_DIR = join(JHT_DIR, 'context');
const CONFIG_PATH = join(JHT_DIR, 'jht.config.json');

const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM    = '\x1b[90m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function dirSize(dirPath) {
  let total = 0, count = 0;
  try {
    const entries = await readdir(dirPath, { withFileTypes: true, recursive: true });
    for (const e of entries) {
      if (e.isFile()) {
        try { const s = await stat(join(e.parentPath ?? e.path ?? dirPath, e.name)); total += s.size; count++; }
        catch { /* skip */ }
      }
    }
  } catch { /* dir not found */ }
  return { bytes: total, files: count };
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

async function handleContext(action) {
  if (!action || action === 'status') return await contextStatus();
  if (action === 'sources') return await contextSources();
  if (action === 'clear') return await contextClear();

  console.error(`  Azione non valida: ${action}`);
  console.error('  Azioni: status, sources, clear');
  process.exitCode = 1;
}

async function contextStatus() {
  console.log(`\n  ${BOLD}JHT — Context Engine${RESET}\n`);

  // Config context-engine
  let contextCfg = {};
  if (await fileExists(CONFIG_PATH)) {
    try {
      const cfg = JSON.parse(await readFile(CONFIG_PATH, 'utf-8'));
      contextCfg = cfg.context_engine ?? cfg.contextEngine ?? {};
    } catch { /* skip */ }
  }

  const maxTokens = contextCfg.max_tokens ?? contextCfg.maxTokens ?? 'default';
  const strategy = contextCfg.strategy ?? 'priority';
  const enabled = contextCfg.enabled !== false;

  console.log(`  ${DIM}Stato:${RESET}     ${enabled ? `${GREEN}attivo${RESET}` : `${YELLOW}disattivato${RESET}`}`);
  console.log(`  ${DIM}Strategia:${RESET} ${strategy}`);
  console.log(`  ${DIM}Max token:${RESET} ${maxTokens}`);

  // Context cache
  if (await fileExists(CONTEXT_DIR)) {
    const { bytes, files } = await dirSize(CONTEXT_DIR);
    console.log(`  ${DIM}Cache:${RESET}     ${files} file, ${fmtSize(bytes)}`);
  } else {
    console.log(`  ${DIM}Cache:${RESET}     nessuna`);
  }

  // Sorgenti bootstrap
  const bootstrapFiles = ['SOUL.md', 'IDENTITY.md', 'MEMORY.md', 'AGENTS.md', 'USER.md', 'TOOLS.md'];
  const found = [];
  for (const f of bootstrapFiles) {
    if (await fileExists(join(JHT_DIR, f))) found.push(f.replace('.md', ''));
  }
  console.log(`  ${DIM}Bootstrap:${RESET} ${found.length > 0 ? found.join(', ') : 'nessuno'}`);
  console.log('');
}

async function contextSources() {
  console.log(`\n  ${BOLD}Sorgenti contesto${RESET}\n`);

  const sources = [
    { name: 'Bootstrap', dir: JHT_DIR, pattern: ['SOUL.md', 'IDENTITY.md', 'MEMORY.md', 'AGENTS.md', 'USER.md', 'TOOLS.md'] },
    { name: 'Context cache', dir: CONTEXT_DIR },
    { name: 'Agent configs', dir: join(JHT_DIR, 'agents') },
    { name: 'Templates', dir: join(JHT_DIR, 'templates') },
  ];

  for (const s of sources) {
    const exists = await fileExists(s.dir);
    if (!exists) {
      console.log(`  ${DIM}○${RESET}  ${s.name}: ${DIM}non trovato${RESET}`);
      continue;
    }
    if (s.pattern) {
      const found = [];
      for (const f of s.pattern) { if (await fileExists(join(s.dir, f))) found.push(f); }
      console.log(`  ${GREEN}●${RESET}  ${s.name}: ${found.length}/${s.pattern.length} file`);
    } else {
      const { files, bytes } = await dirSize(s.dir);
      console.log(`  ${GREEN}●${RESET}  ${s.name}: ${files} file, ${fmtSize(bytes)}`);
    }
  }
  console.log('');
}

async function contextClear() {
  if (!(await fileExists(CONTEXT_DIR))) {
    console.log(`\n  ${DIM}Nessuna cache contesto da pulire.${RESET}\n`);
    return;
  }
  const { files } = await dirSize(CONTEXT_DIR);
  const { rm } = await import('node:fs/promises');
  await rm(CONTEXT_DIR, { recursive: true, force: true });
  console.log(`\n  ${GREEN}✓${RESET}  Cache contesto pulita (${files} file rimossi).\n`);
}

export function registerContextCommand(program) {
  program
    .command('context [action]')
    .description('Context engine — stato, sorgenti, pulizia cache (azioni: status, sources, clear)')
    .action(handleContext);
}
