// Read-only auditing del Python user-base condiviso del team
// (`PYTHONUSERBASE=/jht_home/.local` nel container, vedi RULE-T13).
//
// Esposto come `jht tools [list|outdated|dups|stats]` per dare al Capitano
// (e all'utente) visibilità su drift del magazzino Python — pacchetti
// duplicati funzionali (es. 5 PDF libs concorrenti), versioni outdated,
// totale spazio occupato. Pattern speculare a `jht cache`.
//
// Tutti i comandi delegano al container via execInContainer per girare nel
// magazzino vero. Su host senza container running fail-fast con messaggio.

import { execInContainer, containerRunning } from '../utils/container-proxy.js';

// Gruppi di pacchetti con sovrapposizione funzionale: avere >1 installato
// non rompe nulla ma raddoppia disk + import time, e spesso indica che due
// agenti hanno installato lib diverse per lo stesso scopo (vedi audit
// 2026-05-02 con 5 PDF libs concorrenti). Hardcoded perché euristiche
// automatiche su "stessa funzione" sono fragili.
const KNOWN_OVERLAPS = [
  { kind: 'pdf-generate',  pkgs: ['weasyprint', 'reportlab', 'fpdf', 'fpdf2', 'pymupdf', 'pdfkit'] },
  { kind: 'pdf-parse',     pkgs: ['pdfminer', 'pdfminer.six', 'pdfplumber', 'pypdf', 'pypdf2', 'pdfquery'] },
  { kind: 'http-client',   pkgs: ['requests', 'httpx', 'aiohttp', 'urllib3'] },
  { kind: 'html-parse',    pkgs: ['beautifulsoup4', 'lxml', 'html5lib', 'parsel'] },
  { kind: 'yaml',          pkgs: ['pyyaml', 'ruamel.yaml'] },
  { kind: 'image',         pkgs: ['pillow', 'opencv-python', 'imageio'] },
];

const PIP_LIST_CMD = 'python3 -m pip list --user --format=json 2>/dev/null';
const PIP_OUTDATED_CMD = 'python3 -m pip list --user --outdated --format=json 2>/dev/null';
const DU_USERBASE_CMD = 'du -sb "${PYTHONUSERBASE:-/jht_home/.local}" 2>/dev/null | awk \'{print $1}\'';

function fmtSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

function parseJsonSafe(stdout) {
  try {
    return JSON.parse(stdout || '[]');
  } catch {
    return null;
  }
}

function ensureContainer() {
  if (!containerRunning()) {
    console.error('  The `jht` container is not active. Start with `jht up`.');
    process.exitCode = 1;
    return false;
  }
  return true;
}

async function handleTools(action) {
  if (!action || action === 'stats') return await toolsStats();
  if (action === 'list')     return await toolsList();
  if (action === 'outdated') return await toolsOutdated();
  if (action === 'dups')     return await toolsDups();

  console.error(`  Invalid action: ${action}`);
  console.error('  Actions: stats, list, outdated, dups');
  process.exitCode = 1;
}

async function toolsStats() {
  if (!ensureContainer()) return;
  console.log('\n  JHT — Python User-Base Stats\n');

  const list = execInContainer(PIP_LIST_CMD, { timeoutMs: 30_000 });
  const du   = execInContainer(DU_USERBASE_CMD, { timeoutMs: 10_000 });

  const pkgs = parseJsonSafe(list.stdout) || [];
  const bytes = parseInt((du.stdout || '0').trim(), 10);

  console.log(`  Packages installed: ${pkgs.length}`);
  console.log(`  Space occupied:      ${fmtSize(bytes)}`);

  // Mini-summary overlap (senza dettaglio — usa `jht tools dups` per quello)
  const overlapHits = KNOWN_OVERLAPS
    .map(g => ({
      kind: g.kind,
      hits: g.pkgs.filter(p => pkgs.some(x => (x.name || '').toLowerCase() === p)),
    }))
    .filter(g => g.hits.length > 1);

  if (overlapHits.length === 0) {
    console.log('  Functional Overlap: no detected ✓');
  } else {
    console.log(`  Functional Overlap:   ${overlapHits.length} groups with duplicates (see \`jht tools dups\`)`);
  }
  console.log('');
}

