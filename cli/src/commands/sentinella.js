// Comando sentinella — monitoraggio rate-limit + risorse host dal CLI
//
// Sottocomandi:
//   jht sentinella status              ultimo tick (una riga formattata)
//   jht sentinella tail [-n 20]        ultimi N tick
//   jht sentinella graph [-n 40]       sparkline ASCII dell'usage
//
// Sorgente dati: $JHT_HOME/logs/sentinel-data.jsonl (scritto dal bridge).
// Nessuna dipendenza dal container: legge direttamente il bind-mount.

import { Command } from 'commander';
import { readFileSync, existsSync, statSync, watchFile } from 'node:fs';
import { join } from 'node:path';
import { JHT_HOME } from '../jht-paths.js';

const JSONL_PATH = join(JHT_HOME, 'logs', 'sentinel-data.jsonl');

const col = {
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
  magenta:(s) => `\x1b[35m${s}\x1b[0m`,
  blue:   (s) => `\x1b[34m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
};

const STATUS_COLOR = {
  OK: col.green,
  SOTTOUTILIZZO: col.blue,
  ATTENZIONE: col.yellow,
  CRITICO: col.red,
  RESET: col.magenta,
  ANOMALIA: col.yellow,
};

function readAllTicks() {
  if (!existsSync(JSONL_PATH)) return [];
  const raw = readFileSync(JSONL_PATH, 'utf8');
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  return out;
}

function fmtTick(t) {
  const ts = (t.ts || '').split('T')[1]?.slice(0, 8) || '??:??:??';
  const statusFn = STATUS_COLOR[t.status] || col.dim;
  const host = t.host || {};
  const hostLvl = t.host_level ? ` ${col.dim('host=' + (t.host_level || 'OK'))}` : '';
  const projection = t.projection != null ? `${Number(t.projection).toFixed(0)}%` : '-';
  const throttle = t.throttle != null ? `T${t.throttle}` : 'T?';
  const velSmooth = t.velocity_smooth != null ? `${Number(t.velocity_smooth).toFixed(1)}%/h` : '-';
  const provider = t.provider || '-';
  return (
    `${col.dim(ts)}  ${provider.padEnd(8)} ` +
    `usage=${col.bold(String(t.usage) + '%').padEnd(15)} ` +
    `${statusFn(t.status.padEnd(14))} ${throttle.padEnd(3)} ` +
    `vel=${velSmooth.padStart(8)} proj=${projection.padStart(5)} ` +
    `reset=${t.reset_at || '-'}` +
    (host.cpu_pct != null ? ` cpu=${host.cpu_pct}% ram=${host.ram_pct}%` : '') +
    hostLvl
  );
}

// ── status: ultimo tick ────────────────────────────────────────────
function statusAction() {
  const ticks = readAllTicks();
  if (!ticks.length) {
    console.log(col.yellow('Nessun tick nel JSONL (' + JSONL_PATH + ').'));
    console.log(col.dim('  La Sentinella deve essere avviata (jht team start sentinella).'));
    return;
  }
  const last = ticks[ticks.length - 1];
  const age = Date.now() - new Date(last.ts).getTime();
  const ageStr = age < 60_000 ? `${Math.round(age / 1000)}s fa` : `${Math.round(age / 60_000)}m fa`;
  console.log('');
  console.log(`${col.bold('Ultimo tick Sentinella:')} ${col.dim(ageStr)}`);
  console.log('  ' + fmtTick(last));
  console.log('');
}

// ── tail: ultimi N tick + follow opzionale ────────────────────────
function tailAction(options = {}) {
  const n = parseInt(options.n ?? 20, 10);
  const ticks = readAllTicks();
  if (!ticks.length) {
    console.log(col.yellow('Nessun tick nel JSONL.'));
    return;
  }
  const tail = ticks.slice(-n);
  console.log('');
  console.log(col.bold(`Ultimi ${tail.length} tick:`));
  for (const t of tail) console.log('  ' + fmtTick(t));
  console.log('');

  if (options.follow) {
    console.log(col.dim('(follow) in attesa di nuovi tick… Ctrl-C per uscire'));
    let lastSize = existsSync(JSONL_PATH) ? statSync(JSONL_PATH).size : 0;
    watchFile(JSONL_PATH, { interval: 2000 }, () => {
      try {
        const nowSize = statSync(JSONL_PATH).size;
        if (nowSize <= lastSize) return;
        const fd = readFileSync(JSONL_PATH, 'utf8');
        const newLines = fd.slice(lastSize).split(/\r?\n/).filter(Boolean);
        for (const line of newLines) {
          try { console.log('  ' + fmtTick(JSON.parse(line))); } catch { /* ignore */ }
        }
        lastSize = nowSize;
      } catch { /* ignore */ }
    });
  }
}

// ── graph: sparkline ASCII dell'usage ─────────────────────────────
function graphAction(options = {}) {
  const n = parseInt(options.n ?? 40, 10);
  const ticks = readAllTicks().slice(-n);
  if (!ticks.length) {
    console.log(col.yellow('Nessun tick nel JSONL.'));
    return;
  }
  const usages = ticks.map((t) => Number(t.usage) || 0);
  const min = 0, max = 100;
  const bars = '▁▂▃▄▅▆▇█';
  const chart = usages.map((u) => {
    const idx = Math.min(bars.length - 1, Math.floor(((u - min) / (max - min)) * bars.length));
    return bars[idx];
  }).join('');
  const last = ticks[ticks.length - 1];
  const statusFn = STATUS_COLOR[last.status] || col.dim;

  console.log('');
  console.log(col.bold(`Usage sparkline (${ticks.length} tick):`));
  console.log('  ' + chart);
  const first = ticks[0];
  const firstTs = (first.ts || '').split('T')[1]?.slice(0, 5) || '';
  const lastTs = (last.ts || '').split('T')[1]?.slice(0, 5) || '';
  console.log('  ' + col.dim(firstTs + ' '.repeat(Math.max(0, ticks.length - 10)) + lastTs));
  console.log('');
  console.log(`  Ora: ${col.bold(last.usage + '%')} ${statusFn(last.status)} T${last.throttle}  ` +
    `proj=${last.projection != null ? Math.round(last.projection) + '%' : '-'}  reset=${last.reset_at || '-'}`);
  console.log('');
}

export function registerSentinellaCommand(program) {
  const sent = new Command('sentinella').description('Monitoraggio Sentinella (rate-limit + risorse host)');

  sent
    .command('status')
    .description('Mostra l\'ultimo tick della Sentinella')
    .action(statusAction);

  sent
    .command('tail')
    .description('Mostra gli ultimi N tick')
    .option('-n, --n <num>', 'numero di tick', '20')
    .option('-f, --follow', 'segui in tempo reale i nuovi tick', false)
    .action(tailAction);

  sent
    .command('graph')
    .description('Sparkline ASCII dell\'usage')
    .option('-n, --n <num>', 'numero di tick da plottare', '40')
    .action(graphAction);

  program.addCommand(sent);
}
