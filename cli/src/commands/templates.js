import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { JHT_HOME } from '../jht-paths.js';

const JHT_DIR       = JHT_HOME;
const TEMPLATES_DIR = join(JHT_DIR, 'templates');

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[90m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta = {};
  for (const line of match[1].split('\n')) {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) meta[key.trim()] = rest.join(':').trim();
  }
  return { meta, body: match[2] };
}

async function discoverTemplates() {
  const templates = [];
  if (!(await fileExists(TEMPLATES_DIR))) return templates;
  const entries = await readdir(TEMPLATES_DIR, { recursive: true });
  for (const e of entries) {
    if (!e.endsWith('.md') && !e.endsWith('.txt') && !e.endsWith('.hbs')) continue;
    const fp = join(TEMPLATES_DIR, e);
    try {
      const content = await readFile(fp, 'utf-8');
      const { meta, body } = parseFrontmatter(content);
      const vars = [...new Set((body.match(/\{\{([^}]+)\}\}/g) ?? []).map(v => v.replace(/[{}]/g, '').trim()))];
      templates.push({
        file: e,
        name: meta.name ?? e.replace(/\.(md|txt|hbs)$/, ''),
        description: meta.description ?? '',
        category: meta.category ?? 'general',
        vars,
        lines: body.split('\n').length,
      });
    } catch { /* skip */ }
  }
  return templates;
}

async function handleTemplates(action, options) {
  if (!action || action === 'list' || action === 'ls') return await listTemplates();
  if (action === 'preview' || action === 'show') return await previewTemplate(options);

  console.error(`  Azione non valida: ${action}`);
  console.error('  Azioni: list, preview --name <name>');
  process.exitCode = 1;
}

async function listTemplates() {
  const templates = await discoverTemplates();

  if (templates.length === 0) {
    console.log(`\n  ${DIM}Nessun template trovato.${RESET}`);
    console.log(`  ${DIM}Directory: ${TEMPLATES_DIR}${RESET}\n`);
    return;
  }

  // Raggruppa per categoria
  const byCategory = new Map();
  for (const t of templates) {
    if (!byCategory.has(t.category)) byCategory.set(t.category, []);
    byCategory.get(t.category).push(t);
  }

  console.log(`\n  ${BOLD}JHT — Template${RESET} (${templates.length})\n`);

  for (const [cat, list] of byCategory) {
    console.log(`  ${YELLOW}${cat}${RESET}`);
    for (const t of list) {
      const vars = t.vars.length > 0 ? `${DIM}vars: ${t.vars.join(', ')}${RESET}` : '';
      console.log(`    ${GREEN}${t.name}${RESET}  ${DIM}(${t.lines} righe)${RESET}  ${vars}`);
      if (t.description) console.log(`    ${DIM}${t.description}${RESET}`);
    }
    console.log('');
  }
}

async function previewTemplate(options) {
  if (!options.name) {
    console.error('  Opzione --name obbligatoria');
    process.exitCode = 1;
    return;
  }

  const templates = await discoverTemplates();
  const t = templates.find(t => t.name === options.name || t.file === options.name);
  if (!t) {
    console.error(`  Template non trovato: ${options.name}`);
    console.error(`  Disponibili: ${templates.map(t => t.name).join(', ') || 'nessuno'}`);
    process.exitCode = 1;
    return;
  }

  const content = await readFile(join(TEMPLATES_DIR, t.file), 'utf-8');
  const { meta, body } = parseFrontmatter(content);

  console.log(`\n  ${BOLD}${t.name}${RESET}  ${DIM}(${t.file})${RESET}`);
  if (t.description) console.log(`  ${DIM}${t.description}${RESET}`);
  if (t.vars.length > 0) console.log(`  ${YELLOW}Variabili:${RESET} ${t.vars.join(', ')}`);
  console.log(`\n  ${'─'.repeat(60)}\n`);

  const lines = body.split('\n').slice(0, parseInt(options.lines ?? '40', 10));
  for (const line of lines) {
    // Evidenzia variabili
    const highlighted = line.replace(/\{\{([^}]+)\}\}/g, `${YELLOW}{{$1}}${RESET}`);
    console.log(`  ${highlighted}`);
  }

  if (body.split('\n').length > lines.length) {
    console.log(`\n  ${DIM}... (${body.split('\n').length - lines.length} righe rimanenti)${RESET}`);
  }
  console.log('');
}

export function registerTemplatesCommand(program) {
  program
    .command('templates [action]')
    .description('Gestione template (azioni: list, preview)')
    .option('-n, --name <name>', 'nome template per preview')
    .option('-l, --lines <n>', 'righe da mostrare nel preview (default 40)', '40')
    .action(handleTemplates);
}