async function toolsList() {
  if (!ensureContainer()) return;
  console.log('\n  JHT — Python User-Base Packages\n');

  const r = execInContainer(PIP_LIST_CMD, { timeoutMs: 30_000 });
  const pkgs = parseJsonSafe(r.stdout);
  if (!pkgs) {
    console.error('  `pip list` reading error. stderr:');
    console.error(r.stderr);
    process.exitCode = 1;
    return;
  }
  if (pkgs.length === 0) {
    console.log('  (No package installed in PYTHONUSERBASE)\n');
    return;
  }

  pkgs.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const nameW = Math.max(...pkgs.map(p => (p.name || '').length), 4);
  for (const p of pkgs) {
    console.log(`  ${(p.name || '').padEnd(nameW)}  ${p.version || ''}`);
  }
  console.log(`\n  Total: ${pkgs.length} packages\n`);
}

async function toolsOutdated() {
  if (!ensureContainer()) return;
  console.log('\n  JHT — Outdated Python Packages\n');

  const r = execInContainer(PIP_OUTDATED_CMD, { timeoutMs: 60_000 });
  const pkgs = parseJsonSafe(r.stdout);
  if (!pkgs) {
    console.error('  `pip list --outdated` reading error. stderr:');
    console.error(r.stderr);
    process.exitCode = 1;
    return;
  }
  if (pkgs.length === 0) {
    console.log('  All packages are up to date ✓\n');
    return;
  }

  pkgs.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const nameW = Math.max(...pkgs.map(p => (p.name || '').length), 4);
  const curW  = Math.max(...pkgs.map(p => (p.version || '').length), 7);
  console.log(`  ${'name'.padEnd(nameW)}  ${'current'.padEnd(curW)}  latest`);
  console.log(`  ${'─'.repeat(nameW)}  ${'─'.repeat(curW)}  ${'─'.repeat(8)}`);
  for (const p of pkgs) {
    const cur = p.version || '?';
    const lat = p.latest_version || '?';
    console.log(`  ${(p.name || '').padEnd(nameW)}  ${cur.padEnd(curW)}  ${lat}`);
  }
  console.log(`\n  ${pkgs.length} packages with updates available\n`);
}

async function toolsDups() {
  if (!ensureContainer()) return;
  console.log('\n  JHT — Functional Overlap in User-Base\n');

  const r = execInContainer(PIP_LIST_CMD, { timeoutMs: 30_000 });
  const pkgs = parseJsonSafe(r.stdout);
  if (!pkgs) {
    console.error('  `pip list` reading error. stderr:');
    console.error(r.stderr);
    process.exitCode = 1;
    return;
  }

  const installedSet = new Set(pkgs.map(p => (p.name || '').toLowerCase()));
  const overlapHits = KNOWN_OVERLAPS
    .map(g => ({ kind: g.kind, hits: g.pkgs.filter(p => installedSet.has(p)) }))
    .filter(g => g.hits.length > 1);

  if (overlapHits.length === 0) {
    console.log('  No functional overlap detected ✓\n');
    return;
  }

  for (const g of overlapHits) {
    console.log(`  ${g.kind}: ${g.hits.length} packages`);
    for (const p of g.hits) {
      const pkg = pkgs.find(x => (x.name || '').toLowerCase() === p);
      console.log(`    - ${p} ${pkg?.version ? '(' + pkg.version + ')' : ''}`);
    }
    console.log('');
  }
  console.log(`  ${overlapHits.length} groups with duplicates. Consolidate and \`pip uninstall\` unchosen libs.\n`);
}

export function registerToolsCommand(program) {
  program
    .command('tools [action]')
    .description('Audit the shared Python user base (actions: stats, list, outdated, dups)')
    .action(handleTools);
}
