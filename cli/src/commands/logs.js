import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { JHT_HOME } from '../jht-paths.js';

const JHT_DIR  = JHT_HOME;
const LOGS_DIR = join(JHT_DIR, 'logs');

const LEVEL_PRIORITY = { error: 0, warn: 1, info: 2, debug: 3 };
const LEVEL_COLOR = { error: '\x1b[31m', warn: '\x1b[33m', info: '\x1b[32m', debug: '\x1b[90m' };
const RESET = '\x1b[0m';
const DIM = '\x1b[90m';

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

function parseLogLine(line) {
  try {
    const obj = JSON.parse(line);
    return {
      ts: obj.ts ?? obj.timestamp ?? '',
      level: (obj.level ?? 'info').toLowerCase(),
      module: obj.module ?? obj.source ?? '',
      msg: obj.msg ?? obj.message ?? line,
    };
  } catch {
    return { ts: '', level: 'info', module: '', msg: line };
  }
}

function fmtTime(ts) {
  if (!ts) return '';
  try { return new Date(typeof ts === 'number' ? ts : ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  catch { return String(ts).slice(11, 19); }
}

async function handleLogs(options) {
  const level = (options.level ?? 'info').toLowerCase();
  const module = options.module?.toLowerCase();
  const tail = Math.min(parseInt(options.tail ?? '50', 10) || 50, 500);
  const maxLevel = LEVEL_PRIORITY[level] ?? 2;

  // Raccoglie log da tutti i file .log e .jsonl nella dir logs
  const logFiles = [];
  if (await fileExists(LOGS_DIR)) {
    const entries = await readdir(LOGS_DIR);
    for (const e of entries) {
      if (e.endsWith('.log') || e.endsWith('.jsonl')) logFiles.push(join(LOGS_DIR, e));
    }
  }

  // Anche log agenti
  const agentsDir = join(JHT_DIR, 'agents');
  if (await fileExists(agentsDir)) {
    const agents = await readdir(agentsDir);
    for (const a of agents) {
      for (const name of ['agent.log', 'log.jsonl']) {
        const p = join(agentsDir, a, name);
        if (await fileExists(p)) logFiles.push(p);
      }
    }
  }

  if (logFiles.length === 0) {
    console.log('\n  Nessun file di log trovato.\n');
    return;
  }

  // Legge e parsa tutte le righe
  const allEntries = [];
  for (const f of logFiles) {
    try {
      const lines = (await readFile(f, 'utf-8')).trim().split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        const entry = parseLogLine(line);
        const entryLevel = LEVEL_PRIORITY[entry.level] ?? 2;
        if (entryLevel > maxLevel) continue;
        if (module && !entry.module.toLowerCase().includes(module)) continue;
        allEntries.push(entry);
      }
    } catch { /* skip unreadable */ }
  }

  // Ordina per timestamp e prendi ultimi N
  allEntries.sort((a, b) => {
    const ta = typeof a.ts === 'number' ? a.ts : new Date(a.ts).getTime() || 0;
    const tb = typeof b.ts === 'number' ? b.ts : new Date(b.ts).getTime() || 0;
    return ta - tb;
  });
  const slice = allEntries.slice(-tail);

  if (slice.length === 0) {
    console.log(`\n  Nessun log trovato (livello: ${level}${module ? `, modulo: ${module}` : ''}).\n`);
    return;
  }

  console.log(`\n  JHT — Log (ultimi ${slice.length}, livello ≤ ${level})\n`);
  for (const e of slice) {
    const color = LEVEL_COLOR[e.level] ?? '';
    const time = fmtTime(e.ts);
    const mod = e.module ? `${DIM}[${e.module}]${RESET} ` : '';
    const lvl = `${color}${e.level.toUpperCase().padEnd(5)}${RESET}`;
    console.log(`  ${DIM}${time}${RESET} ${lvl} ${mod}${e.msg}`);
  }
  console.log('');
}

export function registerLogsCommand(program) {
  program
    .command('logs')
    .description('Mostra log strutturati con filtri')
    .option('-l, --level <level>', 'livello minimo: error, warn, info, debug', 'info')
    .option('-m, --module <module>', 'filtra per modulo/sorgente')
    .option('-t, --tail <n>', 'numero di righe (default 50, max 500)', '50')
    .action(handleLogs);
}
